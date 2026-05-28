import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  adminListQuestions, adminGetQuestion, createQuestion, updateQuestion, deleteQuestion, toggleQuestion,
  listQuestions, getQuestion, checkAnswer,
} from '../controllers/question.controller.js';

const router = Router();

// Admin routes
router.get('/admin', verifyToken, isAdmin, adminListQuestions);
router.get('/admin/:id', verifyToken, isAdmin, adminGetQuestion);
router.post('/admin', verifyToken, isAdmin, createQuestion);
router.put('/admin/:id', verifyToken, isAdmin, updateQuestion);
router.delete('/admin/:id', verifyToken, isAdmin, deleteQuestion);
router.patch('/admin/:id/toggle', verifyToken, isAdmin, toggleQuestion);

// Student routes
router.get('/', listQuestions);                            // no is_correct / explanation
router.get('/:id', getQuestion);
router.post('/:id/check', verifyToken, checkAnswer);       // reveals answer after student picks

export default router;
