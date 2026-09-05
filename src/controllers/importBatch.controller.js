import crypto from 'crypto';
import * as QuestionService from '../services/question.service.js';
import * as ImportBatchService from '../services/importBatch.service.js';
import { uploadQuestionImage as putQuestionImage, isStorageConfigured } from '../config/storage.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Stores one question figure and hands back the path the question row should
 * carry. The import service (which has no AWS credentials of its own) posts the
 * cropped image here; students later read it back through
 * GET /api/images/question — the object itself stays private on S3.
 */
export const uploadImage = async (req, res) => {
  try {
    if (!isStorageConfigured) {
      return res.status(503).json({ message: 'File storage is not configured on this server' });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const ext = EXT_BY_MIME[req.file.mimetype] || 'png';
    const key = `question-images/${crypto.randomUUID()}.${ext}`;
    await putQuestionImage(req.file.buffer, key, req.file.mimetype);

    res.status(201).json({ key, path: `/api/images/question?key=${encodeURIComponent(key)}` });
  } catch (err) {
    console.error('Question image upload failed:', err.message);
    res.status(500).json({ message: 'Could not store the image' });
  }
};

export const listBatches = async (req, res) => {
  try {
    res.json(await ImportBatchService.listBatches());
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.getBatch(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const createBatch = async (req, res) => {
  try {
    res.status(201).json(await ImportBatchService.createBatch(req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const receiveParsed = async (req, res) => {
  try {
    res.json(await ImportBatchService.receiveParsed(req.params.id, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const approveBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.approveBatch(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// PATCH /api/admin/import-batches/:id/free  { is_free: boolean }
// Opens a whole recall month as a free sample. Distinct from visibility, which
// takes a batch away from paying students too.
export const setBatchFree = async (req, res) => {
  try {
    res.json({ data: await QuestionService.setBatchFree(req.params.id, req.body.is_free) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// PATCH /api/admin/import-batches/:id/visibility  { is_visible: boolean }
// Shows or hides a whole recall batch for students. Nothing is deleted.
export const setBatchVisibility = async (req, res) => {
  try {
    res.json({ data: await QuestionService.setBatchVisibility(req.params.id, req.body.is_visible) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// GET /api/admin/import-batches/unassigned-questions?search=
// The pool of questions that belong to no batch — what the picker offers.
export const listUnassignedQuestions = async (req, res) => {
  try {
    res.json({ data: await ImportBatchService.listUnassignedQuestions(req.query) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// POST /api/admin/import-batches/:id/questions  { question_ids: [1, 2, 3] }
export const addQuestionsToBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.addQuestionsToBatch(req.params.id, req.body.question_ids));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// DELETE /api/admin/import-batches/:id/questions/:questionId
// Unassigns the question — it stays in the question bank. Deleting a question
// for good is the questions page's job.
export const removeQuestionFromBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.removeQuestionFromBatch(req.params.id, req.params.questionId));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const rollbackBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.rollbackBatch(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
