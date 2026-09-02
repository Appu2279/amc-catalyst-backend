import { Op } from 'sequelize';
import { Subscription, Note, Question, MockTest, ImportBatch } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { SECTIONS, SECTION_KEYS, normaliseSections } from '../constants/sections.js';

/**
 * The single place "may this user open this?" is answered.
 *
 * Everything is decided from the subscription's own snapshot — never from the
 * Course it points at. A plan that has since been renamed, narrowed or retired
 * has no bearing on access already sold; see subscription.model.js for why the
 * snapshot exists.
 *
 * Deny by default. A user with no rows, an expired row, a revoked row, or a row
 * written before snapshots existed and never backfilled gets nothing. That is
 * the right failure direction for a paywall, but it does mean the backfill in
 * scripts/migrate-subscription-entitlements.js is not optional — without it,
 * every subscription sold before this shipped goes dark.
 */

/**
 * Every section key this user may currently use, as a Set.
 *
 * A user can hold more than one subscription — a Notes plan bought in March and
 * a Mocks plan bought in June — so entitlements are the union across all live
 * rows, not whatever the newest one says.
 */
export const getEntitlements = async (userId) => {
  const subscriptions = await Subscription.findAll({
    where: {
      user_id: userId,
      status: 'active',
      // Excludes NULL end_date, which is deliberate: grantSubscription always
      // sets one, so a null here is a legacy or half-written row and not
      // something to hand access out on.
      end_date: { [Op.gt]: new Date() },
    },
    attributes: ['granted_sections'],
  });

  const granted = new Set();

  for (const subscription of subscriptions) {
    // Normalised on read as well as write: a snapshot taken months ago may name
    // a section that has since been renamed or dropped, and an unknown key
    // should quietly grant nothing rather than throw.
    for (const section of normaliseSections(subscription.granted_sections)) {
      granted.add(section);
    }
  }

  return granted;
};

/**
 * Whether a user holds one section. Convenience over getEntitlements for the
 * common single-check case.
 */
export const hasSection = async (user, section) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (await getEntitlements(user.id)).has(section);
};

/**
 * Throws unless the user may use `section`.
 *
 * Admins pass unconditionally — they need to preview and support every part of
 * the product, and the alternative is giving staff accounts fake subscriptions.
 *
 * The 403 says which plan feature is missing rather than just "forbidden", so
 * the client can send the user somewhere useful instead of showing a dead end.
 */
export const assertSectionAccess = async (section, user) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'admin') return;

  const granted = await getEntitlements(user.id);
  if (granted.has(section)) return;

  throw new AppError(`Your current plan does not include ${SECTION_LABELS[section] ?? section}`, 403);
};

/**
 * Restricts a set of requested sections to the ones the user actually holds.
 *
 * For listing endpoints that can legitimately return a mix — "show me my
 * practice questions" with no filter — where the right answer is everything
 * they are entitled to rather than a 403. Returns an empty array when they hold
 * none of them, which callers must treat as "return nothing", never as "no
 * filter".
 */
export const restrictToEntitled = async (user, requested) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'admin') return [...requested];

  const granted = await getEntitlements(user.id);
  return requested.filter((section) => granted.has(section));
};

/**
 * Everything the client needs to render access: which sections are open, and
 * the live subscriptions behind them.
 *
 * `sections` is an object covering every known key rather than a list of the
 * ones held, so the client can ask `sections.mocks` directly without keeping
 * its own copy of the key list in sync with this one.
 *
 * Admins get everything with `admin_override` set, so the UI can unlock the
 * product without also claiming they hold a plan they never bought.
 */
export const getAccessSummary = async (user) => {
  if (!user) throw new AppError('Unauthorized', 401);

  const isAdmin = user.role === 'admin';

  const subscriptions = await Subscription.findAll({
    where: {
      user_id: user.id,
      status: 'active',
      end_date: { [Op.gt]: new Date() },
    },
    attributes: ['id', 'plan_title', 'granted_sections', 'start_date', 'end_date'],
    order: [['end_date', 'DESC']],
  });

  const granted = new Set();
  for (const subscription of subscriptions) {
    for (const section of normaliseSections(subscription.granted_sections)) granted.add(section);
  }

  const now = Date.now();

  return {
    // How many free samples exist in each section, so the client can tell
    // "locked, nothing to see" apart from "locked, but here is a taste". Those
    // are different screens: one is a dead end, the other is the pitch.
    samples: await sampleCounts(),
    // Admins are unlocked by role, not by subscription — see assertSectionAccess.
    sections: Object.fromEntries(
      SECTION_KEYS.map((key) => [key, isAdmin || granted.has(key)])
    ),
    admin_override: isAdmin,
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      plan_title: subscription.plan_title,
      sections: normaliseSections(subscription.granted_sections),
      start_date: subscription.start_date,
      end_date: subscription.end_date,
      // Rounded up, so the last partial day still reads as "1 day left" rather
      // than "0" while access is genuinely still working.
      days_remaining: Math.max(
        0,
        Math.ceil((new Date(subscription.end_date).getTime() - now) / 86400000)
      ),
    })),
  };
};

/**
 * Free samples available per section, for everyone — this is a property of the
 * catalogue, not of the viewer, so it is not scoped to a user.
 *
 * Counted rather than listed: the client only needs to know whether there is
 * anything worth showing, and the section pages fetch the actual rows through
 * their own endpoints, which apply the same rules.
 */
const sampleCounts = async () => {
  // A recall question is a sample either on its own flag or because its whole
  // month has been opened — the batch is the unit recall is actually managed
  // in, so counting only the per-question flag would report zero for the
  // common case.
  const freeBatches = await ImportBatch.findAll({
    where: { is_free: true, is_visible: true },
    attributes: ['id'],
  });
  const freeBatchIds = freeBatches.map((b) => b.id);

  const sampleClause = freeBatchIds.length
    ? { [Op.or]: [{ is_free: true }, { import_batch_id: { [Op.in]: freeBatchIds } }] }
    : { is_free: true };

  const [notes, qbank, recall, mocks] = await Promise.all([
    Note.count({ where: { is_free: true, is_active: true } }),
    Question.count({
      where: { is_active: true, source_type: ['qbank', 'previous_year'], ...sampleClause },
    }),
    Question.count({ where: { is_active: true, source_type: 'recall', ...sampleClause } }),
    MockTest.count({ where: { is_free: true, is_published: true } }),
  ]);

  return {
    [SECTIONS.NOTES]: notes,
    [SECTIONS.QBANK]: qbank,
    [SECTIONS.RECALL]: recall,
    [SECTIONS.MOCKS]: mocks,
  };
};

/** Wording for the 403s above. Keys are section keys. */
const SECTION_LABELS = Object.freeze({
  [SECTIONS.NOTES]: 'study notes',
  [SECTIONS.QBANK]: 'the question bank',
  [SECTIONS.RECALL]: 'recalls',
  [SECTIONS.MOCKS]: 'mock exams',
});
