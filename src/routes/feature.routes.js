import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listFeatures, createFeature, deleteFeature,
  listBenefits, createBenefit, deleteBenefit,
} from '../controllers/feature.controller.js';

const router = Router();

// Features
router.get('/features', listFeatures);
router.post('/features', verifyToken, isAdmin, createFeature);
router.delete('/features/:id', verifyToken, isAdmin, deleteFeature);

// Benefits
router.get('/benefits', listBenefits);
router.post('/benefits', verifyToken, isAdmin, createBenefit);
router.delete('/benefits/:id', verifyToken, isAdmin, deleteBenefit);

export default router;
