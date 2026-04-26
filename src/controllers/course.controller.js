import {
  Course,
  CoursePricing,
  Feature,
  Benefit,
  Subscription
} from '../models/index.js';

// ==============================
// GET ALL COURSES
// ==============================
export const getCourses = async (req, res) => {
  try {
    const courses = await Course.findAll({
      include: [
        { model: CoursePricing },
        { model: Feature },
        { model: Benefit }
      ]
    });

    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// GET SINGLE COURSE
// ==============================
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id, {
      include: [
        { model: CoursePricing },
        { model: Feature },
        { model: Benefit }
      ]
    });

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// SUBSCRIBE COURSE
// ==============================
export const subscribeCourse = async (req, res) => {
  try {
    const { course_id } = req.body;

    const course = await Course.findByPk(course_id);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + course.duration_months);

    const subscription = await Subscription.create({
      user_id: req.user.id,
      course_id,
      start_date: new Date(),
      end_date: endDate,
      status: 'active'
    });

    res.json(subscription);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// GET USER COURSES
// ==============================
export const getMyCourses = async (req, res) => {
  try {
    const subs = await Subscription.findAll({
      where: { user_id: req.user.id },
      include: [
        {
          model: Course,
          include: [CoursePricing, Feature, Benefit]
        }
      ]
    });

    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// ADMIN: CREATE COURSE
// ==============================
export const createCourse = async (req, res) => {
  try {
    const { title, description, duration_months } = req.body;

    const course = await Course.create({
      title,
      description,
      duration_months
    });

    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// ADMIN: UPDATE COURSE
// ==============================
export const updateCourse = async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);

    if (!course) {
      return res.status(404).json({ message: 'Not found' });
    }

    await course.update(req.body);

    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==============================
// ADMIN: DELETE COURSE
// ==============================
export const deleteCourse = async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);

    if (!course) {
      return res.status(404).json({ message: 'Not found' });
    }

    await course.destroy();

    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};