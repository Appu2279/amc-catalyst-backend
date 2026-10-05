/**
 * Whether a ban is in force right now. A timed ban whose banned_until has passed
 * counts as lifted — that is the whole auto-unban mechanism.
 */
export const isBanActive = (user, now = new Date()) =>
  Boolean(user.banned_at) && (user.banned_until == null || new Date(user.banned_until) > now);

/** The message a banned user sees, saying when (or whether) it ends. */
export const banMessage = (user) => {
  const until = user.banned_until
    ? ` until ${new Date(user.banned_until).toUTCString()}`
    : '';
  const reason = user.ban_reason ? ` Reason: ${user.ban_reason}` : '';
  return `Your account has been suspended${until}.${reason}`;
};
