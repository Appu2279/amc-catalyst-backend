import { PricingConfig } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const getPricingConfig = async () => {
  const [config] = await PricingConfig.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return config;
};

export const updatePricingConfig = async ({ aud_to_inr_rate }) => {
  const rate = Number(aud_to_inr_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AppError('Exchange rate must be a positive number', 400);
  }

  const config = await getPricingConfig();
  await config.update({ aud_to_inr_rate: rate });
  return config;
};

// AUD → INR at the current rate, rounded to whole rupees — UPI amounts don't
// carry fractional paise in practice, and a course price like "300 AUD" times
// a four-decimal rate otherwise produces an amount nobody would actually type
// into their banking app.
export const convertAudToInr = (audAmount, rate) => Math.round(Number(audAmount) * Number(rate));
