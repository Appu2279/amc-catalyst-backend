import express from 'express';
import {
  getCourses,
  getCourseById,
  grantSubscription,
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

// User
// Registered before '/:id' on purpose: Express matches in order, and '/:id'
// happily swallows 'my-courses' as an id, which then fails as an integer
// lookup rather than reaching this handler.
router.get('/my-courses', verifyToken, getMyCourses);

// Public
router.get('/:id', getCourseById);

// Admin
// Granting access is an admin action: payment is verified by hand before
// anyone gets a subscription, so there is no self-service route to one.
router.post('/grant-subscription', verifyToken, isAdmin, grantSubscription);
router.post('/', verifyToken, isAdmin, createCourse);
router.put('/:id', verifyToken, isAdmin, updateCourse);
router.delete('/:id', verifyToken, isAdmin, deleteCourse);

export default router;