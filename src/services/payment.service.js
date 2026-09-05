import crypto from 'crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import { sequelize, PaymentClaim, Course, CoursePricing, User, Subscription } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { grantSubscription } from './course.service.js';
import { qualifyReferralForPayment } from './referral.service.js';
import { uploadPaymentScreenshot, isStorageConfigured } from '../config/storage.js';
import { sendPaymentApprovedEmail } from './email.service.js';

/**
 * The manual payment workflow: a user says they paid by QR, an admin checks the
 * bank statement, and approving is what creates the subscription.
 *
 * Nothing in here treats a claim as evidence. A screenshot is a picture anyone
 * can produce and a UTR is a string anyone can type; both exist so a human can
 * find the transaction in a bank statement, which is the only thing that
 * actually confirms a payment.
 */

// No I, O, 0 or 1 — this gets read off a screen and typed into a payment app's
// remarks field, and those four are where transcription goes wrong.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

const generateReferenceCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `AMC-${code}`;
};

/**
 * What a course costs right now.
 *
 * The discounted price wins when set — that is the number on the pricing card,
 * so it is the number the buyer will transfer.
 */
const priceOf = async (courseId) => {
  const pricing = await CoursePricing.findOne({
    where: { course_id: courseId },
    order: [['id', 'DESC']],
  });

  if (!pricing) throw new AppError('This plan has no price set yet', 409);

  const amount = pricing.discounted_price ?? pricing.actual_price;
  if (amount === null || amount === undefined) {
    throw new AppError('This plan has no price set yet', 409);
  }

  return amount;
};

const CLAIM_PUBLIC_ATTRIBUTES = [
  'id',
  'course_id',
  'reference_code',
  'amount_expected',
  'amount_claimed',
  'currency',
  'utr',
  'status',
  'submitted_at',
  'admin_note',
  'createdAt',
];

/**
 * Opens a claim, or returns the one already open.
 *
 * Called when the user reaches the QR page rather than when they say they have
 * paid, because the reference code has to be on screen *before* they transfer
 * anything — its whole purpose is to appear in the payment remarks so a
 * transfer can be matched to a person even if they never come back.
 *
 * Idempotent by design. A refresh, a back button or a second tab must not open
 * a second claim; the partial unique index would refuse it anyway, and a 500
 * from a constraint is not an answer to "the user reloaded the page".
 */
export const startClaim = async (userId, courseId) => {
  const course = await Course.findByPk(courseId);
  if (!course) throw new AppError('Course not found', 404);
  if (!course.is_active) throw new AppError('This plan is not on sale', 409);

  const existing = await PaymentClaim.findOne({
    where: { user_id: userId, course_id: courseId, status: 'pending' },
  });
  if (existing) return existing;

  // Already own it? Selling a second copy of the same active subscription is
  // never what anyone meant, and grantSubscription would refuse at approval
  // time — better to say so before they send money.
  const active = await Subscription.findOne({
    where: {
      user_id: userId,
      course_id: courseId,
      status: 'active',
      end_date: { [Op.gt]: new Date() },
    },
  });
  if (active) {
    throw new AppError('You already have an active subscription to this plan', 409);
  }

  const amountExpected = await priceOf(courseId);

  // Two unique constraints can refuse this insert, and they mean opposite
  // things.
  //
  // The partial index on (user_id, course_id) WHERE pending means a concurrent
  // request already opened this buyer's claim — a double-click, a refresh, two
  // tabs, or React re-running an effect. That row is exactly what the caller
  // wants, so hand it back rather than failing: the endpoint has to be
  // idempotent under concurrency, not just when called twice in sequence.
  //
  // A reference_code collision means we drew a code already in use. Vanishingly
  // rare at 32^5, but the answer is simply to draw another.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await PaymentClaim.create({
        user_id: userId,
        course_id: courseId,
        reference_code: generateReferenceCode(),
        amount_expected: amountExpected,
      });
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;

      const concurrent = await PaymentClaim.findOne({
        where: { user_id: userId, course_id: courseId, status: 'pending' },
      });
      if (concurrent) return concurrent;
      // No open claim, so it was the code that clashed — loop and redraw.
    }
  }

  throw new AppError('Could not start checkout, please try again', 500);
};

/**
 * Records that the user says they have paid.
 *
 * The UTR is required. It is the only field on the whole form an admin can act
 * on — it is what gets searched for in the bank statement — and a claim without
 * one is a support conversation rather than a queue item.
 */
export const submitClaim = async (
  userId,
  claimId,
  { utr, amount_claimed, screenshot, screenshotContentType }
) => {
  const claim = await PaymentClaim.findOne({ where: { id: claimId, user_id: userId } });
  if (!claim) throw new AppError('Payment claim not found', 404);

  if (claim.status !== 'pending') {
    throw new AppError(`This claim has already been ${claim.status}`, 409);
  }

  const reference = typeof utr === 'string' ? utr.trim() : '';
  if (!reference) {
    throw new AppError(
      'The UPI/bank reference number (UTR) is required — it is how we find your payment',
      400
    );
  }

  // Holds the S3 key, not a URL — the field name is a holdover from
  // Cloudinary. Renaming the column is not worth a migration for what is
  // otherwise a one-word mismatch; streamScreenshot in payment.controller.js
  // reads it back as a key.
  let screenshotKey = claim.screenshot_url;

  if (screenshot) {
    if (!isStorageConfigured) {
      throw new AppError('File storage is not configured on this server', 503);
    }

    // Deliberately not fatal. The screenshot is supporting evidence; losing it
    // must not cost the user the UTR they just typed, which is the part that
    // matters.
    try {
      const key = `payment-claims/${claim.id}-${Date.now()}`;
      await uploadPaymentScreenshot(screenshot, key, screenshotContentType);
      screenshotKey = key;
    } catch (err) {
      console.error(`Screenshot upload failed for claim ${claim.id}:`, err.message);
    }
  }

  await claim.update({
    utr: reference,
    amount_claimed: amount_claimed ?? null,
    screenshot_url: screenshotKey,
    submitted_at: new Date(),
  });

  return claim;
};

