const crypto = require('crypto');
const pool = require('../config/db');
const { maskStructuredPatient, hashIdentifier } = require('../services/maskingService');
const { deidentifyClinicalNote } = require('../services/aiSanitizerService');

async function exportPatientData(req, res) {
  const client = await pool.connect();
  try {
    const { requesterId, purpose, framework = 'HIPAA_SAFE_HARBOR', patientIds } = req.body;

    if (!requesterId || !purpose) {
      return res.status(400).json({
        error: 'Missing required parameters: requesterId and purpose are mandatory.',
      });
    }

    const exportUuid = crypto.randomUUID();

    // Query patients and encounters
    let query = `
      SELECT 
        p.patient_id, p.mrn, p.full_name, p.aadhaar_hash, p.date_of_birth,
        p.gender, p.phone_number, p.email_address, p.street_address,
        p.city, p.state, p.postal_code,
        e.encounter_id, e.encounter_date, e.attending_physician,
        e.department, e.icd10_code, e.diagnosis_name,
        e.systolic_bp, e.diastolic_bp, e.clinical_notes
      FROM patients p
      JOIN clinical_encounters e ON p.patient_id = e.patient_id
    `;
    const params = [];

    if (Array.isArray(patientIds) && patientIds.length > 0) {
      query += ` WHERE p.patient_id = ANY($1)`;
      params.push(patientIds);
    }
    query += ` ORDER BY p.patient_id ASC;`;

    const result = await client.query(query, params);
    const sanitizedBundle = [];

    await client.query('BEGIN');

    for (const record of result.rows) {
      // 1. Deterministic Scrubbing
      const maskedRecord = maskStructuredPatient(record);

      // 2. AI Unstructured Note Redaction
      const aiResult = await deidentifyClinicalNote(record.clinical_notes, framework);
      maskedRecord.clinicalEncounter.sanitizedClinicalNotes = aiResult.sanitizedText;

      const fieldsRedacted = {
        fullName: 'STRIPPED',
        mrn: `HASHED -> ${maskedRecord.pseudoId}`,
        aadhaarHash: 'STRIPPED',
        contactInfo: ['phone_number', 'email_address'],
        geographicSubState: ['street_address', 'city', 'postal_code'],
        dateOfBirth: 'TRUNCATED_TO_YEAR',
        unstructuredRedactions: aiResult.redactedEntities,
      };

      const noteChecksum = crypto
        .createHash('sha256')
        .update(aiResult.sanitizedText)
        .digest('hex');

      // 3. Write Immutable Audit Trail
      const auditQuery = `
        INSERT INTO egress_audit_logs 
        (export_uuid, requester_id, purpose, compliance_framework, patient_id, fields_redacted, ai_sanitization_applied, sanitized_note_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      await client.query(auditQuery, [
        exportUuid,
        requesterId,
        purpose,
        framework,
        record.patient_id,
        JSON.stringify(fieldsRedacted),
        true,
        noteChecksum,
      ]);

      sanitizedBundle.push(maskedRecord);
    }

    await client.query('COMMIT');

    // Archive to AWS S3 & generate secure download URL
    let s3Archive = null;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET_NAME) {
        try {
            s3Archive = await uploadExportBundle(exportUuid, sanitizedBundle);
        } catch (s3Error) {
            console.error('[AWS S3 Error] Failed to archive export:', s3Error.message);
            // Optional: Log warning without failing the entire request, or surface to auditor
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
    console.error('Export Error:', error);
    return res.status(500).json({
      error: 'Data egress pipeline failed',
      details: error.message,
    });
  } finally {
    client.release();
  }
}

async function getAuditLogs(req, res) {
  const client = await pool.connect();
  try {
    const { exportUuid } = req.query;
    let query = `
      SELECT audit_id, export_uuid, requester_id, purpose, compliance_framework, 
             patient_id, fields_redacted, ai_sanitization_applied, sanitized_note_hash, exported_at
      FROM egress_audit_logs
    `;
    const params = [];

    if (exportUuid) {
      query += ` WHERE export_uuid = $1`;
      params.push(exportUuid);
    }

    query += ` ORDER BY exported_at DESC LIMIT 50;`;

    const result = await client.query(query, params);
    return res.status(200).json({
      success: true,
      count: result.rows.length,
      logs: result.rows,
    });
  } catch (error) {
    console.error('Audit query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve audit logs', details: error.message });
  } finally {
    client.release();
  }
}

module.exports = { exportPatientData };
module.exports = { exportPatientData, getAuditLogs };
const { uploadExportBundle } = require('../services/s3Service');