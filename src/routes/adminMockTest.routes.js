import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  createMockTest,
  listMockTests,
  getMockTest,
  updateMockTest,
  deleteMockTest,
  togglePublish,
  addQuestions,
  removeQuestion,
  getQuestionPool,
} from '../controllers/mockTest.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

router.get('/question-pool', getQuestionPool); // must be before /:id
router.post('/', createMockTest);
router.get('/', listMockTests);
router.get('/:id', getMockTest);
router.put('/:id', updateMockTest);
router.delete('/:id', deleteMockTest);
router.patch('/:id/publish', togglePublish);
router.post('/:id/questions', addQuestions);
router.delete('/:id/questions/:questionId', removeQuestion);

export default router;
