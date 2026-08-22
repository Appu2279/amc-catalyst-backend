// =============================================
// config/cloudinary.js
// =============================================
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

// Checked rather than assumed: the notes routes are mounted whether or not
// these are set, and a missing key would otherwise surface as an opaque 401
// from Cloudinary at stream time instead of a clear error at startup.
export const isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

/**
 * A signed CDN delivery URL for a private ("authenticated") raw asset.
 *
 * Notes are uploaded with type: 'authenticated', so the plain secure_url 401s
 * without a signature. This mints a signed one, which the backend uses
 * server-side to fetch the file and stream it on to the browser. The signed URL
 * itself is never sent to the client.
 *
 * NOT private_download_url, which was the obvious choice and is what this used
 * first. That endpoint regenerates the file on Cloudinary's API servers on every
 * call and is not CDN-cached: measured at a consistent ~10s for a 3MB note,
 * against ~300ms warm / ~2s cold for the signed delivery URL below. Every note
 * open paid that cost.
 *
 * The version is included when known, so replacing a note's PDF changes the URL
 * and the CDN serves the new bytes instead of the cached old ones.
 *
 * Trade-off worth knowing: unlike private_download_url, this signature does not
 * expire — Cloudinary ignores expires_at on delivery URLs for this asset type.
 * That is acceptable only because the URL is used server-side and never reaches
 * a browser. If it is ever exposed to a client, this must change.
 */
export const signedNoteUrl = (publicId, fileUrl) => {
  const version = /\/v(\d+)\//.exec(fileUrl || '')?.[1];

  return cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
    sign_url: true,
    secure: true,
    ...(version ? { version } : {}),
  });
};

/**
 * Uploads a buffer as a private raw asset.
 *
 * A stream rather than uploader.upload(path): the admin UI hands us bytes held
 * in memory by multer, and writing them to a temp file first would leave
 * unencrypted copies of paid content on the server's disk whenever a request
 * failed midway.
 */
export const uploadNoteBuffer = (buffer, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'raw',
        type: 'authenticated',
        overwrite: true,
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });

export const destroyNoteAsset = (publicId) =>
  cloudinary.uploader.destroy(publicId, { resource_type: 'raw', type: 'authenticated' });

export default cloudinary;
