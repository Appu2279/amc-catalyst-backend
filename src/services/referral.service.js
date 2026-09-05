import crypto from 'crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  sequelize,
  User,
  ReferralConfig,
  ReferralCode,
  Referral,
  ReferralReward,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import {
  REFERRAL_MODES,
  REFERRAL_MODE_VALUES,
  REFERRAL_STATUS,
  REWARD_KIND,
  REWARD_STATUS,
  CODE_SUFFIX_ALPHABET,
  CODE_SUFFIX_LENGTH,
  PARTNER_CODE_MIN,
  PARTNER_CODE_MAX,
  PARTNER_CODE_PATTERN,
  normaliseCode,
} from '../constants/referral.js';

// ── Config ────────────────────────────────────────────────────────────────────

/** The live settings row, created with defaults on first read. */
export const getConfig = async ({ transaction } = {}) => {
  const [config] = await ReferralConfig.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
    transaction,
  });
  return config;
};

export const updateConfig = async ({ mode, reward_amount, currency }) => {
  const config = await getConfig();
  const updates = {};

  if (mode !== undefined) {
    if (!REFERRAL_MODE_VALUES.includes(mode)) {
      throw new AppError('Invalid referral mode', 400);
    }
    updates.mode = mode;
  }

  if (reward_amount !== undefined) {
    const amount = Number(reward_amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new AppError('Reward amount must be a positive number', 400);
    }
    updates.reward_amount = amount;
  }

  if (currency !== undefined) {
    const code = String(currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new AppError('Currency must be a 3-letter code', 400);
    updates.currency = code;
  }

  await config.update(updates);
  return config;
};

// ── Code generation & lookup ──────────────────────────────────────────────────

const NAME_TITLES = new Set(['DR', 'MR', 'MRS', 'MS', 'MX', 'PROF', 'DOCTOR']);

const slugFromName = (fullName) => {
  const tokens = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .filter(Boolean);
  // Skip a leading title ("Dr Jennifer Rose" -> JENNIFER).
  const pick = tokens.find((t, i) => !(i === 0 && NAME_TITLES.has(t))) ?? tokens[0];
  return pick && pick.length >= 2 ? pick.slice(0, 8) : 'AMC';
};

const randomSuffix = () => {
  const bytes = crypto.randomBytes(CODE_SUFFIX_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i += 1) {
    out += CODE_SUFFIX_ALPHABET[bytes[i] % CODE_SUFFIX_ALPHABET.length];
  }
  return out;
};

/**
 * The referral code for a user, created if it does not exist yet.
 *
 * Called eagerly at registration and lazily the first time a pre-existing user
 * opens their profile, so the backfill script is a convenience rather than a
 * hard prerequisite.
 */
export const ensureUserCode = async (user, { transaction } = {}) => {
  const existing = await ReferralCode.findOne({
    where: { owner_type: 'user', owner_user_id: user.id },
    transaction,
  });
  if (existing) return existing;

  // The caller may only have { id, role } from the JWT — load the name so a
  // lazily-created code is still "JENNIFER-…" rather than the "AMC-…" fallback.
  let fullName = user.fullName;
  if (fullName === undefined) {
    const row = await User.findByPk(user.id, { attributes: ['fullName'], transaction });
    fullName = row?.fullName;
  }
  const slug = slugFromName(fullName);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `${slug}-${randomSuffix()}`;
    try {
      return await ReferralCode.create(
        { code, owner_type: 'user', owner_user_id: user.id },
        { transaction }
      );
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      // owner_user_id clash → a concurrent request already made it; return that.
      const concurrent = await ReferralCode.findOne({
        where: { owner_type: 'user', owner_user_id: user.id },
        transaction,
      });
      if (concurrent) return concurrent;
      // Otherwise the code string clashed — loop and redraw the suffix.
    }
  }

  throw new AppError('Could not allocate a referral code', 500);
};

/** An active code by its string, or null. Case- and whitespace-insensitive. */
export const resolveActiveCode = async (codeString, { transaction } = {}) => {
  const code = normaliseCode(codeString);
  if (!code) return null;
  return ReferralCode.findOne({
    where: { code, is_active: true },
    transaction,
  });
};

