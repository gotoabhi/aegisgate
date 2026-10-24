const crypto = require('crypto');

const SALT = process.env.PSEUDO_SALT || 'aegisgate-default-salt-2026';

function hashIdentifier(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(`${SALT}:${value}`).digest('hex').substring(0, 16);
}

function truncateToYear(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.getFullYear();
}

function maskStructuredPatient(rawPatient) {
  return {
    pseudoId: hashIdentifier(rawPatient.mrn),
    birthYear: truncateToYear(rawPatient.date_of_birth),
    gender: rawPatient.gender,
    state: rawPatient.state, // State level retained under HIPAA Safe Harbor
    clinicalEncounter: {
      encounterYear: truncateToYear(rawPatient.encounter_date),
      department: rawPatient.department,
      icd10Code: rawPatient.icd10_code,
      diagnosis: rawPatient.diagnosis_name,
      vitals: {
        systolicBp: rawPatient.systolic_bp,
        diastolicBp: rawPatient.diastolic_bp,
      },
    },
  };
}

module.exports = {
  hashIdentifier,
  truncateToYear,
  maskStructuredPatient,
};