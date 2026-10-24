/**
 * @fileoverview Egress Gateway Orchestrator Controller.
 * 
 * Coordinates Tier 1 deterministic masking, Tier 2 AI de-identification,
 * cryptographic audit append chaining, and optional AWS S3 archival.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { maskStructuredPatient, extractYear } = require('../services/maskingService');
const { deidentifyClinicalNote } = require('../services/aiSanitizerService');
const { uploadExportBundle } = require('../services/s3Service');
const { appendChainedAuditLog, verifyAuditChainIntegrity } = require('../services/auditService');

/**
 * Transforms an encounter record through the sanitization pipeline and logs cryptographic audit trail.
 *
 * @param {import('pg').PoolClient} client - Active transactional client.
 * @param {Object} row - Relational row combining patient and encounter data.
 * @param {Object} exportMeta - Metadata parameters identifying the egress batch.
 * @param {string} exportMeta.exportUuid - Unique batch UUID.
 * @param {string} exportMeta.requesterId - Requester identity.
 * @param {string} exportMeta.purpose - Declared clinical/research purpose.
 * @param {string} exportMeta.framework - Compliance regulatory standard.
 * @returns {Promise<Object>} De-identified clinical encounter object.
 */
const transformEncounterRow = async (client, row, exportMeta) => {
  const { sanitizedText, redactedEntities } = await deidentifyClinicalNote(row.clinical_notes);
  const sanitizedNoteHash = crypto.createHash('sha256').update(sanitizedText).digest('hex');

  await appendChainedAuditLog(client, {
    exportUuid: exportMeta.exportUuid,
    requesterId: exportMeta.requesterId,
    purpose: exportMeta.purpose,
    framework: exportMeta.framework,
    patientId: row.patient_id,
    fieldsRedacted: redactedEntities,
    aiSanitizationApplied: true,
    sanitizedNoteHash,
  });

  return {
    encounter_year: extractYear(row.encounter_date),
    department: row.department,
    icd10_code: row.icd10_code,
    diagnosis_name: row.diagnosis_name,
    systolic_bp: row.systolic_bp,
    diastolic_bp: row.diastolic_bp,
    sanitized_notes: sanitizedText,
    redactions: redactedEntities,
  };
};

/**
 * Handles HTTP POST request to export compliant patient cohort data.
 * Executes within an isolated database transaction to guarantee ledger consistency.
 *
 * @route POST /api/v1/egress/export
 * @param {import('express').Request} req - Express request object containing body parameters.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<import('express').Response>} HTTP response with compliant egress manifest.
 */
const exportPatientData = async (req, res) => {
  const { requesterId, purpose, framework, patientIds } = req.body;

  if (!requesterId || !purpose || !framework || !Array.isArray(patientIds) || !patientIds.length) {
    return res.status(400).json({ error: 'Missing or malformed egress request parameters.' });
  }

  const exportUuid = uuidv4();
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    const encounterQuery = `
      SELECT p.patient_id, p.mrn, p.full_name, p.aadhaar_hash, p.date_of_birth, p.gender,
             p.phone_number, p.email_address, p.street_address, p.city, p.state, p.postal_code,
             c.encounter_id, c.encounter_date, c.attending_physician, c.department,
             c.icd10_code, c.diagnosis_name, c.systolic_bp, c.diastolic_bp, c.clinical_notes
      FROM patients p
      LEFT JOIN clinical_encounters c ON p.patient_id = c.patient_id
      WHERE p.patient_id = ANY($1::int[])
      ORDER BY p.patient_id, c.encounter_date ASC;
    `;

    const { rows } = await dbClient.query(encounterQuery, [patientIds]);
    const manifest = new Map();

    for (const row of rows) {
      if (!manifest.has(row.patient_id)) {
        manifest.set(row.patient_id, {
          ...maskStructuredPatient(row),
          clinical_history: [],
        });
      }

      if (row.encounter_id) {
        const encounter = await transformEncounterRow(dbClient, row, {
          exportUuid,
          requesterId,
          purpose,
          framework,
        });
        manifest.get(row.patient_id).clinical_history.push(encounter);
      }
    }

    const payloadBundle = Array.from(manifest.values());
    await dbClient.query('COMMIT');

    let s3Archive = null;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET_NAME) {
      try {
        s3Archive = await uploadExportBundle(exportUuid, payloadBundle);
      } catch (err) {
        console.error('S3 archival skipped due to transport error:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      exportUuid,
      framework,
      recordCount: payloadBundle.length,
      s3Archive,
      data: payloadBundle,
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('Egress pipeline execution failure:', err);
    return res.status(500).json({ error: 'Failed to process compliant egress pipeline.' });
  } finally {
    dbClient.release();
  }
};

/**
 * Retrieves audit log records, optionally filtered by export UUID.
 *
 * @route GET /api/v1/egress/audit-logs
 * @param {import('express').Request} req - Query params: exportUuid (optional).
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<import('express').Response>}
 */
const getAuditLogs = async (req, res) => {
  const { exportUuid } = req.query;
  const dbClient = await pool.connect();

  try {
    const query = exportUuid
      ? 'SELECT * FROM egress_audit_logs WHERE export_uuid = $1 ORDER BY audit_id ASC'
      : 'SELECT * FROM egress_audit_logs ORDER BY audit_id ASC';

    const params = exportUuid ? [exportUuid] : [];
    const { rows } = await dbClient.query(query, params);

    return res.status(200).json({ count: rows.length, logs: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch audit log history.' });
  } finally {
    dbClient.release();
  }
};

/**
 * Validates the cryptographic integrity of the entire audit hash chain.
 *
 * @route GET /api/v1/egress/audit/verify
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} HTTP 200 on valid chain, HTTP 409 on tampering detection.
 */
const verifyChain = async (_req, res) => {
  const dbClient = await pool.connect();
  try {
    const report = await verifyAuditChainIntegrity(dbClient);
    return res.status(report.verified ? 200 : 409).json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Audit verification evaluation failed.' });
  } finally {
    dbClient.release();
  }
};

module.exports = {
  exportPatientData,
  getAuditLogs,
  verifyChain,
};