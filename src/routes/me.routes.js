import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { uploadAvatar } from '../middleware/uploadMiddleware.js';
import {
  getMyAccess,
  getMyProfile,
  updateMyProfile,
  uploadMyAvatar,
  deleteMyAvatar,
  streamMyAvatar,
} from '../controllers/me.controller.js';
import { getMyReferral } from '../controllers/referral.controller.js';

const router = Router();

// Everything under /api/me is about the caller's own account, so the token is
// required for the whole router rather than route by route.
router.use(verifyToken);

router.get('/access', getMyAccess);
router.get('/referral', getMyReferral);

router.get('/avatar', streamMyAvatar);
router.post('/avatar', uploadAvatar, uploadMyAvatar);
router.delete('/avatar', deleteMyAvatar);

router.get('/', getMyProfile);
router.patch('/', updateMyProfile);

export default router;
