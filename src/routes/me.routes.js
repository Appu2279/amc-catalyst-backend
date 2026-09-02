import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getMyAccess } from '../controllers/me.controller.js';

const router = Router();

// Everything under /api/me is about the caller's own account, so the token is
// required for the whole router rather than route by route.
router.use(verifyToken);

router.get('/access', getMyAccess);

export default router;
