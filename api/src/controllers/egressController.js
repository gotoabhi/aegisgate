const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { maskStructuredPatient } = require('../services/maskingService');
const { deidentifyClinicalNote } = require('../services/aiSanitizerService');
const { uploadExportBundle } = require('../services/s3Service');
const { appendChainedAuditLog, verifyAuditChainIntegrity } = require('../services/auditService');

async function exportPatientData(req, res) {
  const { requesterId, purpose, framework, patientIds } = req.body;

  if (!requesterId || !purpose || !framework || !Array.isArray(patientIds) || patientIds.length === 0) {
    return res.status(400).json({ error: 'Missing required egress parameters.' });
  }

  const exportUuid = uuidv4();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const selectQuery = `
      SELECT p.patient_id, p.mrn, p.full_name, p.aadhaar_hash, p.date_of_birth, p.gender,
             p.phone_number, p.email_address, p.street_address, p.city, p.state, p.postal_code,
             c.encounter_id, c.encounter_date, c.attending_physician, c.department,
             c.icd10_code, c.diagnosis_name, c.systolic_bp, c.diastolic_bp, c.clinical_notes
      FROM patients p
      LEFT JOIN clinical_encounters c ON p.patient_id = c.patient_id
      WHERE p.patient_id = ANY($1::int[])
      ORDER BY p.patient_id, c.encounter_date ASC;
    `;

    const { rows } = await client.query(selectQuery, [patientIds]);
    const grouped = {};

    for (const row of rows) {
      if (!grouped[row.patient_id]) {
        grouped[row.patient_id] = {
          patient: maskStructuredPatient(row),
          encounters: [],
        };
      }

      if (row.encounter_id) {
        // AI Tier Redaction
        const aiResult = await deidentifyClinicalNote(row.clinical_notes);
        const sanitizedNoteHash = crypto.createHash('sha256').update(aiResult.sanitizedText).digest('hex');

        // Cryptographic Audit Row Chaining
        await appendChainedAuditLog(client, {
          exportUuid,
          requesterId,
          purpose,
          framework,
          patientId: row.patient_id,
          fieldsRedacted: aiResult.redactedEntities || [],
          aiSanitizationApplied: true,
          sanitizedNoteHash,
        });

        grouped[row.patient_id].encounters.push({
          encounter_year: new Date(row.encounter_date).getUTCFullYear().toString(),
          department: row.department,
          icd10_code: row.icd10_code,
          diagnosis_name: row.diagnosis_name,
          systolic_bp: row.systolic_bp,
          diastolic_bp: row.diastolic_bp,
          sanitized_notes: aiResult.sanitizedText,
          redactions: aiResult.redactedEntities,
        });
      }
    }

    const sanitizedBundle = Object.values(grouped).map((item) => ({
      ...item.patient,
      clinical_history: item.encounters,
    }));

    await client.query('COMMIT');

    // S3 Cloud Archival
    let s3Archive = null;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET_NAME) {
      try {
        s3Archive = await uploadExportBundle(exportUuid, sanitizedBundle);
      } catch (s3Error) {
        console.error('[AWS S3 Error] Failed to archive export:', s3Error.message);
      }
    }

    return res.status(200).json({
      success: true,
      exportUuid,
      framework,
      recordCount: sanitizedBundle.length,
      s3Archive,
      data: sanitizedBundle,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Export Pipeline Failure:', error);
    return res.status(500).json({ error: 'Egress pipeline processing failed', details: error.message });
  } finally {
    client.release();
  }
}

async function getAuditLogs(req, res) {
  const { exportUuid } = req.query;
  const client = await pool.connect();
  try {
    let query = 'SELECT * FROM egress_audit_logs';
    const params = [];
    if (exportUuid) {
      query += ' WHERE export_uuid = $1';
      params.push(exportUuid);
    }
    query += ' ORDER BY audit_id ASC;';
    const { rows } = await client.query(query, params);
    return res.status(200).json({ count: rows.length, logs: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve logs', details: err.message });
  } finally {
    client.release();
  }
}

async function verifyChain(req, res) {
  const client = await pool.connect();
  try {
    const report = await verifyAuditChainIntegrity(client);
    const status = report.verified ? 200 : 409;
    return res.status(status).json(report);
  } catch (err) {
    console.error('Chain verification error:', err);
    return res.status(500).json({ error: 'Verification failed', details: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  exportPatientData,
  getAuditLogs,
  verifyChain,
};