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

export const rollbackBatch = async (req, res) => {
  try {
    res.json(await ImportBatchService.rollbackBatch(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};
