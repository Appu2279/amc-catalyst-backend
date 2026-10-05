import { Op } from 'sequelize';
import { sequelize, User, Subscription, Course, PaymentClaim, Referral } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isBanActive } from '../utils/accountStatus.js';
import { toCsv } from '../utils/csv.js';
import { grantSubscription, resolveCourseSections } from './course.service.js';

const PAGE_SIZE_MAX = 100;
const BAN_DAYS_MAX = 3650;
const EXTEND_MONTHS_MAX = 36;
const NOTE_MAX = 500;

const USER_LIST_ATTRIBUTES = [
  'id', 'fullName', 'email', 'phone', 'role', 'country', 'professionalRole', 'amcExamDate',
  'banned_at', 'banned_until', 'ban_reason', 'deleted_at', 'createdAt',
];

const accountStatusOf = (user) => {
  if (user.deleted_at) return 'removed';
  if (isBanActive(user)) return 'banned';
  return 'active';
};

const isLive = (subscription, now = new Date()) =>
  subscription.status === 'active' && subscription.end_date && new Date(subscription.end_date) > now;

const toUserSummary = (user) => {
  const json = user.toJSON();
  const subscriptions = json.Subscriptions ?? [];
  delete json.Subscriptions;
  return {
    ...json,
    account_status: accountStatusOf(user),
    active_plans: subscriptions
      .filter((s) => isLive(s))
      .map((s) => ({ id: s.id, plan_title: s.plan_title, end_date: s.end_date })),
  };
};

const whereForStatus = (status, now) => {
  switch (status) {
    case 'removed':
      return { deleted_at: { [Op.ne]: null } };
    case 'banned':
      return {
        deleted_at: null,
        banned_at: { [Op.ne]: null },
        [Op.or]: [{ banned_until: null }, { banned_until: { [Op.gt]: now } }],
      };
    case 'active':
      return {
        deleted_at: null,
        [Op.or]: [{ banned_at: null }, { banned_until: { [Op.lte]: now } }],
      };
    default:
      // "All" means every account still on the books; removed ones have their own filter.
      return { deleted_at: null };
  }
};

/** Paginated user list with each user's live plans. */
export const listUsers = async ({ search, status = 'all', page = 1, page_size = 25 } = {}) => {
  const now = new Date();
  const limit = Math.min(Math.max(Number(page_size) || 25, 1), PAGE_SIZE_MAX);
  const currentPage = Math.max(Number(page) || 1, 1);
  const term = typeof search === 'string' ? search.trim() : '';

  const where = {
    ...whereForStatus(status, now),
    ...(term
      ? { [Op.and]: [{ [Op.or]: [
        { fullName: { [Op.iLike]: `%${term}%` } },
        { email: { [Op.iLike]: `%${term}%` } },
        { phone: { [Op.iLike]: `%${term.replace(/[^\d+]/g, '') || term}%` } },
      ] }] }
      : {}),
  };

  const { rows, count } = await User.findAndCountAll({
    where,
    attributes: USER_LIST_ATTRIBUTES,
    include: [{
      model: Subscription,
      attributes: ['id', 'plan_title', 'status', 'end_date'],
      where: { status: 'active', end_date: { [Op.gt]: now } },
      required: false,
      separate: true,
    }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (currentPage - 1) * limit,
    distinct: true,
  });

  return {
    data: rows.map(toUserSummary),
    pagination: { page: currentPage, page_size: limit, total: count, total_pages: Math.ceil(count / limit) },
  };
};

/** One user with every plan and payment claim they have ever had. */
export const getUser = async (userId) => {
  const user = await User.findByPk(userId, { attributes: USER_LIST_ATTRIBUTES });
  if (!user) throw new AppError('User not found', 404);

  const [subscriptions, claims] = await Promise.all([
    Subscription.findAll({
      where: { user_id: user.id },
      attributes: ['id', 'course_id', 'plan_title', 'status', 'start_date', 'end_date', 'source', 'createdAt'],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    }),
    PaymentClaim.findAll({
      where: { user_id: user.id, submitted_at: { [Op.ne]: null } },
      attributes: [
        'id', 'reference_code', 'amount_expected', 'amount_claimed', 'utr', 'status',
        'submitted_at', 'reviewed_at', 'admin_note', 'subscription_id',
      ],
      include: [{ model: Course, as: 'course', attributes: ['id', 'title'] }],
      order: [['submitted_at', 'DESC']],
    }),
  ]);

  const now = new Date();
  return {
    ...user.toJSON(),
    account_status: accountStatusOf(user),
    subscriptions: subscriptions.map((s) => ({ ...s.toJSON(), is_live: Boolean(isLive(s, now)) })),
    payment_claims: claims,
  };
};

// ── Account actions ───────────────────────────────────────────────────────────

/** Admins are never banned or removed from here — no one can lock out the admin team, or themselves. */
const loadManageableUser = async (userId, adminId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  if (user.id === adminId) throw new AppError('You cannot do this to your own account', 400);
  if (user.role === 'admin') throw new AppError('Admin accounts cannot be banned or removed', 400);
  return user;
};

const cleanNote = (note, label) => {
  if (note == null || note === '') return null;
  if (typeof note !== 'string') throw new AppError(`${label} must be text`, 400);
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX) throw new AppError(`${label} must be ${NOTE_MAX} characters or fewer`, 400);
  return trimmed || null;
};

