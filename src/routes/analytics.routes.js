import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getSummary, getSubjectPerformance, getHistory, getWeakTopics } from '../controllers/analytics.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/summary', getSummary);
router.get('/subjects', getSubjectPerformance);
router.get('/weak-topics', getWeakTopics);
router.get('/history', getHistory);

export default router;
