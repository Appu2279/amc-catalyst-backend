import * as QuestionService from '../services/question.service.js';
import * as ImportBatchService from '../services/importBatch.service.js';

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
