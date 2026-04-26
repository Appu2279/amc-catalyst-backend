import express from 'express';
import {
  getCourses,
  getCourseById,
  subscribeCourse,
  getMyCourses,
  createCourse,
  updateCourse,
  deleteCourse
} from '../controllers/course.controller.js';

import { verifyToken } from '../middleware/authMiddleware.js';
import { isAdmin } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Public
router.get('/', getCourses);
router.get('/:id', getCourseById);

// User
router.post('/subscribe', verifyToken, subscribeCourse);
router.get('/my-courses', verifyToken, getMyCourses);

// Admin
router.post('/', verifyToken, isAdmin, createCourse);
router.put('/:id', verifyToken, isAdmin, updateCourse);
router.delete('/:id', verifyToken, isAdmin, deleteCourse);

export default router;