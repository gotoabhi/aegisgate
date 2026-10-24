const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadExportBundle(exportUuid, payload) {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  const key = `exports/${exportUuid}.json`;

  // 1. Upload to S3 with standard SSE-S3 AES-256 encryption (Free Tier eligible)
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: JSON.stringify(payload, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  });

  await s3Client.send(putCommand);

  // 2. Generate temporary presigned download URL valid for 3600 seconds (1 hour)
  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

  return { s3Key: key, presignedUrl };
}

module.exports = { uploadExportBundle };