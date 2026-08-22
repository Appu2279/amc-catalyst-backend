import * as QuestionService from '../services/question.service.js';

export const checkAnswer = async (req, res) => {
  try {
    // req.user.id is passed so the answer is recorded against the student —
    // that is what lets Recall resume where they stopped, on any device.
    const data = await QuestionService.checkAnswer(
      req.params.id,
      req.body.selected_option_id,
      req.user?.id
    );
    res.json({ data });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// GET /api/questions/progress?source_type=recall
export const getPracticeProgress = async (req, res) => {
  try {
    res.json({ data: await QuestionService.getPracticeProgress(req.user.id, req.query) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// GET /api/questions/batches?source_type=recall
export const listQuestionBatches = async (req, res) => {
  try {
    res.json({ data: await QuestionService.listQuestionBatches(req.query, req.user?.id) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// DELETE /api/questions/progress?source_type=recall — "start over"
export const resetPracticeProgress = async (req, res) => {
  try {
    res.json({ data: await QuestionService.resetPracticeProgress(req.user.id, req.query) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const adminListQuestions = async (req, res) => {
  try {
    res.json(await QuestionService.adminListQuestions(req.query));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const adminGetQuestion = async (req, res) => {
  try {
    res.json(await QuestionService.adminGetQuestion(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const createQuestion = async (req, res) => {
  try {
    res.status(201).json(await QuestionService.createQuestion(req.body, req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const updateQuestion = async (req, res) => {
  try {
    res.json(await QuestionService.updateQuestion(req.params.id, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    res.json(await QuestionService.deleteQuestion(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const toggleQuestion = async (req, res) => {
  try {
    res.json(await QuestionService.toggleQuestion(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const listQuestions = async (req, res) => {
  try {
    res.json(await QuestionService.listQuestions(req.query));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getQuestion = async (req, res) => {
  try {
    res.json(await QuestionService.getQuestion(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
