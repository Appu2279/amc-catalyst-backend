import { Subject, Topic } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

const toSlug = (name) => name.toLowerCase().trim().replace(/\s+/g, '-');

// ── Subjects ──────────────────────────────────────
export const listSubjects = () =>
  Subject.findAll({
    where: { is_active: true },
    include: [{ model: Topic, as: 'topics', where: { is_active: true }, required: false, attributes: ['id', 'name', 'slug'] }],
    order: [['name', 'ASC']],
  });

export const getSubject = async (id) => {
  const subject = await Subject.findByPk(id, {
    include: [{ model: Topic, as: 'topics', where: { is_active: true }, required: false }],
  });
  if (!subject) throw new AppError('Subject not found', 404);
  return subject;
};

export const createSubject = ({ name, description }) =>
  Subject.create({ name, slug: toSlug(name), description });

export const updateSubject = async (id, { name, description, is_active }) => {
  const subject = await Subject.findByPk(id);
  if (!subject) throw new AppError('Subject not found', 404);
  await subject.update({ name, slug: name ? toSlug(name) : subject.slug, description, is_active });
  return subject;
};

export const deleteSubject = async (id) => {
  const subject = await Subject.findByPk(id);
  if (!subject) throw new AppError('Subject not found', 404);
  await subject.destroy();
  return { message: 'Subject deleted' };
};

// ── Topics ────────────────────────────────────────
export const listTopics = (subjectId) =>
  Topic.findAll({ where: { subject_id: subjectId, is_active: true }, order: [['name', 'ASC']] });

export const createTopic = ({ subject_id, name, description }) =>
  Topic.create({ subject_id, name, slug: toSlug(name), description });

export const updateTopic = async (id, { name, description, is_active }) => {
  const topic = await Topic.findByPk(id);
  if (!topic) throw new AppError('Topic not found', 404);
  await topic.update({ name, slug: name ? toSlug(name) : topic.slug, description, is_active });
  return topic;
};

export const deleteTopic = async (id) => {
  const topic = await Topic.findByPk(id);
  if (!topic) throw new AppError('Topic not found', 404);
  await topic.destroy();
  return { message: 'Topic deleted' };
};
