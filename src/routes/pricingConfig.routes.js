import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import { getConfig, updateConfig } from '../controllers/pricingConfig.controller.js';

const router = Router();

// Public — no verifyToken. Read by the signed-out Pricing page.
router.get('/', getConfig);

router.put('/', verifyToken, isAdmin, updateConfig);

export default router;
