import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { listBookmarks, addBookmark, removeBookmark } from '../controllers/bookmark.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', listBookmarks);
router.post('/', addBookmark);
router.delete('/:questionId', removeBookmark);

export default router;
