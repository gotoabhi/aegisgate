const crypto = require('crypto');

const HMAC_SECRET = process.env.PSEUDONYMIZATION_KEY || 'default-fallback-dev-key';

const pseudonymizeIdentifier = (value) => {
  if (!value) return null;
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(String(value).trim())
    .digest('hex');
};

const extractYear = (dateInput) => {
  if (!dateInput) return null;
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear().toString();
};

const maskStructuredPatient = (patient) => {
  if (!patient) return null;

  return {
    pseudonymized_id: pseudonymizeIdentifier(patient.mrn),
    birth_year: extractYear(patient.date_of_birth),
    gender: patient.gender,
    state: patient.state,
  };
};

module.exports = {
  pseudonymizeIdentifier,
  extractYear,
  maskStructuredPatient,
};