// ── Registration hook ─────────────────────────────────────────────────────────

/**
 * Records that a new account signed up under a code. Best-effort: an unknown or
 * inactive code, or a self-referral, simply records nothing and does not fail
 * the registration.
 */
export const recordReferralOnSignup = async (newUserId, codeString, { transaction } = {}) => {
  const code = await resolveActiveCode(codeString, { transaction });
  if (!code) return null;

  // Can't refer yourself (the code would have to already exist, but guard anyway).
  if (code.owner_type === 'user' && code.owner_user_id === newUserId) return null;

  try {
    return await Referral.create(
      {
        referral_code_id: code.id,
        referred_user_id: newUserId,
        code_used: normaliseCode(codeString),
        status: REFERRAL_STATUS.JOINED,
      },
      { transaction }
    );
  } catch (err) {
    // referred_user_id is unique — a retry of a signup that already recorded one.
    if (err instanceof UniqueConstraintError) {
      return Referral.findOne({ where: { referred_user_id: newUserId }, transaction });
    }
    throw err;
  }
};

// ── Qualification hook (called from payment approval) ──────────────────────────

/**
 * Moves a referral to 'qualified' when the referred user's first payment is
 * approved, and raises the rewards the mode calls for.
 *
 * Safe to call on every approval — only the first does anything, because the
 * status check and the unique (referral_id, kind) index both gate it. Runs in
 * the approval's transaction so a committed approval always has its referral
 * side-effects, or neither.
 */
export const qualifyReferralForPayment = async (userId, paymentClaimId, { transaction } = {}) => {
  const referral = await Referral.findOne({
    where: { referred_user_id: userId, status: REFERRAL_STATUS.JOINED },
    transaction,
  });
  if (!referral) return null;

  const config = await getConfig({ transaction });

  await referral.update(
    {
      status: REFERRAL_STATUS.QUALIFIED,
      qualified_at: new Date(),
      qualifying_payment_claim_id: paymentClaimId ?? null,
      mode_at_qualification: config.mode,
    },
    { transaction }
  );

  if (config.mode === REFERRAL_MODES.OFF) return referral;

  const code = await ReferralCode.findByPk(referral.referral_code_id, { transaction });

  const rewards = [];

  // Referrer — always (unless off, handled above).
  const referrerBeneficiary =
    code?.owner_type === 'user' && code.owner_user_id !== userId ? code.owner_user_id : null;
  rewards.push({
    referral_id: referral.id,
    kind: REWARD_KIND.REFERRER,
    beneficiary_user_id: referrerBeneficiary,
    amount: config.reward_amount,
    currency: config.currency,
  });

  // Referee — only when the mode rewards both sides.
  if (config.mode === REFERRAL_MODES.BOTH) {
    rewards.push({
      referral_id: referral.id,
      kind: REWARD_KIND.REFEREE,
      beneficiary_user_id: userId,
      amount: config.reward_amount,
      currency: config.currency,
    });
  }

  for (const reward of rewards) {
    try {
      await ReferralReward.create(reward, { transaction });
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      // Already raised on a previous run — fine.
    }
  }

  return referral;
};

// ── User-facing ───────────────────────────────────────────────────────────────

/** The signed-in user's code and the current offer, for the profile screen. */
export const getMyReferral = async (user) => {
  const [code, config] = await Promise.all([ensureUserCode(user), getConfig()]);
  return {
    code: code.code,
    is_active: code.is_active,
    mode: config.mode,
    reward_amount: Number(config.reward_amount),
    currency: config.currency,
  };
};

// ── Admin: overview ───────────────────────────────────────────────────────────

const sumAmount = (rows) =>
  rows.reduce((total, row) => total + Number(row.amount || 0), 0);

