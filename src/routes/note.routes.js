import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import { uploadPdf, uploadNoteCover } from '../middleware/uploadMiddleware.js';
import {
  listNotes,
  streamNoteFile,
  streamNoteCover,
  listNotesAdmin,
  createNote,
  updateNote,
  deleteNote,
  uploadNoteCoverImage,
  deleteNoteCoverImage,
  listPublicNoteCovers,
} from '../controllers/note.controller.js';

const router = Router();

// Admin — declared before /:id/file so that "admin" is never read as an id.
router.get('/admin', verifyToken, isAdmin, listNotesAdmin);
router.post('/admin', verifyToken, isAdmin, uploadPdf, createNote);
router.put('/admin/:id', verifyToken, isAdmin, updateNote);
router.delete('/admin/:id', verifyToken, isAdmin, deleteNote);
router.post('/admin/:id/cover', verifyToken, isAdmin, uploadNoteCover, uploadNoteCoverImage);
router.delete('/admin/:id/cover', verifyToken, isAdmin, deleteNoteCoverImage);

// Public — no verifyToken. Powers the marketing homepage's cover slideshow,
// which a signed-out visitor sees before there is any account to check
// entitlements against. streamNoteCover already has no entitlement check
// beyond is_active (see getNoteCoverKey in note.service.js), so it is reused
// here as-is rather than duplicated.
router.get('/public/covers', listPublicNoteCovers);
router.get('/public/:id/cover', streamNoteCover);

// Students. Notes are free to every registered user for now but are not public
// content — see assertCanAccess() in note.service.js, which is where a
// subscription check will go.
router.get('/', verifyToken, listNotes);
router.get('/:id/file', verifyToken, streamNoteFile);
router.get('/:id/cover', verifyToken, streamNoteCover);

export default router;
