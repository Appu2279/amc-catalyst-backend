import { Router } from 'express';
import { verifyToken, attachUserIfPresent } from '../middleware/authMiddleware.js';
import {
  getCurrentExam, startExam, getMyAttempt, saveAnswer, submitExam, getMyResult,
  listPublishedResults, getPublicResults,
} from '../controllers/liveExam.controller.js';

const router = Router();

// Public — the nav asks before sign-in, and published results are for everyone.
router.get('/current', attachUserIfPresent, getCurrentExam);
router.get('/results', listPublishedResults);
router.get('/results/:slug', getPublicResults);

// Sitting the exam: any signed-in student, no plan needed.
router.post('/:id/start', verifyToken, startExam);
router.get('/:id/attempt', verifyToken, getMyAttempt);
router.post('/:id/answer', verifyToken, saveAnswer);
router.post('/:id/submit', verifyToken, submitExam);
router.get('/:id/my-result', verifyToken, getMyResult);

export default router;
