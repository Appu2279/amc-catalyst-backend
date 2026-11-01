import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getFlashcardDeck } from '../controllers/flashcard.controller.js';

const router = Router();

router.get('/', verifyToken, getFlashcardDeck);

export default router;
