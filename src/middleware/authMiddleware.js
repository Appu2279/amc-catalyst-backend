import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { isBanActive, banMessage } from '../utils/accountStatus.js';

const ACCOUNT_ATTRIBUTES = ['id', 'role', 'banned_at', 'banned_until', 'ban_reason', 'deleted_at'];

/**
 * Tokens live for 7 days, so the token alone cannot say whether the account was
 * banned or removed since it was issued. Every authenticated request re-reads
 * the account — one primary-key lookup — so a ban takes effect immediately.
 * The role is taken from the database too, for the same reason.
 */
const loadAccount = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return User.findByPk(decoded.id, { attributes: ACCOUNT_ATTRIBUTES });
};

export const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  let account;
  try {
    account = await loadAccount(token);
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (!account || account.deleted_at) {
    return res.status(401).json({ code: 'ACCOUNT_REMOVED', message: 'This account no longer exists' });
  }
  if (isBanActive(account)) {
    return res.status(403).json({ code: 'ACCOUNT_BANNED', message: banMessage(account) });
  }

  req.user = { id: account.id, role: account.role };
  next();
};

// For routes that are public but behave differently for a signed-in admin
// (e.g. the courses list including inactive plans for management). A missing
// or invalid token is not an error here — it just means req.user stays unset.
// A banned or removed account is treated as signed out.
export const attachUserIfPresent = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();

  try {
    const account = await loadAccount(token);
    if (account && !account.deleted_at && !isBanActive(account)) {
      req.user = { id: account.id, role: account.role };
    }
  } catch {
    // Ignore — the caller falls back to unauthenticated behaviour.
  }
  next();
};
