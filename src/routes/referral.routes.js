import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  getOverview,
  listReferrals,
  updateConfig,
  listCodes,
  createPartnerCode,
  updateCode,
  listRewards,
  markRewardPaid,
} from '../controllers/referral.controller.js';

// Mounted at /api/admin/referrals — the whole router is admin-only. The one
// user-facing endpoint (GET /api/me/referral) lives on the me router instead.
const router = Router();

router.use(verifyToken, isAdmin);

router.get('/overview', getOverview);
router.put('/config', updateConfig);

router.get('/', listReferrals);

router.get('/codes', listCodes);
router.post('/codes', createPartnerCode);
router.patch('/codes/:id', updateCode);

router.get('/rewards', listRewards);
router.post('/rewards/:id/pay', markRewardPaid);

export default router;
