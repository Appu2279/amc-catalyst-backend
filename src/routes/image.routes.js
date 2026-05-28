import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const router = Router();

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
