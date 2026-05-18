import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { listPublishedTests, getTestInfo, startAttempt } from '../controllers/attempt.controller.js';

const router = Router();

router.get('/', listPublishedTests);
router.get('/:id', getTestInfo);
router.post('/:id/start', verifyToken, startAttempt);

export default router;