/**
 * Bans a user, permanently or for a number of days. A timed ban lifts itself
 * when banned_until passes. Re-banning an already banned user replaces the ban.
 */
export const banUser = async (userId, adminId, { days, reason } = {}) => {
  const user = await loadManageableUser(userId, adminId);

  let bannedUntil = null;
  if (days != null && days !== '') {
    const dayCount = Number(days);
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > BAN_DAYS_MAX) {
      throw new AppError(`Ban length must be a whole number of days from 1 to ${BAN_DAYS_MAX}`, 400);
    }
    bannedUntil = new Date(Date.now() + dayCount * 24 * 60 * 60 * 1000);
  }

  await user.update({
    banned_at: new Date(),
    banned_until: bannedUntil,
    ban_reason: cleanNote(reason, 'Reason'),
  });
  return getUser(user.id);
};

export const unbanUser = async (userId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  await user.update({ banned_at: null, banned_until: null, ban_reason: null });
  return getUser(user.id);
};

/** Soft delete: the account can no longer sign in, but nothing it owns is erased. */
export const removeUser = async (userId, adminId) => {
  const user = await loadManageableUser(userId, adminId);
  if (user.deleted_at) throw new AppError('This user has already been removed', 409);
  await user.update({ deleted_at: new Date() });
  return getUser(user.id);
};

export const restoreUser = async (userId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  if (!user.deleted_at) throw new AppError('This user is not removed', 409);
  await user.update({ deleted_at: null });
  return getUser(user.id);
};

// ── Plan actions ──────────────────────────────────────────────────────────────

export const grantPlan = async (userId, adminId, { course_id } = {}) => {
  if (!course_id) throw new AppError('Choose a plan to grant', 400);
  await grantSubscription(Number(userId), Number(course_id), { grantedBy: adminId, source: 'manual' });
  return getUser(userId);
};

const loadSubscription = async (subscriptionId, { transaction } = {}) => {
  const subscription = await Subscription.findByPk(subscriptionId, { transaction });
  if (!subscription) throw new AppError('Subscription not found', 404);
  return subscription;
};

/**
 * Records an admin action on the payment claim behind a subscription, if it has
 * one. Subscriptions have no notes column, so the claim is where the history of
 * "we took this away, and why" lives for anything that was paid for.
 */
const noteOnClaim = async (subscriptionId, text, { transaction } = {}) => {
  const claim = await PaymentClaim.findOne({ where: { subscription_id: subscriptionId }, transaction });
  if (!claim) return;
  const entry = `[${new Date().toISOString().slice(0, 10)}] ${text}`;
  await claim.update(
    { admin_note: claim.admin_note ? `${claim.admin_note}\n${entry}` : entry },
    { transaction }
  );
};

/**
 * Takes a plan away immediately. For a paid plan this is "revoking the
 * payment": access ends, and the claim keeps its record with the reason added.
 */
export const revokeSubscription = async (subscriptionId, adminId, { note } = {}) => {
  const reason = cleanNote(note, 'Note');
  const subscription = await loadSubscription(subscriptionId);
  if (subscription.status === 'revoked') throw new AppError('This plan is already revoked', 409);

  await sequelize.transaction(async (transaction) => {
    await subscription.update({ status: 'revoked' }, { transaction });
    await noteOnClaim(subscription.id, `Plan revoked by admin #${adminId}${reason ? `: ${reason}` : ''}`, { transaction });
  });
  return getUser(subscription.user_id);
};

/**
 * Extends a plan by a number of months, or moves its end to a given date. An
 * already expired plan is extended from today, not from its old end date, so
 * the admin gets the length they asked for.
 */
export const extendSubscription = async (subscriptionId, { months, end_date } = {}) => {
  const subscription = await loadSubscription(subscriptionId);
  if (subscription.status === 'revoked') {
    throw new AppError('A revoked plan cannot be extended — grant the plan again instead', 409);
  }

  const now = new Date();
  let newEnd;
  if (end_date) {
    newEnd = new Date(end_date);
    if (Number.isNaN(newEnd.getTime())) throw new AppError('End date is not a valid date', 400);
    if (newEnd <= now) throw new AppError('End date must be in the future', 400);
  } else {
    const monthCount = Number(months);
    if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > EXTEND_MONTHS_MAX) {
      throw new AppError(`Extend by a whole number of months from 1 to ${EXTEND_MONTHS_MAX}`, 400);
    }
    const currentEnd = subscription.end_date ? new Date(subscription.end_date) : now;
    newEnd = new Date(Math.max(currentEnd.getTime(), now.getTime()));
    newEnd.setMonth(newEnd.getMonth() + monthCount);
  }

  await subscription.update({ end_date: newEnd, status: 'active' });
  return getUser(subscription.user_id);
};

