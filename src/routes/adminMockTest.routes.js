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
  toggleFree,
  addQuestions,
  removeQuestion,
  getQuestionPool,
  getWeightedMockPreview,
  createWeightedMock,
} from '../controllers/mockTest.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

router.get('/question-pool', getQuestionPool); // must be before /:id
// AMC-weighted fixed mocks, built from subjects' exam_domain.
router.get('/weighted/preview', getWeightedMockPreview); // must be before /:id
router.post('/weighted', createWeightedMock);
router.post('/', createMockTest);
router.get('/', listMockTests);
router.get('/:id', getMockTest);
router.put('/:id', updateMockTest);
router.delete('/:id', deleteMockTest);
router.patch('/:id/publish', togglePublish);
// Marks a whole exam as a free sample, sittable without a plan.
router.patch('/:id/free', toggleFree);
router.post('/:id/questions', addQuestions);
router.delete('/:id/questions/:questionId', removeQuestion);

export default router;
