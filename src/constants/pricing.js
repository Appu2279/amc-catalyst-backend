/**
 * Global pricing constants.
 *
 * Course prices are entered in AUD; INR — the currency actually collected,
 * since payment is a UPI transfer — is computed live from this rate rather
 * than stored, so nudging the rate updates every course's displayed and
 * charged INR amount at once instead of needing each course re-priced by
 * hand. See PricingConfig / pricingConfig.service.js.
 */

// A sane seed for the singleton row's first read, not a promise of accuracy —
// whoever turns this feature on is expected to confirm/update it from the
// admin screen before relying on it. Sourced from the market rate at the time
// this was built (~September 2026); it will drift.
export const DEFAULT_AUD_TO_INR_RATE = 68.4;
