-- AegisGate Compliance Database DDL Schema

CREATE TABLE IF NOT EXISTS patients (
    patient_id SERIAL PRIMARY KEY,
    mrn VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    aadhaar_hash VARCHAR(64) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(20) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    email_address VARCHAR(150) NOT NULL,
    street_address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clinical_encounters (
    encounter_id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    encounter_date DATE NOT NULL,
    attending_physician VARCHAR(150) NOT NULL,
    department VARCHAR(100) NOT NULL,
    icd10_code VARCHAR(20) NOT NULL,
    diagnosis_name VARCHAR(255) NOT NULL,
    systolic_bp INT,
    diastolic_bp INT,
    clinical_notes TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS egress_audit_logs (
    audit_id SERIAL PRIMARY KEY,
    export_uuid UUID NOT NULL,
    requester_id VARCHAR(100) NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    compliance_framework VARCHAR(50) NOT NULL,
    patient_id INT NOT NULL,
    fields_redacted JSONB NOT NULL,
    ai_sanitization_applied BOOLEAN DEFAULT TRUE,
    sanitized_note_hash VARCHAR(64) NOT NULL,
    prev_hash VARCHAR(128) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    record_hash VARCHAR(128) NOT NULL,
    exported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_export_uuid ON egress_audit_logs(export_uuid);
CREATE INDEX IF NOT EXISTS idx_audit_patient_id ON egress_audit_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_exported_at ON egress_audit_logs(exported_at);