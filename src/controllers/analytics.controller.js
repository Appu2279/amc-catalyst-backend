import * as AnalyticsService from '../services/analytics.service.js';

export const getSummary = async (req, res) => {
  try {
    res.json(await AnalyticsService.getSummary(req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getSubjectPerformance = async (req, res) => {
  try {
    res.json(await AnalyticsService.getSubjectPerformance(req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getWeakTopics = async (req, res) => {
  try {
    res.json(await AnalyticsService.getWeakTopics(req.user.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

export const getHistory = async (req, res) => {
  try {
    res.json(await AnalyticsService.getHistory(req.user.id, req.query));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
