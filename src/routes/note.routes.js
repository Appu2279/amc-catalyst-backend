import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import { uploadPdf } from '../middleware/uploadMiddleware.js';
import {
  listNotes,
  streamNoteFile,
  listNotesAdmin,
  createNote,
  updateNote,
  deleteNote,
} from '../controllers/note.controller.js';

const router = Router();

// Admin — declared before /:id/file so that "admin" is never read as an id.
router.get('/admin', verifyToken, isAdmin, listNotesAdmin);
router.post('/admin', verifyToken, isAdmin, uploadPdf, createNote);
router.put('/admin/:id', verifyToken, isAdmin, updateNote);
router.delete('/admin/:id', verifyToken, isAdmin, deleteNote);

// Students. Notes are free to every registered user for now but are not public
// content — see assertCanAccess() in note.service.js, which is where a
// subscription check will go.
router.get('/', verifyToken, listNotes);
router.get('/:id/file', verifyToken, streamNoteFile);

export default router;