/**
 * Moves a user from one plan to another. The old plan is revoked and the new
 * one runs until the same end date, so an upgrade or downgrade changes what
 * they can open, not how long they have. Extend afterwards if they paid for more.
 */
export const changePlan = async (subscriptionId, adminId, { course_id } = {}) => {
  if (!course_id) throw new AppError('Choose the new plan', 400);
  const subscription = await loadSubscription(subscriptionId);
  if (!isLive(subscription)) {
    throw new AppError('Only a current plan can be changed — grant the new plan instead', 409);
  }
  if (Number(course_id) === subscription.course_id) throw new AppError('That is already their plan', 400);

  const course = await Course.findByPk(course_id);
  if (!course) throw new AppError('Plan not found', 404);

  const grantedSections = await resolveCourseSections(course);
  if (grantedSections.length === 0) {
    throw new AppError(`"${course.title}" does not grant access to any section yet. Set its sections first.`, 409);
  }

  const alreadyHas = await Subscription.findOne({
    where: { user_id: subscription.user_id, course_id: course.id, status: 'active', end_date: { [Op.gt]: new Date() } },
  });
  if (alreadyHas) throw new AppError(`This user already has an active "${course.title}" plan`, 409);

  await sequelize.transaction(async (transaction) => {
    await subscription.update({ status: 'revoked' }, { transaction });
    await Subscription.create({
      user_id: subscription.user_id,
      course_id: course.id,
      start_date: new Date(),
      end_date: subscription.end_date,
      status: 'active',
      granted_sections: grantedSections,
      plan_title: course.title,
      granted_by: adminId,
      source: 'manual',
    }, { transaction });
    await noteOnClaim(
      subscription.id,
      `Plan changed to "${course.title}" by admin #${adminId}`,
      { transaction }
    );
  });
  return getUser(subscription.user_id);
};

// ── Export ────────────────────────────────────────────────────────────────────

// Date only: with a time attached, Excel needs a wider column than its default
// and shows the cell as ####.
const fmtDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

const planStatusOf = (subscription) => {
  if (!subscription) return '';
  if (subscription.status === 'revoked') return 'Revoked';
  return isLive(subscription) ? 'Active' : 'Expired';
};

/**
 * Everyone who has paid, as a CSV: one row per approved payment, with the
 * student's profile alongside it. Never includes the password hash or the
 * avatar's storage key.
 */
export const exportPaidUsersCsv = async () => {
  const claims = await PaymentClaim.findAll({
    where: { status: 'approved' },
    attributes: ['id', 'user_id', 'reference_code', 'utr', 'amount_expected', 'amount_claimed', 'reviewed_at'],
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'fullName', 'email', 'phone', 'country', 'professionalRole', 'graduationYear', 'amcExamDate'],
      },
      { model: Course, as: 'course', attributes: ['title'] },
      { model: Subscription, as: 'subscription', attributes: ['plan_title', 'status', 'start_date', 'end_date'] },
    ],
    order: [['reviewed_at', 'DESC'], ['id', 'DESC']],
  });

  const userIds = [...new Set(claims.map((claim) => claim.user_id))];
  const referrals = userIds.length
    ? await Referral.findAll({ where: { referred_user_id: userIds }, attributes: ['referred_user_id', 'code_used'] })
    : [];
  const referralCodeByUser = new Map(referrals.map((r) => [r.referred_user_id, r.code_used]));

  const header = [
    'User ID', 'Name', 'Email', 'WhatsApp number', 'Country', 'Professional role', 'Graduation year', 'AMC exam date', 'Referral code used',
    'Plan purchased', 'Payment reference', 'UTR', 'Amount due (INR)', 'Amount paid (INR)',
    'Plan status', 'Plan start', 'Plan end',
  ];

  const rows = claims.map((claim) => {
    const { user, subscription } = claim;
    return [
      user?.id, user?.fullName, user?.email,
      // Leading tab keeps Excel from reading "+61…" as a formula or a number.
      user?.phone ? `\t${user.phone}` : '',
      user?.country, user?.professionalRole, user?.graduationYear, user?.amcExamDate ?? '',
      referralCodeByUser.get(claim.user_id) ?? '',
      subscription?.plan_title ?? claim.course?.title, claim.reference_code,
      // A leading tab makes Excel keep the 12-digit UTR as text; read as a
      // number it is shown as 1.23457E+11 and the last digits are lost.
      claim.utr ? `\t${claim.utr}` : '',
      claim.amount_expected, claim.amount_claimed ?? claim.amount_expected,
      planStatusOf(subscription), fmtDay(subscription?.start_date), fmtDay(subscription?.end_date),
    ];
  });

  const today = new Date().toISOString().slice(0, 10);
  return { filename: `paid-students-${today}.csv`, body: toCsv(header, rows) };
};
