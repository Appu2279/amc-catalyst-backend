import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { getObjectBuffer, isStorageConfigured } from '../config/storage.js';

const router = Router();

/**
 * GET /api/images/question?key=question-images/<uuid>.<ext>
 *
 * Streams a question figure stored on the private S3 bucket by the import
 * service. The key is opaque (a UUID) and constrained to the question-images/
 * prefix, so this cannot be used to read anything else in the bucket. Any
 * signed-in user may fetch — the figure is only meaningful next to its question,
 * which has its own entitlement check.
 */
router.get('/question', verifyToken, async (req, res) => {
  const key = String(req.query.key || '');
  if (!/^question-images\/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/.test(key)) {
    return res.status(400).json({ message: 'Invalid image key' });
  }
  if (!isStorageConfigured) {
    return res.status(503).json({ message: 'File storage is not configured on this server' });
  }

  let object;
  try {
    object = await getObjectBuffer(key);
  } catch (err) {
    return res.status(404).json({ message: 'Image not found' });
  }

  res.set({
    'Content-Type': object.contentType || 'image/png',
    'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(object.buffer);
});

/**
 * GET /api/images/proxy?url=<encoded-image-url>
 *
 * Authenticated image proxy — streams any internal image through the backend
 * so the raw storage URL is never exposed to the client.
 *
 * Security properties:
 *   • Requires a valid JWT → unauthenticated users get 401
 *   • Cache-Control: no-store  → browser never caches to disk
 *   • Content-Disposition: inline → browser can't be tricked into "Save as"
 *   • Only proxies http/https URLs (no file:// etc.)
 *   • Response headers strip X-Frame-Options/CSP from origin to avoid leaks
 */
router.get('/proxy', verifyToken, (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ message: 'url query param required' });

  let parsed;
  try {
    parsed = new URL(decodeURIComponent(raw));
  } catch {
    return res.status(400).json({ message: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ message: 'Only http/https URLs are allowed' });
  }

  const lib = parsed.protocol === 'https:' ? https : http;

  const proxyReq = lib.get(parsed.toString(), (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'image/jpeg';

    // Only proxy image content types
    if (!contentType.startsWith('image/')) {
      proxyRes.resume();
      return res.status(400).json({ message: 'URL does not point to an image' });
    }

    res.set({
      'Content-Type':        contentType,
      'Cache-Control':       'no-store, no-cache, must-revalidate',
      'Pragma':              'no-cache',
      'Content-Disposition': 'inline',
      // Strip headers that leak storage origin
      'X-Content-Type-Options': 'nosniff',
    });

    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => res.status(502).json({ message: 'Failed to fetch image' }));
  proxyReq.setTimeout(10_000, () => {
    proxyReq.destroy();
    res.status(504).json({ message: 'Image fetch timed out' });
  });
});

export default router;
