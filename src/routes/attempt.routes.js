import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getAttempt, submitAnswer, submitAttempt, getResult } from '../controllers/attempt.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/:id', getAttempt);
router.post('/:id/answer', submitAnswer);
router.post('/:id/submit', submitAttempt);
router.get('/:id/result', getResult);

export default router;
