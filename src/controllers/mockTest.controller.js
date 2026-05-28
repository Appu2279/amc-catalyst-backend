import * as MockTestService from '../services/mockTest.service.js';

export const createMockTest = async (req, res) => {
  try {
    res.status(201).json(await MockTestService.createMockTest(req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const listMockTests = async (req, res) => {
  try {
    res.json(await MockTestService.listMockTests());
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getMockTest = async (req, res) => {
  try {
    res.json(await MockTestService.getMockTest(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const updateMockTest = async (req, res) => {
  try {
    res.json(await MockTestService.updateMockTest(req.params.id, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const deleteMockTest = async (req, res) => {
  try {
    res.json(await MockTestService.deleteMockTest(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const togglePublish = async (req, res) => {
  try {
    res.json(await MockTestService.togglePublish(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const addQuestions = async (req, res) => {
  try {
    res.status(201).json(await MockTestService.addQuestions(req.params.id, req.body.questions));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const removeQuestion = async (req, res) => {
  try {
    res.json(await MockTestService.removeQuestion(req.params.id, req.params.questionId));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getQuestionPool = async (req, res) => {
  try {
    res.json(await MockTestService.getQuestionPool());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
