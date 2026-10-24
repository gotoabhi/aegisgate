-- Synthetic Clinical Test Data (Strictly fictitious under HIPAA Safe Harbor testing standards)

INSERT INTO patients (mrn, full_name, aadhaar_hash, date_of_birth, gender, phone_number, email_address, street_address, city, state, postal_code)
VALUES
('MRN-90210-04', 'Vikram Malhotra', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '1979-04-12', 'Male', '+91-98112-44551', 'vikram.m@zenithenterprises.in', 'Flat 402, Palm Heights, Sector 62', 'Noida', 'Uttar Pradesh', '201309'),
('MRN-90210-05', 'Ananya Deshmukh', 'f2ca1bb6c7e907d06dafe4687e579fce76b37e4e93b7605022da52e6ccc26fd2', '1995-11-23', 'Female', '+91-99201-88231', 'ananya.desh@techinnovate.org', '12/A, Shivaji Park Road', 'Mumbai', 'Maharashtra', '400028'),
('MRN-90210-06', 'Robert J. Patterson', 'c893bad68927b457dbed39460e6afd62395d6ebd1343c2606cb07d799d449420', '1962-08-30', 'Male', '+1-617-555-0182', 'robert.patterson@bostonlegal.net', '742 Evergreen Terrace', 'Springfield', 'Massachusetts', '02138'),
('MRN-90210-07', 'Farida Begum', '2e7d2c03a9507ae265ecf5b5356885a53393a2029d24139499726b4259fb173e', '2015-06-14', 'Female', '+91-94401-22991', 'guardian.begum@hyderabadcare.in', 'Plot 88, Banjara Hills Road No. 12', 'Hyderabad', 'Telangana', '500034'),
('MRN-90210-08', 'Dr. Alistair MacIntyre', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '1955-02-18', 'Male', '+44-20-7946-0912', 'alistair.m@oxfordacademic.co.uk', '45 Merton Street', 'Oxford', 'Oxfordshire', 'OX1 4JD'),
('MRN-90210-09', 'Priya Sundaram', '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a', '1988-09-05', 'Female', '+91-98400-11223', 'priya.sundaram@chennaibio.ac.in', 'Door No. 14, 2nd Main Road, Gandhi Nagar', 'Chennai', 'Tamil Nadu', '600020'),
('MRN-90210-10', 'Marcus Vance', 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d', '2001-01-19', 'Non-Binary', '+1-415-555-0199', 'marcus.v@baycreative.io', '350 Mission St', 'San Francisco', 'California', '94105')
ON CONFLICT (mrn) DO NOTHING;

INSERT INTO clinical_encounters (patient_id, encounter_date, attending_physician, department, icd10_code, diagnosis_name, systolic_bp, diastolic_bp, clinical_notes)
VALUES
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-04'),
  '2026-02-14', 'Dr. Ramesh Gupta', 'Neurology', 'G40.909', 'Epilepsy, unspecified', 128, 82,
  'Patient Vikram Malhotra (47yo male, Senior Executive at Zenith Enterprises) presented with recurring absence seizures. Accompanied by his wife Sunita Malhotra and personal driver Rajiv. An EEG confirmed epileptiform discharges in the left temporal lobe. Prescribed Levetiracetam 500mg PO BID and Clobazam 5mg QHS. Advised no driving near Noida Expressway. Follow-up scheduled at Fortis Hospital Noida in 6 weeks.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-05'),
  '2026-03-01', 'Dr. Meenakshi Iyer', 'Obstetrics & Gynecology', 'O24.419', 'Gestational diabetes mellitus in pregnancy', 118, 74,
  'Ananya Deshmukh, 30yo primigravida at 28 weeks gestation, works as a UI/UX consultant from her Shivaji Park residence. 2-hour 75g OGTT showed fasting 98 mg/dL, 1-hour 188 mg/dL, 2-hour 158 mg/dL. Initiated medical nutrition therapy and daily blood glucose monitoring log. Commenced Metformin 500mg BID. Fetal biometry performed at Lilavati Hospital shows normal growth parameters.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-06'),
  '2026-01-18', 'Dr. Sarah Sterling', 'Cardiology', 'I25.10', 'Atherosclerotic heart disease', 145, 92,
  'Robert Patterson, senior partner at Boston Legal, reports intermittent exertional angina when climbing stairs at his office on Beacon Hill. Coronary angiography at Massachusetts General Hospital revealed 75% LAD stenosis. Stent placed successfully. Maintenance regimen: Dual antiplatelet therapy with Clopidogrel 75mg daily, Aspirin 81mg daily, and Rosuvastatin 20mg QHS. Patient warned to curtail work stress.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-07'),
  '2026-02-27', 'Dr. Arshad Warsi', 'Pediatrics', 'J45.40', 'Moderate persistent asthma', 104, 68,
  '10-year-old female Farida Begum brought in by mother Shahnaz Begum from their home in Banjara Hills, Hyderabad. Child experiences nocturnal wheezing 3-4 nights per week. Spirometry shows FEV1 68% predicted with significant bronchodilator reversibility. Prescribed Fluticasone/Salmeterol 100/50 mcg diskus 1 inhalation BID and Albuterol HFA inhaler 2 puffs PRN. School nurse at Oakridge International School to be provided asthma action plan.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-08'),
  '2026-03-15', 'Dr. Oliver Finch', 'Rheumatology', 'M05.79', 'Rheumatoid arthritis with rheumatoid factor', 132, 85,
  'Prof. Alistair MacIntyre of Oxford University presents with bilateral symmetric polyarthritis affecting MCP and PIP joints. Morning stiffness lasts >90 minutes. Anti-CCP titer >250 U/mL, ESR 62 mm/hr. Diagnosed with seropositive rheumatoid arthritis. Commencing Methotrexate 15mg weekly with Folic acid 5mg weekly, plus low-dose Prednisolone 7.5mg daily bridge therapy. Co-management coordinated with the Nuffield Orthopaedic Centre.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-09'),
  '2026-04-02', 'Dr. K. Swaminathan', 'Endocrinology', 'E11.65', 'Type 2 diabetes mellitus with hyperglycemia', 138, 86,
  'Priya Sundaram (37yo bio-researcher residing in Gandhi Nagar, Chennai) reviewed for sub-optimal glycemic control. HbA1c elevated to 9.2%. Urine albumin-to-creatinine ratio shows microalbuminuria (85 mg/g). Added Empagliflozin 10mg daily and Semaglutide 0.5mg SC weekly to existing Metformin 1000mg BID. Retinal screening at Sankara Nethralaya cleared for diabetic retinopathy.'
),
(
  (SELECT patient_id FROM patients WHERE mrn = 'MRN-90210-10'),
  '2026-03-22', 'Dr. Elena Rostova', 'Infectious Disease', 'B20', 'Human immunodeficiency virus disease', 115, 75,
  'Marcus Vance, digital artist residing on Mission Street in San Francisco, attended routine follow-up. Viral load undetectable (<20 copies/mL); CD4 count 780 cells/uL (38%). Well-tolerated on single-tablet Biktarvy (Bictegravir 50mg/Emtricitabine 200mg/Tenofovir alafenamide 25mg) daily. Laboratory follow-up booked at UCSF Medical Center.'
);