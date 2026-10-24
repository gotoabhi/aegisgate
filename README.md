# AegisGate — Automated Healthcare Compliance & Egress Gateway

AegisGate is a high-security backend data gateway built in Node.js, Express, and PostgreSQL. It enforces **HIPAA Safe Harbor** (45 CFR § 164.514) and **India's Digital Personal Data Protection (DPDP) Act, 2023** regulations before patient health records are exported to third-party clinical researchers or contract research organizations (CROs).

---

## Architecture & Request Flow

```
+-------------+         +-------------------+         +--------------------+
| HTTP Client | ------> |  Express Gateway  | ------> | PostgreSQL (Pool)  |
| (CRO/Auditor)| <----- | (src/server.js)   | <------ | (securehealth_db)  |
+-------------+         +-------------------+         +--------------------+
                                 |
                                 +--------------------+
                                 |                    |
                                 v                    v
                      +--------------------+  +----------------------+
                      | Deterministic      |  | Gemini AI Engine     |
                      | Masking Engine     |  | (gemini-3.5-flash)   |
                      | (crypto HMAC/Hash) |  | Unstructured PII     |
                      +--------------------+  +----------------------+
                                 |                    |
                                 +----------+---------+
                                            |
                                            v
                                 +--------------------+
                                 | AWS S3 (AES-256)   |
                                 | & Audit Log Hash   |
                                 +--------------------+
```

### Detailed Sequence Diagram

```text
Client                Express (Router/Controller)       PostgreSQL              Gemini API (3.5-flash)       AWS S3
  |                               |                         |                            |                      |
  |--- POST /api/v1/egress/export>|                         |                            |                      |
  |    (purpose, requesterId)     |--- Checkout Client ---->|                            |                      |
  |                               |--- Query Patients & Enc>|                            |                      |
  |                               |<-- Return Raw Records --|                            |                      |
  |                               |                                                      |                      |
  |                               |-- [Tier 1] Deterministic Masking (HMAC SHA-256)       |                      |
  |                               |-- [Tier 2] Send Unstructured Notes ----------------->|                      |
  |                               |<-- Return Sanitized Text + Redaction Metadata -------|                      |
  |                               |                                                                             |
  |                               |--- [Tier 3] BEGIN Transaction --------------------->|                      |
  |                               |--- INSERT INTO egress_audit_logs ------------------->|                      |
  |                               |--- COMMIT ----------------------------------------->|                      |
  |                               |                                                                             |
  |                               |--- [Tier 4] PutObjectCommand (AES256 Encrypted) ---------------------------->|
  |                               |<-- Return Presigned Download URL (3600s TTL) --------------------------------|
  |                               |                                                                             |
  |<-- 200 OK (JSON Payload + ----|                                                                             |
       Presigned Download URL)    |                                                                             |
```

---

## Compliance Frameworks Implemented

### 1. HIPAA Safe Harbor (45 CFR § 164.514)
* **18 Direct Identifiers Suppressed:** Complete scrubbing of patient names, Aadhaar hashes, telephone numbers, emails, and street addresses.
* **Date Truncation:** Birth dates and clinical encounter dates are truncated strictly to the year.
* **Cryptographic Pseudonymization:** Medical Record Numbers (MRNs) are passed through an HMAC-SHA256 hash function with a server-side salt, ensuring consistency without re-identification risk.

### 2. India DPDP Act (2023)
* **Purpose Limitation:** Every export requires an explicit, audited `purpose` string.
* **Data Minimization:** Only relevant diagnostic metrics, vitals, and redacted clinical narratives are shared.
* **Immutable Auditability:** Every egress event records requester identity, compliance framework, redacted entity summaries, and an unalterable SHA-256 checksum of the exported text.

---

## Quickstart (Docker Compose)

1. Clone the repository:
   ```bash
   git clone [https://github.com/](https://github.com/)<your-username>/aegisgate.git
   cd aegisgate
   ```
2. Create `api/.env` using the provided `.env.example`.
3. Launch with Docker Compose:
   ```bash
   docker compose up --build
   ```
4. Trigger an egress export:
   ```bash
   curl -X POST http://localhost:5000/api/v1/egress/export \
     -H "Content-Type: application/json" \
     -d '{
       "requesterId": "cro-global-oncology-01",
       "purpose": "oncology_efficacy_review",
       "framework": "HIPAA_SAFE_HARBOR",
       "patientIds": [1, 2, 4]
     }'
   ```