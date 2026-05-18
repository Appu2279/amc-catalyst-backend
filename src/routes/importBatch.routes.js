import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listBatches, getBatch, createBatch, receiveParsed, approveBatch, rollbackBatch,
} from '../controllers/importBatch.controller.js';

const router = Router();

router.use(verifyToken, isAdmin);

router.get('/', listBatches);
router.get('/:id', getBatch);
router.post('/', createBatch);
router.post('/:id/receive', receiveParsed);
router.post('/:id/approve', approveBatch);
router.delete('/:id', rollbackBatch);

export default router;
