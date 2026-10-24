-- 1. Clean up existing tables if any
DROP TABLE IF EXISTS egress_audit_logs CASCADE;
DROP TABLE IF EXISTS clinical_encounters CASCADE;
DROP TABLE IF EXISTS patients CASCADE;

-- 2. Patients Table (Raw demographic data subject to DPDP & HIPAA)
CREATE TABLE patients (
    patient_id SERIAL PRIMARY KEY,
    mrn VARCHAR(32) UNIQUE NOT NULL,               -- Medical Record Number (HIPAA identifier)
    full_name VARCHAR(120) NOT NULL,              -- Direct Identifier
    aadhaar_hash VARCHAR(64) NOT NULL,             -- Masked/Hashed National ID (DPDP)
    date_of_birth DATE NOT NULL,                  -- Direct Date Identifier
    gender VARCHAR(16) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,            -- Direct Contact Identifier
    email_address VARCHAR(120),                   -- Direct Contact Identifier
    street_address TEXT NOT NULL,                 -- Geographic sub-state info (HIPAA identifier)
    city VARCHAR(60) NOT NULL,
    state VARCHAR(60) NOT NULL,
    postal_code VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Clinical Encounters & Doctor Notes Table (Semi-structured & unstructured data)
CREATE TABLE clinical_encounters (
    encounter_id SERIAL PRIMARY KEY,
    patient_id INT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    encounter_date DATE NOT NULL,
    attending_physician VARCHAR(120) NOT NULL,
    department VARCHAR(80) NOT NULL,
    icd10_code VARCHAR(16) NOT NULL,              -- Legitimate clinical code (keep intact)
    diagnosis_name VARCHAR(200) NOT NULL,
    systolic_bp INT,
    diastolic_bp INT,
    clinical_notes TEXT NOT NULL,                 -- Free text containing implicit PHI/PII leaks
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Egress Audit Logs Table (Accountability & Legal Defensibility)
CREATE TABLE egress_audit_logs (
    audit_id SERIAL PRIMARY KEY,
    export_uuid UUID NOT NULL,
    requester_id VARCHAR(100) NOT NULL,
    purpose VARCHAR(100) NOT NULL,
    compliance_framework VARCHAR(50) NOT NULL,    -- 'HIPAA_SAFE_HARBOR' or 'DPDP_ACT'
    patient_id INT NOT NULL,
    fields_redacted JSONB NOT NULL,               -- Records exact fields stripped or hashed
    ai_sanitization_applied BOOLEAN DEFAULT FALSE,
    sanitized_note_hash VARCHAR(64),
    exported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Seed Synthetic Patient Records (Realistic Indian & Global Clinical Data)
INSERT INTO patients (mrn, full_name, aadhaar_hash, date_of_birth, gender, phone_number, email_address, street_address, city, state, postal_code)
VALUES
('MRN-90412', 'Sunita Sharma', 'XXXX-XXXX-8921', '1984-06-15', 'Female', '+91-98112-45678', 'sunita.sharma84@example.in', 'Flat 402, Lotus Apartments, Sector 62', 'Noida', 'Uttar Pradesh', '201309'),
('MRN-88231', 'David Miller', 'XXXX-XXXX-1102', '1962-11-20', 'Male', '+1-555-019-2834', 'dmiller.research@example.com', '742 Evergreen Terrace', 'Springfield', 'Oregon', '97477'),
('MRN-77319', 'Rohan Verma', 'XXXX-XXXX-4530', '1995-03-08', 'Male', '+91-98200-98711', 'rohan.v95@example.in', '12B, Bandra West', 'Mumbai', 'Maharashtra', '400050');

-- 6. Seed Realistic Clinical Notes (with intentional subtle PII leaks to test Gemini)
INSERT INTO clinical_encounters (patient_id, encounter_date, attending_physician, department, icd10_code, diagnosis_name, systolic_bp, diastolic_bp, clinical_notes)
VALUES
(
    1, 
    '2026-03-12', 
    'Dr. Rajesh Gupta', 
    'Oncology', 
    'C50.919', 
    'Malignant neoplasm of unspecified site of female breast', 
    128, 
    82, 
    'Patient Sunita Sharma, age 41, reported for cycle 3 adjuvant chemotherapy. Accompanied by her husband Rajesh Sharma (Senior Advocate at Delhi High Court). Patient mentioned taking metro from Noida Sector 62 daily. Tolerance to Paclitaxel is fair with mild peripheral neuropathy. Routine liver enzymes within normal limits.'
),
(
    2, 
    '2026-04-05', 
    'Dr. Karen Walker', 
    'Cardiology', 
    'I25.10', 
    'Atherosclerotic heart disease', 
    142, 
    90, 
    'Patient David Miller presented for routine follow-up following PCI stent placement last November. Mentioned his daughter Sarah Miller drove him from Springfield. Stress test shows stable hemodynamics. Continues on Aspirin 81mg and Atorvastatin 40mg daily.'
),
(
    3, 
    '2026-05-18', 
    'Dr. Ananya Roy', 
    'Endocrinology', 
    'E11.65', 
    'Type 2 diabetes mellitus with hyperglycemia', 
    134, 
    86, 
    'Rohan visited clinic after returning from an overseas business trip to Dubai. Blood glucose monitoring logs indicate erratic postprandial spikes. Metformin dosage adjusted to 1000mg BID. Recommended dietary consultation at Lilavati Hospital next week.'
);