export const getOverview = async () => {
  const config = await getConfig();

  const [byStatus, rewards, activePartnerCodes] = await Promise.all([
    Referral.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    }),
    ReferralReward.findAll({ attributes: ['status', 'amount'], raw: true }),
    ReferralCode.count({ where: { owner_type: 'partner', is_active: true } }),
  ]);

  const referralCounts = { joined: 0, qualified: 0, rewarded: 0 };
  for (const row of byStatus) referralCounts[row.status] = Number(row.count);
  const totalReferrals = referralCounts.joined + referralCounts.qualified + referralCounts.rewarded;

  const pending = rewards.filter((r) => r.status === REWARD_STATUS.PENDING);
  const paid = rewards.filter((r) => r.status === REWARD_STATUS.PAID);

  return {
    config: {
      mode: config.mode,
      reward_amount: Number(config.reward_amount),
      currency: config.currency,
    },
    referrals: {
      total: totalReferrals,
      ...referralCounts,
    },
    rewards: {
      currency: config.currency,
      pending_count: pending.length,
      pending_amount: sumAmount(pending),
      paid_count: paid.length,
      paid_amount: sumAmount(paid),
    },
    active_partner_codes: activePartnerCodes,
  };
};

// ── Admin: referrals list ─────────────────────────────────────────────────────

const shapeReferral = (referral) => {
  const code = referral.code;
  const referrer = code
    ? code.owner_type === 'user'
      ? { type: 'user', name: code.owner?.fullName ?? null, email: code.owner?.email ?? null, user_id: code.owner_user_id }
      : { type: 'partner', name: code.partner_name ?? null }
    : null;

  return {
    id: referral.id,
    status: referral.status,
    code: code?.code ?? referral.code_used,
    code_used: referral.code_used,
    referrer,
    referred_user: referral.referred_user
      ? {
          id: referral.referred_user.id,
          name: referral.referred_user.fullName,
          email: referral.referred_user.email,
        }
      : null,
    joined_at: referral.createdAt,
    qualified_at: referral.qualified_at,
    mode_at_qualification: referral.mode_at_qualification,
    rewards: (referral.rewards ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      beneficiary_user_id: r.beneficiary_user_id,
      paid_at: r.paid_at,
    })),
  };
};

export const listReferrals = async ({ status, page = 1, limit = 25 } = {}) => {
  const where = {};
  if (status) where.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const { rows, count } = await Referral.findAndCountAll({
    where,
    include: [
      {
        model: ReferralCode,
        as: 'code',
        include: [{ model: User, as: 'owner', attributes: ['id', 'fullName', 'email'] }],
      },
      { model: User, as: 'referred_user', attributes: ['id', 'fullName', 'email'] },
      { model: ReferralReward, as: 'rewards' },
    ],
    order: [['id', 'DESC']],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    distinct: true,
  });

  return {
    data: rows.map(shapeReferral),
    pagination: { page: safePage, limit: safeLimit, total: count },
  };
};

// ── Admin: codes ──────────────────────────────────────────────────────────────

