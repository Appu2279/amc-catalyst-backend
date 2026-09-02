import * as CourseService from '../services/course.service.js';

export const getCourses = async (req, res) => {
  try {
    res.json(await CourseService.getCourses());
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getCourseById = async (req, res) => {
  try {
    res.json(await CourseService.getCourseById(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// Admin-only. The user being granted access comes from the body, never from
// req.user — an admin is acting on someone else's account, not their own.
export const grantSubscription = async (req, res) => {
  try {
    const { user_id, course_id } = req.body;
    if (!user_id || !course_id) {
      return res.status(400).json({ message: 'user_id and course_id are required' });
    }
    // grantedBy is the admin making the call — the only provenance a manually
    // granted subscription has, since there is no payment claim behind it.
    res.status(201).json(
      await CourseService.grantSubscription(user_id, course_id, {
        grantedBy: req.user.id,
        source: 'manual',
      })
    );
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getMyCourses = async (req, res) => {
  try {
    res.json(await CourseService.getMyCourses(req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const createCourse = async (req, res) => {
  try {
    res.status(201).json(await CourseService.createCourse(req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const updateCourse = async (req, res) => {
  try {
    res.json(await CourseService.updateCourse(req.params.id, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const deleteCourse = async (req, res) => {
  try {
    res.json(await CourseService.deleteCourse(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
