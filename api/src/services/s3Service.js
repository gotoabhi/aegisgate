/**
 * @fileoverview Secure Cloud Archival & Ephemeral Egress Distribution Service.
 * 
 * Uploads de-identified bundles to private S3 buckets utilizing SSE-S3 (AES-256)
 * and generates short-lived presigned URLs for safe clinical research distribution.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Serializes, encrypts, and uploads an egress manifest to Amazon S3.
 * Automatically issues a 1-hour expiring presigned GET URL for recipient download.
 *
 * @param {string} exportUuid - Unique identifier for the egress batch.
 * @param {Array<Object>} exportData - De-identified patient manifest data array.
 * @returns {Promise<{s3Key: string, presignedUrl: string}>} S3 key and presigned download URL.
 * @throws {Error} Thrown if S3 upload or presigner generation fails.
 */
const uploadExportBundle = async (exportUuid, exportData) => {
  const s3Key = `exports/${exportUuid}.json`;
  const serializedBody = JSON.stringify(exportData, null, 2);

  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: serializedBody,
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  });

  await s3Client.send(putCommand);

  // Issue temporary presigned URL expiring in 3600 seconds (1 hour)
  const getCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

  return {
    s3Key,
    presignedUrl,
  };
};

module.exports = {
  uploadExportBundle,
};