export const listCodes = async ({ type } = {}) => {
  const where = {};
  if (type === 'user' || type === 'partner') where.owner_type = type;

  const codes = await ReferralCode.findAll({
    where,
    include: [{ model: User, as: 'owner', attributes: ['id', 'fullName', 'email'] }],
    order: [['id', 'DESC']],
  });

  // Referral counts per code, in one pass.
  const counts = await Referral.findAll({
    attributes: [
      'referral_code_id',
      [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
      [
        sequelize.fn(
          'SUM',
          sequelize.literal(`CASE WHEN status <> '${REFERRAL_STATUS.JOINED}' THEN 1 ELSE 0 END`)
        ),
        'qualified',
      ],
    ],
    group: ['referral_code_id'],
    raw: true,
  });
  const countBy = new Map(
    counts.map((c) => [c.referral_code_id, { total: Number(c.total), qualified: Number(c.qualified) }])
  );

  return codes.map((c) => ({
    id: c.id,
    code: c.code,
    owner_type: c.owner_type,
    is_active: c.is_active,
    partner_name: c.partner_name,
    partner_note: c.partner_note,
    owner: c.owner ? { id: c.owner.id, name: c.owner.fullName, email: c.owner.email } : null,
    created_at: c.createdAt,
    referrals: countBy.get(c.id)?.total ?? 0,
    qualified_referrals: countBy.get(c.id)?.qualified ?? 0,
  }));
};

export const createPartnerCode = async ({ code, partner_name, partner_note, createdBy }) => {
  const normalised = normaliseCode(code);

  if (normalised.length < PARTNER_CODE_MIN || normalised.length > PARTNER_CODE_MAX) {
    throw new AppError(
      `Code must be ${PARTNER_CODE_MIN}–${PARTNER_CODE_MAX} characters`,
      400
    );
  }
  if (!PARTNER_CODE_PATTERN.test(normalised)) {
    throw new AppError('Code may only contain letters, numbers and single dashes', 400);
  }

  const name = String(partner_name ?? '').trim();
  if (!name) throw new AppError('Partner name is required', 400);

  const existing = await ReferralCode.findOne({ where: { code: normalised } });
  if (existing) throw new AppError('That code is already taken', 409);

  try {
    return await ReferralCode.create({
      code: normalised,
      owner_type: 'partner',
      partner_name: name,
      partner_note: String(partner_note ?? '').trim() || null,
      created_by: createdBy ?? null,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw new AppError('That code is already taken', 409);
    throw err;
  }
};

export const updateCode = async (id, { is_active, partner_name, partner_note }) => {
  const code = await ReferralCode.findByPk(id);
  if (!code) throw new AppError('Referral code not found', 404);
  if (code.owner_type !== 'partner') {
    throw new AppError('Only partner codes can be edited', 400);
  }

  const updates = {};
  if (is_active !== undefined) updates.is_active = Boolean(is_active);
  if (partner_name !== undefined) {
    const name = String(partner_name).trim();
    if (!name) throw new AppError('Partner name cannot be empty', 400);
    updates.partner_name = name;
  }
  if (partner_note !== undefined) {
    updates.partner_note = String(partner_note).trim() || null;
  }

  await code.update(updates);
  return code;
};

// ── Admin: rewards ────────────────────────────────────────────────────────────

export const listRewards = async ({ status, page = 1, limit = 25 } = {}) => {
  const where = {};
  if (status) where.status = status;

  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const { rows, count } = await ReferralReward.findAndCountAll({
    where,
    include: [
      { model: User, as: 'beneficiary', attributes: ['id', 'fullName', 'email'] },
      {
        model: Referral,
        as: 'referral',
        include: [
          {
            model: ReferralCode,
            as: 'code',
            include: [{ model: User, as: 'owner', attributes: ['id', 'fullName', 'email'] }],
          },
          { model: User, as: 'referred_user', attributes: ['id', 'fullName', 'email'] },
        ],
      },
    ],
    order: [['id', 'DESC']],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    distinct: true,
  });

  const data = rows.map((r) => {
    const code = r.referral?.code;
    return {
      id: r.id,
      kind: r.kind,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      paid_at: r.paid_at,
      payout_note: r.payout_note,
      created_at: r.createdAt,
      // Who to pay.
      payee:
        r.kind === REWARD_KIND.REFERRER && code?.owner_type === 'partner'
          ? { type: 'partner', name: code.partner_name, note: code.partner_note }
          : r.beneficiary
          ? { type: 'user', id: r.beneficiary.id, name: r.beneficiary.fullName, email: r.beneficiary.email }
          : { type: 'unknown' },
      code: code?.code ?? r.referral?.code_used ?? null,
      referred_user: r.referral?.referred_user
        ? { id: r.referral.referred_user.id, name: r.referral.referred_user.fullName, email: r.referral.referred_user.email }
        : null,
    };
  });

  return { data, pagination: { page: safePage, limit: safeLimit, total: count } };
};

export const markRewardPaid = async (rewardId, adminId, { note } = {}) => {
  const reward = await ReferralReward.findByPk(rewardId);
  if (!reward) throw new AppError('Reward not found', 404);
  if (reward.status === REWARD_STATUS.PAID) {
    throw new AppError('This reward is already marked paid', 409);
  }

  await reward.update({
    status: REWARD_STATUS.PAID,
    paid_at: new Date(),
    paid_by: adminId ?? null,
    payout_note: String(note ?? '').trim() || reward.payout_note,
  });

  // When every reward on the referral is settled, close the referral out too.
  const outstanding = await ReferralReward.count({
    where: { referral_id: reward.referral_id, status: { [Op.ne]: REWARD_STATUS.PAID } },
  });
  if (outstanding === 0) {
    await Referral.update(
      { status: REFERRAL_STATUS.REWARDED },
      { where: { id: reward.referral_id } }
    );
  }

  return reward;
};
