# AegisGate — Automated Healthcare Compliance & Data Egress Gateway

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%203.5%20Flash%20Lite-orange.svg)](https://ai.google.dev/)
[![AWS S3](https://img.shields.io/badge/AWS-S3%20SSE--AES256-yellow.svg)](https://aws.amazon.com/s3/)
[![Terraform](https://img.shields.io/badge/IaC-Terraform-purple.svg)](https://www.terraform.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**AegisGate** is a production-grade backend compliance gateway designed to safely de-identify and egress clinical trial and patient datasets to third-party research entities (e.g., Clinical Research Organizations / CROs). It enforces the **HIPAA Safe Harbor Method (45 CFR § 164.514)** and **India's Digital Personal Data Protection (DPDP) Act, 2023** via a dual-tier redaction pipeline, cryptographic pseudonymization, Merkle/blockchain-lite cryptographic audit hash chaining, and encrypted AWS S3 delivery.

**AegisGate** is an open-source project. The name AegisGate is not a registered trademark.

---

## Key Features

- **Dual-Tier Sanitization Engine:**
  - **Tier 1 (Deterministic / Microsecond Latency):** Synchronous scrubbing of relational columns using Node.js `crypto` (HMAC-SHA256 for MRNs, date truncation to year, stripping direct identifiers like Aadhaar, phone, and email).
  - **Tier 2 (AI Contextual Redaction):** High-throughput NLP redaction via Google Gemini (`gemini-3.5-flash-lite`) enforcing strict JSON output schemas. Replaces names, relations, locations, and facilities with categorical tags (`[PATIENT_NAME]`, `[FAMILY_MEMBER]`) while strictly preserving clinical parameters (diagnoses, staging, ICD-10 codes, medication names, and dosages).
- **Cryptographic Audit Hash Chaining (Non-Repudiation & Tamper-Evidence):**
  - **Immutable Ledger:** Every audit row computes a cryptographic SHA-256 seal combining the prior row's `record_hash` (`prev_hash`), export metadata, sanitized payload digest, and timestamp.
  - **Concurrency Safety:** Row-level locking (`SELECT ... FOR UPDATE`) prevents race conditions and chain bifurcation during concurrent multi-patient exports.
  - **Zero-Trust Audit Verification:** Dedicated `GET /api/v1/egress/audit/verify` endpoint traverses the ledger from the genesis block to head, instantly pinpointing any manual alteration, truncation, or payload tampering.
- **Compliance & Governance:**
  - **Purpose Limitation:** Enforces mandatory `purpose` validation on all egress requests under DPDP Act provisions.
- **Secure Cloud Archival (Zero-Cost Free Tier Eligible):**
  - Exports encrypted at rest using Amazon S3-managed keys (`SSE-S3 AES-256`).
  - Delivers temporary, time-limited presigned URLs (3600-second TTL) rather than raw public endpoints.
- **Infrastructure as Code (IaC):**
  - Includes Terraform configurations with S3 lifecycle policies (30-day auto-expiration) and least-privilege IAM policies.

---

## Cryptographic Hash Chaining Mechanism

```text
[ Genesis Block ]
  prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"
  record_hash = SHA256(prev_hash | export_uuid | requester_id | purpose | framework | patient_id | sanitized_note_hash | timestamp)
         |
         v
[ Audit Row 1 ]
  prev_hash = Genesis record_hash
  record_hash = SHA256(prev_hash | Row 1 payload fields | timestamp)
         |
         v
[ Audit Row N ] (Any retroactive tampering in Row 1..N breaks the chain and fails /audit/verify)
```

---

## Architecture & Data Flow

```text
[ Client / CRO ]
       |
       |  1. POST /api/v1/egress/export (purpose, requesterId, patientIds)
       v
+--------------------------------------------------------------------------+
| Express Gateway API (Node.js)                                            |
|                                                                          |
|  2. Query Patients & Encounters                                          |
|     +-----------------------------> [ PostgreSQL (securehealth_db) ]     |
|                                                                          |
|  3. [Tier 1] Deterministic Masking                                       |
|     • Truncate DOB / Encounter Date to Year                              |
|     • HMAC-SHA256 Hash on MRN & Aadhaar                                  |
|     • Strip Name, Phone, Email, Address                                  |
|                                                                          |
|  4. [Tier 2] Contextual LLM Sanitization                                 |
|     • Structured prompt with clinical preservation rules                 |
|     +-----------------------------> [ Gemini 3.5 Flash Lite API ]        |
|                                                                          |
|  5. Cryptographic Audit Chaining (SELECT FOR UPDATE -> Append -> COMMIT) |
|     +-----------------------------> [ PostgreSQL egress_audit_logs ]     |
|                                                                          |
|  6. Encrypted Archival & Presigned URL Generation                        |
|     +-----------------------------> [ AWS S3 (SSE-AES256) ]              |
+--------------------------------------------------------------------------+
       |
       `--> Returns HTTP 200 OK with sanitized payload & S3 download URL
```

---

## Regulatory Compliance Matrix

| Regulation / Standard | Requirement | AegisGate Implementation |
| :--- | :--- | :--- |
| **HIPAA 45 CFR § 164.514(b)** | Safe Harbor 18 Direct Identifiers | Deterministic suppression of all 18 identifiers; MRNs salted with HMAC-SHA256. |
| **HIPAA Safe Harbor** | Temporal Data Minimization | Birth dates and encounter dates truncated strictly to year (YYYY). |
| **DPDP Act 2023 (Sec. 6 & 7)** | Purpose Limitation | Requests rejected unless explicit `purpose` is defined and logged. |
| **DPDP Act 2023 / HIPAA** | Non-Repudiation & Audit Trail | Merkle-lite hash chain in `egress_audit_logs` linking `prev_hash` to `record_hash`. |
| **HIPAA Security Rule** | Transmission & Storage Security | TLS 1.3 in transit + AWS S3 AES-256 at rest with expiring presigned links. |
| **Data Minimization** | Retention Limits | S3 lifecycle policies automatically expire and delete export objects after 30 days. |

---

## Project Structure

```text
aegisgate/
├── database/
│   ├── schema.sql           # DDL: PostgreSQL table schemas, indices, and constraints
│   └── seeds.sql            # DML: 10 diverse synthetic clinical test records
├── api/
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js        # PostgreSQL pg connection pool
│   │   ├── controllers/
│   │   │   └── egressController.js   # Orchestrates sanitization, DB, and S3
│   │   ├── routes/
│   │   │   └── egressRoutes.js       # Express route handlers
│   │   ├── services/
│   │   │   ├── aiSanitizerService.js # Gemini 3.5 Flash Lite integration & retry logic
│   │   │   ├── auditService.js       # SHA-256 cryptographic chaining & ledger verification
│   │   │   ├── maskingService.js     # Deterministic cryptographic masking
│   │   │   └── s3Service.js          # AWS SDK v3 S3 upload & presigned URL generator
│   │   └── server.js        # Application entrypoint
│   ├── .env.example         # Template for environment variables
│   ├── Dockerfile           # Production container build
│   └── package.json
├── terraform/               # Infrastructure as Code (IaC)
│   ├── main.tf              # S3 bucket, public access block, lifecycle & IAM policy
│   ├── variables.tf         # AWS region, project naming, and retention settings
│   └── outputs.tf           # Exported bucket details and credential references
├── docker-compose.yml       # Multi-container orchestration (API + PostgreSQL)
├── .gitignore               # Strict exclusion of .env, state, and credentials
├── LICENSE                  # MIT License
└── README.md
```

---

## Getting Started

### Prerequisites

- [Docker & Docker Compose](https://www.docker.com/) (recommended) **OR** [Node.js v20+](https://nodejs.org/) & [PostgreSQL 15+](https://www.postgresql.org/)
- A [Google Gemini API Key](https://aistudio.google.com/)
- An AWS Account (optional for cloud archival; S3 functionality is bypassed if credentials are not set)

---

### Method A: Quickstart via Docker Compose (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gotoabhi/aegisgate.git
   cd aegisgate
   ```

2. **Configure environment variables:**
   ```bash
   cp api/.env.example api/.env
   ```
   Open `api/.env` and insert your `GEMINI_API_KEY` and optional AWS credentials.

3. **Launch the stack:**
   ```bash
   docker compose up --build
   ```
   PostgreSQL will initialize with schemas and synthetic seeds, and the API gateway will start on port `5000`.

---

### Method B: Manual Local Setup

1. **Database Setup:**
   ```powershell
   psql -U postgres -c "CREATE DATABASE securehealth_db;"
   psql -U postgres -d securehealth_db -f database/schema.sql
   psql -U postgres -d securehealth_db -f database/seeds.sql
   ```

2. **Install & Run Backend:**
   ```powershell
   cd api
   npm install
   cp .env.example .env
   # Add your GEMINI_API_KEY and DB credentials in .env
   npm run dev
   ```

---

## API Usage & Endpoints

### 1. Trigger Compliant Patient Data Egress

**Endpoint:** `POST /api/v1/egress/export`  
**Headers:** `Content-Type: application/json`

```bash
curl -X POST http://localhost:5000/api/v1/egress/export \
  -H "Content-Type: application/json" \
  -d '{
    "requesterId": "cro-oncology-trial-402",
    "purpose": "oncology_clinical_efficacy_review",
    "framework": "HIPAA_SAFE_HARBOR",
    "patientIds": [1, 2]
  }'
```

#### Example Response:

```json
{
  "success": true,
  "exportUuid": "d82f7c04-5899-4a92-b4c1-6b834927cb78",
  "framework": "HIPAA_SAFE_HARBOR",
  "recordCount": 2,
  "s3Archive": {
    "s3Key": "exports/d82f7c04-5899-4a92-b4c1-6b834927cb78.json",
    "presignedUrl": "https://aegisgate-exports-xxxx.s3.ap-south-1.amazonaws.com/exports/..."
  },
  "data": [
    {
      "pseudonymized_id": "a9bf8c1d3e...",
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
          "sanitized_notes": "Patient [PATIENT_NAME] presented with recurring absence seizures. Accompanied by [FAMILY_MEMBER]. Prescribed Levetiracetam 500mg PO BID and Clobazam 5mg QHS...",
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

### 2. Verify Cryptographic Audit Chain Integrity

**Endpoint:** `GET /api/v1/egress/audit/verify`

Validates that every row in the audit log is cryptographically chained to its predecessor and that no payload has been modified post-export.

```bash
curl http://localhost:5000/api/v1/egress/audit/verify
```

#### Example Response (Valid State):

```json
{
  "verified": true,
  "chainLength": 8,
  "headHash": "9b12a8f8d0e764724b910e53186fb52a0a383d6a0cfd0342b4b2075f928e078c",
  "message": "Cryptographic chain verification passed. Zero tampering detected."
}
```

#### Example Response (Tampered State):

```json
{
  "verified": false,
  "tamperedAuditId": 3,
  "reason": "Data tampering detected at audit_id 3. Payload hash mismatch."
}
```

---

### 3. Query Audit Log History

**Endpoint:** `GET /api/v1/egress/audit-logs`  
**Query Parameters (Optional):** `?exportUuid=<UUID>`

```bash
curl http://localhost:5000/api/v1/egress/audit-logs
```

---

## Infrastructure as Code (Terraform)

To provision the production-ready AWS S3 compliance bucket, retention policies, and IAM permissions:

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

To tear down all provisioned cloud resources:
```bash
terraform destroy
```

---

## License

This project is licensed under the [MIT License](LICENSE).