import { Feature, Benefit } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

// ── Features ──────────────────────────────────────
export const listFeatures = () => Feature.findAll({ order: [['name', 'ASC']] });

export const createFeature = (name) => Feature.create({ name });

export const deleteFeature = async (id) => {
  const feature = await Feature.findByPk(id);
  if (!feature) throw new AppError('Feature not found', 404);
  await feature.destroy();
  return { message: 'Feature deleted' };
};

// ── Benefits ──────────────────────────────────────
export const listBenefits = () => Benefit.findAll({ order: [['title', 'ASC']] });

export const createBenefit = (title) => Benefit.create({ title });

export const deleteBenefit = async (id) => {
  const benefit = await Benefit.findByPk(id);
  if (!benefit) throw new AppError('Benefit not found', 404);
  await benefit.destroy();
  return { message: 'Benefit deleted' };
};
