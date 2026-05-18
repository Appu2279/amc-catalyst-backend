import { Router } from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';
import {
  listSubjects, getSubject, createSubject, updateSubject, deleteSubject,
  listTopics, createTopic, updateTopic, deleteTopic,
} from '../controllers/subject.controller.js';

const router = Router();

// Public
router.get('/', listSubjects);
router.get('/:id', getSubject);
router.get('/:id/topics', listTopics);

// Admin — subjects
router.post('/', verifyToken, isAdmin, createSubject);
router.put('/:id', verifyToken, isAdmin, updateSubject);
router.delete('/:id', verifyToken, isAdmin, deleteSubject);

// Admin — topics
router.post('/topics/create', verifyToken, isAdmin, createTopic);
router.put('/topics/:id', verifyToken, isAdmin, updateTopic);
router.delete('/topics/:id', verifyToken, isAdmin, deleteTopic);

export default router;
