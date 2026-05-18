import * as AttemptService from '../services/attempt.service.js';

export const listPublishedTests = async (req, res) => {
  try {
    res.json(await AttemptService.listPublishedTests());
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getTestInfo = async (req, res) => {
  try {
    res.json(await AttemptService.getTestInfo(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const startAttempt = async (req, res) => {
  try {
    const result = await AttemptService.startAttempt(req.user.id, req.params.id);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message, ...err.data });
  }
};

export const getAttempt = async (req, res) => {
  try {
    res.json(await AttemptService.getAttempt(req.params.id, req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const submitAnswer = async (req, res) => {
  try {
    res.json(await AttemptService.submitAnswer(req.params.id, req.user.id, req.body));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const submitAttempt = async (req, res) => {
  try {
    res.json(await AttemptService.submitAttempt(req.params.id, req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getResult = async (req, res) => {
  try {
    res.json(await AttemptService.getResult(req.params.id, req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