/** A user's own claims, newest first — this is what the "under review" banner reads. */
export const listMyClaims = (userId) =>
  PaymentClaim.findAll({
    where: { user_id: userId },
    attributes: CLAIM_PUBLIC_ATTRIBUTES,
    include: [{ model: Course, as: 'course', attributes: ['id', 'title'] }],
    order: [['id', 'DESC']],
  });

// ── Admin ─────────────────────────────────────────────────────────────────────

/**
 * The review queue.
 *
 * Defaults to submitted claims only. A pending row with no submitted_at is
 * someone who opened the QR page and left; showing those would bury the ones
 * actually waiting on a decision.
 *
 * Oldest first, because the queue is a promise with a deadline attached.
 */
export const listClaims = async ({ status = 'pending', include_unsubmitted } = {}) => {
  const claims = await PaymentClaim.findAll({
    where: {
      status,
      ...(include_unsubmitted ? {} : { submitted_at: { [Op.ne]: null } }),
    },
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
      { model: Course, as: 'course', attributes: ['id', 'title'] },
      { model: User, as: 'reviewer', attributes: ['id', 'fullName'] },
    ],
    order: [
      ['submitted_at', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  // Same UTR on more than one claim is either a mistake or someone trying to
  // buy twice with one payment. Flagged rather than blocked — the admin needs
  // to see both rows to work out which.
  const utrs = claims.map((claim) => claim.utr).filter(Boolean);
  const duplicates = new Set();

  if (utrs.length) {
    const matches = await PaymentClaim.findAll({
      where: { utr: { [Op.in]: utrs } },
      attributes: ['id', 'utr'],
    });

    const seen = new Map();
    for (const match of matches) {
      seen.set(match.utr, (seen.get(match.utr) ?? 0) + 1);
    }
    for (const [utr, count] of seen) {
      if (count > 1) duplicates.add(utr);
    }
  }

  return claims.map((claim) => ({
    ...claim.toJSON(),
    // True when this UTR appears on another claim as well, whatever its status.
    duplicate_utr: Boolean(claim.utr && duplicates.has(claim.utr)),
    amount_matches:
      claim.amount_claimed === null ||
      Number(claim.amount_claimed) === Number(claim.amount_expected),
  }));
};

/**
 * Approves a claim and grants the subscription it was for.
 *
 * One transaction: a claim marked approved with no subscription behind it — or
 * a subscription with the claim still sitting in the queue — is exactly the
 * kind of drift that makes a manual process untrustworthy.
 */
export const approveClaim = async (claimId, adminId, { note } = {}) => {
  const claim = await PaymentClaim.findByPk(claimId, {
    include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email'] }],
  });
  if (!claim) throw new AppError('Payment claim not found', 404);

  if (claim.status !== 'pending') {
    throw new AppError(`This claim has already been ${claim.status}`, 409);
  }

  const transaction = await sequelize.transaction();
  try {
    const subscription = await grantSubscription(claim.user_id, claim.course_id, {
      grantedBy: adminId,
      source: 'payment_claim',
      transaction,
    });

    await claim.update(
      {
        status: 'approved',
        subscription_id: subscription.id,
        reviewed_by: adminId,
        reviewed_at: new Date(),
        admin_note: note ?? claim.admin_note,
      },
      { transaction }
    );

    // If this buyer was referred, their first approved payment is what makes
    // the referral count. Safe to call on every approval — only the first one
    // moves anything (see qualifyReferralForPayment). In the same transaction
    // so a committed approval always carries its referral side-effects.
    await qualifyReferralForPayment(claim.user_id, claim.id, { transaction });

    await transaction.commit();

    // Outside the transaction and deliberately not awaited into a failure
    // path: the approval has already happened, and a slow or failed email
    // must not turn a successful admin action into an error response.
    sendPaymentApprovedEmail(claim.user, subscription);

    return { claim, subscription };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

/**
 * Rejects a claim. The note is required — a rejection with no reason is
 * unanswerable when the user asks why, which they will.
 */
export const rejectClaim = async (claimId, adminId, { note } = {}) => {
  const reason = typeof note === 'string' ? note.trim() : '';
  if (!reason) throw new AppError('A reason is required when rejecting a claim', 400);

  const claim = await PaymentClaim.findByPk(claimId);
  if (!claim) throw new AppError('Payment claim not found', 404);

  if (claim.status !== 'pending') {
    throw new AppError(`This claim has already been ${claim.status}`, 409);
  }

  await claim.update({
    status: 'rejected',
    reviewed_by: adminId,
    reviewed_at: new Date(),
    admin_note: reason,
  });

  return claim;
};

/** One claim in full, for the review screen. */
export const getClaim = async (claimId) => {
  const claim = await PaymentClaim.findByPk(claimId, {
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
      { model: Course, as: 'course', attributes: ['id', 'title'] },
      { model: User, as: 'reviewer', attributes: ['id', 'fullName'] },
    ],
  });
  if (!claim) throw new AppError('Payment claim not found', 404);
  return claim;
};
