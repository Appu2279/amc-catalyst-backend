import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  adminListQuestions, adminGetQuestion, createQuestion, updateQuestion, deleteQuestion, toggleQuestion, toggleQuestionFree,
  listQuestions, getQuestion, checkAnswer, getPracticeProgress, resetPracticeProgress,
  listQuestionBatches,
} from '../controllers/question.controller.js';

const router = Router();

// Admin routes
router.get('/admin', verifyToken, isAdmin, adminListQuestions);
router.get('/admin/:id', verifyToken, isAdmin, adminGetQuestion);
router.post('/admin', verifyToken, isAdmin, createQuestion);
router.put('/admin/:id', verifyToken, isAdmin, updateQuestion);
router.delete('/admin/:id', verifyToken, isAdmin, deleteQuestion);
router.patch('/admin/:id/toggle', verifyToken, isAdmin, toggleQuestion);
// Marks a question as a free sample, visible to students without a plan.
router.patch('/admin/:id/free', verifyToken, isAdmin, toggleQuestionFree);

// Student routes — signed in only. The question bank is the paid product, so it
// is never served anonymously; responses omit is_correct and explanation.
// Declared before '/:id' so that "progress" is never read as a question id.
router.get('/batches', verifyToken, listQuestionBatches);
router.get('/progress', verifyToken, getPracticeProgress);
router.delete('/progress', verifyToken, resetPracticeProgress);

router.get('/', verifyToken, listQuestions);
router.get('/:id', verifyToken, getQuestion);
router.post('/:id/check', verifyToken, checkAnswer);       // reveals answer after student picks

export default router;
