const crypto = require('crypto');

const GENESIS_BLOCK_HASH = '0'.repeat(64);

const computeRecordHash = (params) => {
  const {
    prevHash,
    exportUuid,
    requesterId,
    purpose,
    framework,
    patientId,
    sanitizedNoteHash,
    timestamp,
  } = params;

  const payload = [
    prevHash,
    exportUuid,
    requesterId,
    purpose,
    framework,
    patientId,
    sanitizedNoteHash,
    timestamp,
  ]
    .map((val) => String(val ?? '').trim())
    .join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
};

const appendChainedAuditLog = async (client, entry) => {
  const {
    exportUuid,
    requesterId,
    purpose,
    framework,
    patientId,
    fieldsRedacted,
    aiSanitizationApplied,
    sanitizedNoteHash,
  } = entry;

  // Prevent concurrency bifurcations across parallel egress exports
  const { rows } = await client.query(
    'SELECT record_hash FROM egress_audit_logs ORDER BY audit_id DESC LIMIT 1 FOR UPDATE'
  );

  const prevHash = rows[0]?.record_hash || GENESIS_BLOCK_HASH;
  const timestamp = new Date().toISOString();

  const recordHash = computeRecordHash({
    prevHash,
    exportUuid,
    requesterId,
    purpose,
    framework,
    patientId,
    sanitizedNoteHash,
    timestamp,
  });

  const query = `
    INSERT INTO egress_audit_logs (
      export_uuid, requester_id, purpose, compliance_framework,
      patient_id, fields_redacted, ai_sanitization_applied,
      sanitized_note_hash, prev_hash, record_hash, exported_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
    RETURNING audit_id, record_hash;
  `;

  const values = [
    exportUuid,
    requesterId,
    purpose,
    framework,
    patientId,
    JSON.stringify(fieldsRedacted || []),
    Boolean(aiSanitizationApplied),
    sanitizedNoteHash,
    prevHash,
    recordHash,
    timestamp,
  ];

  const result = await client.query(query, values);
  return result.rows[0];
};

const verifyAuditChainIntegrity = async (client) => {
  // Query deterministic UTC formatted ISO string to avoid Node Date rounding discrepancies
  const { rows } = await client.query(`
    SELECT audit_id, export_uuid, requester_id, purpose, compliance_framework,
           patient_id, sanitized_note_hash, prev_hash, record_hash,
           to_char(exported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS formatted_ts
    FROM egress_audit_logs
    ORDER BY audit_id ASC
  `);

  if (!rows.length) {
    return { verified: true, chainLength: 0, message: 'Ledger is empty.' };
  }

  let expectedPrevHash = GENESIS_BLOCK_HASH;

  for (const row of rows) {
    if (row.prev_hash !== expectedPrevHash) {
      return {
        verified: false,
        tamperedAuditId: row.audit_id,
        reason: `Broken chain pointer at audit record ${row.audit_id}.`,
      };
    }

    const calculatedHash = computeRecordHash({
      prevHash: row.prev_hash,
      exportUuid: row.export_uuid,
      requesterId: row.requester_id,
      purpose: row.purpose,
      framework: row.compliance_framework,
      patientId: row.patient_id,
      sanitizedNoteHash: row.sanitized_note_hash,
      timestamp: row.formatted_ts,
    });

    if (calculatedHash !== row.record_hash) {
      return {
        verified: false,
        tamperedAuditId: row.audit_id,
        reason: `Cryptographic payload mismatch at audit record ${row.audit_id}.`,
      };
    }

    expectedPrevHash = row.record_hash;
  }

  return {
    verified: true,
    chainLength: rows.length,
    headHash: expectedPrevHash,
    message: 'Chain verified intact.',
  };
};

module.exports = {
  computeRecordHash,
  appendChainedAuditLog,
  verifyAuditChainIntegrity,
};