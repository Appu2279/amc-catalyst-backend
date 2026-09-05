/**
 * Referral programme constants.
 *
 * The programme is a switch, not a fixed policy: it starts generous and is
 * expected to be dialled down or turned off entirely once the app is
 * established. Everything that a reward is calculated from is therefore read
 * live from ReferralConfig, and snapshotted onto the reward row the moment it
 * is earned — changing the rate tomorrow never rewrites what someone is already
 * owed.
 */

export const REFERRAL_MODES = Object.freeze({
  // Referrer earns the reward; the person they referred also gets the same
  // amount, tracked as credit.
  BOTH: 'both',
  // Only the referrer earns.
  REFERRER_ONLY: 'referrer_only',
  // No rewards accrue. Attribution is still recorded so the history stays
  // continuous, but nothing is owed.
  OFF: 'off',
});

export const REFERRAL_MODE_VALUES = Object.freeze(Object.values(REFERRAL_MODES));

export const DEFAULT_REFERRAL_MODE = REFERRAL_MODES.BOTH;
export const DEFAULT_REFERRAL_REWARD_AMOUNT = 1000;
export const DEFAULT_REFERRAL_CURRENCY = 'INR';

// A referral moves joined -> qualified when the referred user's first payment is
// approved, then qualified -> rewarded once every reward on it is settled.
export const REFERRAL_STATUS = Object.freeze({
  JOINED: 'joined',
  QUALIFIED: 'qualified',
  REWARDED: 'rewarded',
});

export const REWARD_KIND = Object.freeze({
  REFERRER: 'referrer',
  REFEREE: 'referee',
});

export const REWARD_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  CANCELLED: 'cancelled',
});

// Read off a screen and typed into a phone — no I, O, 0, 1.
export const CODE_SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_SUFFIX_LENGTH = 4;

// Bounds for an admin-entered partner code ("WINGX"). Uppercase A–Z, digits and
// single dashes only, so it survives being written in an Instagram caption.
export const PARTNER_CODE_MIN = 3;
export const PARTNER_CODE_MAX = 24;
export const PARTNER_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/**
 * Normalises any code string to the stored form: trimmed, uppercased, inner
 * whitespace collapsed to nothing. Comparisons and lookups all go through this.
 */
export const normaliseCode = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
