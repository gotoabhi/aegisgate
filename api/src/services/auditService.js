/**
 * @fileoverview Cryptographic Audit & Non-Repudiation Ledger Service.
 * 
 * Implements a Merkle-lite hash-chained append ledger for compliance logs.
 * Guarantees tamper-evident traceability under HIPAA Security Rule (§ 164.312(b))
 * and India DPDP Act audit mandates.
 */

const crypto = require('crypto');

/** @type {string} 64-character zero string representing the cryptographic genesis anchor */
const GENESIS_BLOCK_HASH = '0'.repeat(64);

/**
 * Computes a deterministic SHA-256 seal for an audit record payload.
 * 
 * Normalizes and delimits all fields to guarantee byte-for-byte reproducibility
 * between insertion time and subsequent verification passes.
 *
 * @param {Object} params
 * @param {string} params.prevHash - Hex digest of the preceding audit record or GENESIS_BLOCK_HASH.
 * @param {string} params.exportUuid - UUID identifying the export egress batch.
 * @param {string} params.requesterId - Identifier of the requesting research/CRO entity.
 * @param {string} params.purpose - Declared clinical or research justification (DPDP Sec 6/7).
 * @param {string} params.framework - Active regulatory framework (e.g., 'HIPAA_SAFE_HARBOR').
 * @param {number|string} params.patientId - Database identifier for the subject record.
 * @param {string} params.sanitizedNoteHash - SHA-256 digest of the de-identified clinical text.
 * @param {string} params.timestamp - ISO 8601 UTC timestamp of record creation.
 * @returns {string} 64-character SHA-256 hexadecimal hash string.
 */
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

/**
 * Appends a chained, tamper-evident audit record within an active database transaction.
 * 
 * Enforces an exclusive pessimistic lock (`SELECT ... FOR UPDATE`) on the head row
 * to serialize concurrent egress requests and prevent hash-chain bifurcation.
 *
 * @param {import('pg').PoolClient} client - An active PostgreSQL transaction client.
 * @param {Object} entry - Audit metadata and redaction telemetry.
 * @param {string} entry.exportUuid - Unique batch egress identifier.
 * @param {string} entry.requesterId - Identity of the egress caller.
 * @param {string} entry.purpose - Specific business or research purpose.
 * @param {string} entry.framework - Target compliance standard.
 * @param {number} entry.patientId - Internal ID of the exported patient.
 * @param {Array<Object>} entry.fieldsRedacted - Array of redaction telemetry items.
 * @param {boolean} entry.aiSanitizationApplied - Flag indicating Tier 2 AI involvement.
 * @param {string} entry.sanitizedNoteHash - SHA-256 seal of the scrubbed clinical notes.
 * @returns {Promise<{audit_id: number, record_hash: string}>} Inserted row identifier and computed hash.
 * @throws {Error} Propagates query or transactional failures.
 */
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

  // Lock the latest audit record to prevent race conditions during concurrent egress batches
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

/**
 * Traverses the complete audit ledger from genesis to head, verifying chain continuity and payload fidelity.
 *
 * Checks two fundamental cryptographic invariants per block:
 * 1. Current block's `prev_hash` strictly equals previous block's `record_hash`.
 * 2. Re-computed hash of current payload fields matches stored `record_hash`.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} client - Database connection instance.
 * @returns {Promise<{verified: boolean, chainLength: number, headHash?: string, tamperedAuditId?: number, reason?: string, message?: string}>}
 */
const verifyAuditChainIntegrity = async (client) => {
  // Query ISO string deterministically in UTC via SQL to prevent Node.js Date formatting drift
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
        reason: `Broken chain pointer at audit record ${row.audit_id}. Expected prev_hash '${expectedPrevHash}', encountered '${row.prev_hash}'.`,
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