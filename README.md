# AegisGate — Healthcare Egress & Compliance Gateway

[![CI](https://github.com/gotoabhi/aegisgate/actions/workflows/ci.yml/badge.svg)](https://github.com/gotoabhi/aegisgate/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-22863a.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791.svg)](https://www.postgresql.org/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-3.5%20%7C%203.8%20Flash-orange.svg)](https://ai.google.dev/)
[![AWS S3](https://img.shields.io/badge/AWS-S3%20SSE--AES256-ff9900.svg)](https://aws.amazon.com/s3/)
[![Terraform](https://img.shields.io/badge/IaC-Terraform-623ce4.svg)](https://www.terraform.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

📖 **Technical Deep-Dive:** [Why Healthcare Data Egress Is a Compliance Minefield](
https://medium.com/@abhishekapandey/healthcare-data-egress-is-a-compliance-minefield-i-built-a-gateway-to-fix-it-e8a315d41927?sharedUserId=abhishekapandey)

AegisGate is an API gateway that sanitizes relational clinical databases and unorganized physician notes before exporting cohorts to third-party research teams (CROs). It enforces the de-identification standards required by **HIPAA Safe Harbor (45 CFR § 164.514)** and **India's DPDP Act, 2023**.

The gateway couples deterministic masking with contextual LLM entity redaction, records every transaction into a hash-chained audit ledger to detect tampering, and uploads encrypted export packages directly to S3 with short-lived presigned download URLs.

> **Disclaimer:** This software is an engineering reference implementation built for demonstration and evaluation. It has not undergone formal third-party regulatory certification. Do not connect to production clinical environments without internal security and compliance review.

---

## Technical Overview

Exporting clinical datasets for research requires balancing two competing constraints:
1. **Privacy Invariants:** All direct identifiers and non-year dates must be stripped or masked to prevent re-identification.
2. **Clinical Utility:** Diagnostic terms, ICD-10 codes, vital signs, and drug regimens inside doctor notes must remain intact for research to be useful.

```text
Incoming Request (POST /export)
  │
  ├── 1. Tier 1: Deterministic Scrubbing (Node.js crypto)
  │      ├── Drop direct identifiers (Name, Phone, Email, National IDs)
  │      ├── Truncate timestamps & DOBs to UTC calendar year
  │      └── HMAC-SHA256 hash on MRN (maintains cohort linkage across exports)
  │
  ├── 2. Tier 2: Contextual NLP Redaction (Google Gemini)
  │      ├── In-context extraction of names, facilities, and transit details
  │      ├── Strict categorical token substitution ([PATIENT_NAME], [FACILITY])
  │      └── Automatic failover pool with regex fallback on upstream saturation
  │
  ├── 3. Cryptographic Audit Chaining (PostgreSQL)
  │      ├── Acquire row lock (SELECT ... FOR UPDATE) on ledger head
  │      ├── Compute SHA-256 seal: H(prev_hash | payload_digest | metadata | ts)
  │      └── Commit ledger entry within the same database transaction
  │
  └── 4. Encrypted Cloud Delivery (AWS S3)
         ├── Upload JSON manifest with SSE-AES256 encryption
         └── Generate 1-hour expiring presigned GET URL for research access
```

---

## Architectural Decisions & Trade-Offs

### Dual-Tier Pipeline
Regular expressions and string searches fail on doctor notes because medical text is full of edge cases (e.g., confusing doctor names with syndrome names, or mistaking drug dosages for phone numbers). 
* **Tier 1 (Relational Data):** Runs purely in memory using synchronous cryptographic hashing and field filters. Stripping direct columns here keeps costs low and guarantees direct PII never leaves the gateway boundary.
* **Tier 2 (Free-Text Notes):** Routes clinical notes through `gemini-3.5-flash-lite` (with failover to `gemini-3.8-flash`) constrained by a low temperature (0.1) and a structured JSON schema. If the model endpoint is unavailable or returns 503/429 errors, the gateway degrades to deterministic regex filtering so outgoing exports are never left stalled.

### Cryptographic Audit Ledger
HIPAA Security Rule § 164.312(b) and DPDP Act provisions mandate non-repudiation for exported health data. Traditional log tables can be secretly altered by a rogue database admin (`UPDATE egress_audit_logs SET ...`).
* To prevent this, AegisGate links each audit record to the hash of the preceding record (`prev_hash`).
* Any retroactive update or row deletion breaks the mathematical hash chain.
* **Concurrency Handling:** To avoid race conditions and chain splits when concurrent requests hit the gateway, the audit worker executes `SELECT record_hash FROM egress_audit_logs ORDER BY audit_id DESC LIMIT 1 FOR UPDATE`. This serializes ledger writes cleanly without requiring a slow, complex distributed lock manager.

---

## Regulatory Alignment

| Standard | Legal Requirement | Implementation in AegisGate |
| :--- | :--- | :--- |
| **HIPAA § 164.514(b)** | Removal of 18 Safe Harbor identifiers | Deterministic omission of names, contacts, and addresses; MRN transformed via HMAC-SHA256 pepper. |
| **HIPAA § 164.514(b)(2)** | Date minimization | Dates of birth and clinical encounter timestamps are truncated strictly to calendar year (`YYYY`). |
| **DPDP Act (Sec. 6 & 7)** | Purpose limitation | Requests are rejected immediately unless accompanied by a declared research purpose string. |
| **HIPAA § 164.312(b)** | Hardware/software audit controls | Hash-chained PostgreSQL ledger (`egress_audit_logs`) verified via `/api/v1/egress/audit/verify`. |
| **HIPAA § 164.312(a)(2)** | Encryption at rest and in transit | TLS 1.3 enforced for endpoints; AWS S3 server-side encryption (`AES256`) for stored bundles. |
| **Data Minimization** | Ephemeral storage | Presigned S3 URLs expire after 3,600 seconds; Terraform config provisions a 30-day object deletion rule. |

---

## Repository Layout

```text
├── api/
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js                 # PostgreSQL connection pool configuration
│   │   ├── controllers/
│   │   │   └── egressController.js   # Orchestrates sanitization, DB transactions, and S3
│   │   ├── routes/
│   │   │   └── egressRoutes.js       # Route definitions and parameter validators
│   │   ├── services/
│   │   │   ├── aiSanitizerService.js # Gemini NLP integration, failover pool, and regex fallback
│   │   │   ├── auditService.js       # SHA-256 hash chaining and ledger integrity verification
│   │   │   ├── maskingService.js     # Tier-1 HMAC pseudonymization and date truncation
│   │   │   └── s3Service.js          # S3 client, AES-256 uploads, and presigned URL issuer
│   │   └── server.js                 # Express server bootstrap and graceful shutdown hooks
│   ├── Dockerfile
│   └── package.json
├── database/
│   ├── schema.sql                    # Relational tables, indexing, and audit ledger schema
│   └── seeds.sql                     # Synthetic multi-patient clinical test fixtures
├── docs/
│   └── demo-desk.png                 # Terminal verification preview
├── terraform/
│   ├── main.tf                       # S3 bucket, least-privilege IAM, and lifecycle policies
│   ├── variables.tf                  # Region, project naming, and retention parameters
│   └── outputs.tf                    # Bucket identifiers and output ARNs
└── docker-compose.yml                # Local orchestration for PostgreSQL and API services
```

---

## Quickstart

### Prerequisites
* [Docker and Docker Compose](https://docs.docker.com/get-docker/) **OR** Node.js v20+ and PostgreSQL 15+
* A [Google AI Studio API Key](https://aistudio.google.com/)
* AWS Credentials with S3 permissions *(optional; S3 uploads are skipped if keys are not provided)*

### 1. Run with Docker Compose

```bash
git clone https://github.com/gotoabhi/aegisgate.git
cd aegisgate

# Set up environment variables
cp api/.env.example api/.env
```

Open `api/.env` and provide your configuration:
```env
PORT=5000
DATABASE_URL=postgres://postgres:postgres@postgres:5432/securehealth_db
PSEUDONYMIZATION_KEY=replace-with-a-random-secret-key-32-chars
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
```

Start the containers:
```bash
docker compose up --build
```
The gateway will start on `http://localhost:5000`.

### 2. Manual Local Setup (Alternative)

```bash
# Seed local database
psql -U postgres -c "CREATE DATABASE securehealth_db;"
psql -U postgres -d securehealth_db -f database/schema.sql
psql -U postgres -d securehealth_db -f database/seeds.sql

# Install dependencies and start server
cd api
npm install
npm run dev
```

---

## API Usage & Endpoints

### Live Execution Preview

Below is a live trace running a compliant patient data export and executing a zero-trust cryptographic ledger verification:

<p align="center">
  <img src="docs/demo-terminal.png" alt="AegisGate Live Verification Trace" width="900" />
</p>

---

### 1. Request Compliant Cohort Export

**`POST /api/v1/egress/export`**

Executes the dual-tier de-identification pipeline for specified patient IDs, writes an immutable audit record, and produces a sanitized JSON manifest.

#### Request Body Parameters

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `requesterId` | `string` | **Yes** | Identifier of the requesting research team or CRO. |
| `purpose` | `string` | **Yes** | Purpose string enforced under DPDP Act provisions. |
| `framework` | `string` | No | Regulatory pipeline to enforce: `HIPAA_SAFE_HARBOR` *(default)* or `DPDP_2023`. |
| `patientIds` | `number[]` | **Yes** | Array of database patient IDs to include in the export bundle. |

```bash
curl -X POST http://localhost:5000/api/v1/egress/export \
  -H "Content-Type: application/json" \
  -d '{
    "requesterId": "cro-oncology-trial-402",
    "purpose": "clinical_efficacy_review",
    "framework": "HIPAA_SAFE_HARBOR",
    "patientIds": [1, 2]
  }'
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "exportUuid": "d82f7c04-5899-4a92-b4c1-6b834927cb78",
  "framework": "HIPAA_SAFE_HARBOR",
  "recordCount": 2,
  "s3Archive": {
    "s3Key": "exports/d82f7c04-5899-4a92-b4c1-6b834927cb78.json",
    "presignedUrl": "https://aegisgate-exports-prod.s3.ap-south-1.amazonaws.com/exports/..."
  },
  "data": [
    {
      "pseudonymized_id": "a9bf8c1d3e874...",
      "birth_year": "1979",
      "gender": "Male",
      "state": "Uttar Pradesh",
      "clinical_history": [
        {
          "encounter_year": "2026",
          "department": "Neurology",
          "icd10_code": "G40.909",
          "diagnosis_name": "Epilepsy, unspecified",
          "systolic_bp": 128,
          "diastolic_bp": 82,
          "sanitized_notes": "Patient [PATIENT_NAME] presented with recurring absence seizures. Accompanied by [FAMILY_MEMBER]. Prescribed Levetiracetam 500mg PO BID...",
          "redactions": [
            { "original": "Vikram Malhotra", "category": "PATIENT_NAME", "replacement": "[PATIENT_NAME]" },
            { "original": "Sunita Malhotra", "category": "FAMILY_MEMBER", "replacement": "[FAMILY_MEMBER]" }
          ]
        }
      ]
    }
  ]
}
```

---

### 2. Verify Audit Ledger Integrity

**`GET /api/v1/egress/audit/verify`**

Traverses the hash chain from the genesis block (`0000...0000`) up to the current ledger head. It recalculates every record's SHA-256 digest to confirm no records have been altered, added, or deleted out of band.

```bash
curl -s http://localhost:5000/api/v1/egress/audit/verify | jq
```

**Response (Integrity Confirmed):**
```json
{
  "verified": true,
  "chainLength": 8,
  "headHash": "9b12a8f8d0e764724b910e53186fb52a0a383d6a0cfd0342b4b2075f928e078c",
  "message": "Cryptographic chain verification passed. Zero tampering detected."
}
```

**Response (Tampered Record Detected):**
```json
{
  "verified": false,
  "tamperedAuditId": 3,
  "reason": "Cryptographic payload mismatch at audit record 3."
}
```

---

### 3. Retrieve Audit Trail

**`GET /api/v1/egress/audit-logs`**

Returns historical export logs. Supports filtering by export batch identifier: `?exportUuid=d82f7c04-...`

```bash
curl http://localhost:5000/api/v1/egress/audit-logs
```

---

## Cloud Infrastructure (Terraform)

The `terraform/` directory provisions the production AWS S3 compliance bucket and policy controls:
* **Default Server-Side Encryption:** Enforces `AES256` encryption at rest on all written objects.
* **Public Access Block:** Hard-blocks all public reads, writes, and bucket policies.
* **Lifecycle Rules:** Configures an automatic expiration rule to delete exported datasets after 30 days to enforce storage minimization.
* **Least Privilege IAM:** Limits API credentials exclusively to `s3:PutObject` and `s3:GetObject` on the `/exports/*` prefix.

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

To tear down cloud infrastructure:
```bash
terraform destroy
```

---

## License

This repository is distributed under the terms of the [MIT License](LICENSE).