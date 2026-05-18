import * as FeatureService from '../services/feature.service.js';

export const listFeatures = async (req, res) => {
  try { res.json(await FeatureService.listFeatures()); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

export const createFeature = async (req, res) => {
  try { res.status(201).json(await FeatureService.createFeature(req.body.name)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

export const deleteFeature = async (req, res) => {
  try { res.json(await FeatureService.deleteFeature(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

export const listBenefits = async (req, res) => {
  try { res.json(await FeatureService.listBenefits()); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

export const createBenefit = async (req, res) => {
  try { res.status(201).json(await FeatureService.createBenefit(req.body.title)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

export const deleteBenefit = async (req, res) => {
  try { res.json(await FeatureService.deleteBenefit(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};
