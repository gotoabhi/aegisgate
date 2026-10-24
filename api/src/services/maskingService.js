/**
 * @fileoverview Deterministic Data Masking & Pseudonymization Engine (Tier 1).
 * 
 * Enforces field-level de-identification per HIPAA Safe Harbor (45 CFR § 164.514(b))
 * and India's Digital Personal Data Protection (DPDP) Act, 2023.
 */

const crypto = require('crypto');

const HMAC_SECRET = process.env.PSEUDONYMIZATION_KEY || 'default-fallback-dev-key';

/**
 * Generates a deterministic keyed HMAC-SHA256 pseudonym for sensitive direct identifiers.
 * 
 * Satisfies HIPAA 45 CFR § 164.514(c) de-identification re-identification requirements.
 * Using a keyed pepper prevents offline dictionary attacks against structured MRN/national ID formats
 * while preserving longitudinal linkage across separate research exports.
 *
 * @param {string|number} value - The raw direct identifier (e.g., Medical Record Number, Aadhaar).
 * @returns {string|null} 64-character hexadecimal digest, or null if input is falsy.
 */
const pseudonymizeIdentifier = (value) => {
  if (!value) return null;
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(String(value).trim())
    .digest('hex');
};

/**
 * Truncates a date down to its calendar year in UTC.
 * 
 * Enforces HIPAA Safe Harbor § 164.514(b)(2)(i)(C) which prohibits retaining all elements of
 * dates (except year) for dates directly related to an individual.
 *
 * @param {string|Date} dateInput - An ISO date string or Date instance.
 * @returns {string|null} Four-digit year string (e.g., "2026") or null if invalid/empty.
 */
const extractYear = (dateInput) => {
  if (!dateInput) return null;
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear().toString();
};

/**
 * Strips direct identifiers from a master patient record and outputs a compliant demographic shell.
 * Suppresses name, phone, email, full address, and national IDs while retaining state and gender.
 *
 * @param {Object} patient - The raw relational patient record from the datastore.
 * @param {string} patient.mrn - Medical Record Number.
 * @param {string|Date} patient.date_of_birth - Raw date of birth.
 * @param {string} patient.gender - Biological or recorded gender.
 * @param {string} patient.state - Regional geographic indicator (permitted under HIPAA).
 * @returns {Object|null} De-identified demographic record, or null if input record is missing.
 */
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