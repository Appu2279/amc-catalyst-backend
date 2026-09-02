import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listBatches, getBatch, createBatch, receiveParsed, approveBatch, rollbackBatch, setBatchVisibility, setBatchFree,
  listUnassignedQuestions, addQuestionsToBatch, removeQuestionFromBatch,
} from '../controllers/importBatch.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

router.get('/', listBatches);
router.get('/unassigned-questions', listUnassignedQuestions); // must be before /:id
router.get('/:id', getBatch);
router.post('/', createBatch);
router.post('/:id/receive', receiveParsed);
router.post('/:id/approve', approveBatch);
router.patch('/:id/visibility', setBatchVisibility);
router.patch('/:id/free', setBatchFree);
router.post('/:id/questions', addQuestionsToBatch);
router.delete('/:id/questions/:questionId', removeQuestionFromBatch);
router.delete('/:id', rollbackBatch);

export default router;
