import * as PricingConfigService from '../services/pricingConfig.service.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// Public — the Pricing page needs the current rate before a visitor has
// signed in, to show the INR estimate next to each AUD price.
export const getConfig = handle(() => PricingConfigService.getPricingConfig());

export const updateConfig = handle((req) =>
  PricingConfigService.updatePricingConfig({ aud_to_inr_rate: req.body.aud_to_inr_rate })
);
