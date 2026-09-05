// =============================================
// config/storage.js
// =============================================
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const region = process.env.AWS_REGION?.trim();
const bucket = process.env.S3_BUCKET?.trim();

// Credentials are deliberately not checked here. Locally they come from
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env; in production the EC2
// instance role supplies them via instance metadata and no keys exist in the
// environment at all. The SDK's default credential chain resolves either case
// on its own — this file only needs to know where to write.
export const isStorageConfigured = Boolean(region && bucket);

const s3 = isStorageConfigured ? new S3Client({ region }) : null;

/**
 * Uploads a buffer as a private object at the given key.
 *
 * No ACL is set — the bucket blocks all public access at the bucket level, so
 * every object is private by default. Nothing here needs Cloudinary's
 * `authenticated` asset type or a signed delivery URL: the key itself is never
 * handed to a browser (see note.service.js's PUBLIC_ATTRIBUTES), and reading
 * an object back is a plain, unsigned GetObject call made server-side with the
 * role's/user's own credentials.
 */
const putObject = async (buffer, key, contentType) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return { key, bytes: buffer.length };
};

export const uploadNoteBuffer = (buffer, key) => putObject(buffer, key, 'application/pdf');

export const uploadPaymentScreenshot = (buffer, key, contentType) =>
  putObject(buffer, key, contentType);

export const uploadAvatar = (buffer, key, contentType) =>
  putObject(buffer, key, contentType);

/**
 * Fetches a private object's bytes and content type.
 *
 * Replaces the signed-URL-plus-redirect-following dance that Cloudinary
 * needed (see the removed fetchFollowing in note.controller.js): the SDK talks
 * to S3 directly and hands back a Node Readable stream, no redirects and no
 * expiring signature to reason about.
 */
export const getObjectBuffer = async (key) => {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), contentType: result.ContentType };
};

export const destroyObject = (key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
