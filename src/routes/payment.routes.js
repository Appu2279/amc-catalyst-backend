import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import { uploadScreenshot } from '../middleware/uploadMiddleware.js';
import {
  startClaim,
  submitClaim,
  listMyClaims,
  listClaims,
  getClaim,
  approveClaim,
  rejectClaim,
  streamScreenshot,
} from '../controllers/payment.controller.js';

const router = Router();

// Everything here concerns money and is tied to an identity, so nothing is
// reachable anonymously.
router.use(verifyToken);

// ── User ──────────────────────────────────────────────────────────────────────

// Opened when the buyer reaches the QR page, not when they say they paid: the
// reference code has to be on screen before the transfer, so that a payment can
// be matched to a person from the bank statement alone.
router.post('/', startClaim);

// Declared before '/:id' so 'mine' is never read as a claim id.
router.get('/mine', listMyClaims);

router.post('/:id/submit', uploadScreenshot, submitClaim);

// ── Admin ─────────────────────────────────────────────────────────────────────

router.get('/admin', isAdmin, listClaims);
router.get('/admin/:id', isAdmin, getClaim);
router.get('/admin/:id/screenshot', isAdmin, streamScreenshot);
router.post('/admin/:id/approve', isAdmin, approveClaim);
router.post('/admin/:id/reject', isAdmin, rejectClaim);

export default router;
