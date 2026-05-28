import * as QuestionService from '../services/question.service.js';

export const checkAnswer = async (req, res) => {
  try {
    const data = await QuestionService.checkAnswer(req.params.id, req.body.selected_option_id);
    res.json({ data });
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
