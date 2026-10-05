import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listUsers,
  getUser,
  banUser,
  unbanUser,
  removeUser,
  restoreUser,
  grantPlan,
  revokeSubscription,
  extendSubscription,
  changePlan,
  exportPaidUsersCsv,
} from '../controllers/adminUser.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

// ── Accounts ──────────────────────────────────────────────────────────────────
router.get('/', listUsers);
// Before '/:id' so "export" is not read as a user id.
router.get('/export/paid.csv', exportPaidUsersCsv);
router.get('/:id', getUser);
router.post('/:id/ban', banUser);
router.post('/:id/unban', unbanUser);
router.delete('/:id', removeUser);
router.post('/:id/restore', restoreUser);

// ── Plans ─────────────────────────────────────────────────────────────────────
router.post('/:id/subscriptions', grantPlan);
router.post('/subscriptions/:subscriptionId/revoke', revokeSubscription);
router.post('/subscriptions/:subscriptionId/extend', extendSubscription);
router.post('/subscriptions/:subscriptionId/change-plan', changePlan);

export default router;
