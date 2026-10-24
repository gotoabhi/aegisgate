const crypto = require('crypto');

// Standard 64-character zero string representing the genesis block
const GENESIS_HASH = '0'.repeat(64);

/**
 * Computes deterministic SHA-256 record hash.
 * All fields are coerced to trimmed strings to guarantee byte-for-byte reproducibility.
 */
function computeRecordHash({
  prevHash,
  exportUuid,
  requesterId,
  purpose,
  framework,
  patientId,
  sanitizedNoteHash,
  timestamp,
}) {
  const payload = [
    String(prevHash).trim(),
    String(exportUuid).trim(),
    String(requesterId).trim(),
    String(purpose).trim(),
    String(framework).trim(),
    String(patientId).trim(),
    String(sanitizedNoteHash).trim(),
    String(timestamp).trim(),
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Appends a chained, tamper-evident audit row inside an active DB transaction.
 */
async function appendChainedAuditLog(client, {
  exportUuid,
  requesterId,
  purpose,
  framework,
  patientId,
  fieldsRedacted,
  aiSanitizationApplied,
  sanitizedNoteHash,
}) {
  // Lock the latest row to safely handle concurrent exports
  const lastRowResult = await client.query(`
    SELECT record_hash 
    FROM egress_audit_logs 
    ORDER BY audit_id DESC 
    LIMIT 1 
    FOR UPDATE
  `);

  const prevHash =
    lastRowResult.rows.length > 0 && lastRowResult.rows[0].record_hash
      ? lastRowResult.rows[0].record_hash
      : GENESIS_HASH;

  // Use fixed ISO timestamp without sub-millisecond drift
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

  const insertQuery = `
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
    JSON.stringify(fieldsRedacted),
    aiSanitizationApplied,
    sanitizedNoteHash,
    prevHash,
    recordHash,
    timestamp,
  ];

  const res = await client.query(insertQuery, values);
  return res.rows[0];
}

/**
 * Traverses audit log from genesis to head and verifies cryptographic continuity.
 */
async function verifyAuditChainIntegrity(client) {
  // Query ISO string directly via PostgreSQL to avoid Node.js Date timezone/millisecond conversion drift
  const result = await client.query(`
    SELECT audit_id, export_uuid, requester_id, purpose, compliance_framework,
           patient_id, sanitized_note_hash, prev_hash, record_hash,
           to_char(exported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS formatted_ts
    FROM egress_audit_logs
    ORDER BY audit_id ASC
  `);

  const logs = result.rows;
  if (logs.length === 0) {
    return { verified: true, chainLength: 0, message: 'Audit ledger is empty.' };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < logs.length; i++) {
    const row = logs[i];

    // Check 1: Does row's prev_hash match previous row's record_hash?
    if (row.prev_hash !== expectedPrevHash) {
      return {
        verified: false,
        tamperedAuditId: row.audit_id,
        reason: `Broken chain link at audit_id ${row.audit_id}. Expected prev_hash '${expectedPrevHash}', found '${row.prev_hash}'.`,
      };
    }

    // Check 2: Recalculate hash of row data using PostgreSQL's stored timestamp
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
        reason: `Data tampering detected at audit_id ${row.audit_id}. Payload hash mismatch.`,
      };
    }

    expectedPrevHash = row.record_hash;
  }

  return {
    verified: true,
    chainLength: logs.length,
    headHash: expectedPrevHash,
    message: 'Cryptographic chain verification passed. Zero tampering detected.',
  };
}

module.exports = {
  appendChainedAuditLog,
  verifyAuditChainIntegrity,
};