import * as ReferralService from '../services/referral.service.js';

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ── User ──────────────────────────────────────────────────────────────────────

export const getMyReferral = handle((req) => ReferralService.getMyReferral(req.user));

// ── Admin ─────────────────────────────────────────────────────────────────────

export const getOverview = handle(() => ReferralService.getOverview());

export const listReferrals = handle((req) =>
  ReferralService.listReferrals({
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  })
);

export const updateConfig = handle((req) =>
  ReferralService.updateConfig({
    mode: req.body.mode,
    reward_amount: req.body.reward_amount,
    currency: req.body.currency,
  })
);

export const listCodes = handle((req) => ReferralService.listCodes({ type: req.query.type }));

export const createPartnerCode = handle((req) =>
  ReferralService.createPartnerCode({
    code: req.body.code,
    partner_name: req.body.partner_name,
    partner_note: req.body.partner_note,
    createdBy: req.user.id,
  })
);

export const updateCode = handle((req) =>
  ReferralService.updateCode(req.params.id, {
    is_active: req.body.is_active,
    partner_name: req.body.partner_name,
    partner_note: req.body.partner_note,
  })
);

export const listRewards = handle((req) =>
  ReferralService.listRewards({
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  })
);

export const markRewardPaid = handle((req) =>
  ReferralService.markRewardPaid(req.params.id, req.user.id, { note: req.body.note })
);
