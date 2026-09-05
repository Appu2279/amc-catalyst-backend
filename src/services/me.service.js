import bcrypt from 'bcrypt';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import {
  uploadAvatar,
  getObjectBuffer,
  destroyObject,
  isStorageConfigured,
} from '../config/storage.js';
import {
  PROFESSIONAL_ROLE_VALUES,
  COUNTRY_CODES,
  GRADUATION_YEAR_MIN,
  graduationYearMax,
} from '../constants/registration.js';

/**
 * The account as the client is allowed to see it.
 *
 * The password hash must never leave the server. avatarUrl holds a raw S3 key,
 * which the browser has no use for and should not see — it is replaced with a
 * plain `hasAvatar` flag; the picture itself is fetched through GET
 * /api/me/avatar.
 */
export const toProfile = (user) => {
  const { password, avatarUrl, ...rest } = user.toJSON();
  return { ...rest, hasAvatar: Boolean(avatarUrl) };
};

export const getProfile = async (userId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('Account not found', 404);
  return toProfile(user);
};

/**
 * Edits the caller's own account.
 *
 * Every field is optional — the client sends only what changed. The same option
 * lists and bounds the register endpoint enforces are applied here, so a profile
 * edit can never put a value into the row that registration would have rejected.
 *
 * Changing the password requires the current one: the token alone is a stolen
 * laptop, and a password change is what locks the real owner back out.
 */
export const updateProfile = async (userId, payload = {}) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('Account not found', 404);

  const updates = {};

  if (payload.fullName !== undefined) {
    const name = String(payload.fullName).trim();
    if (!name) throw new AppError('Full name is required', 400);
    updates.fullName = name;
  }

  if (payload.email !== undefined) {
    const email = String(payload.email).trim();
    if (!email) throw new AppError('Email is required', 400);
    if (email !== user.email) {
      const taken = await User.findOne({ where: { email } });
      if (taken) throw new AppError('An account with this email already exists', 409);
      updates.email = email;
    }
  }

  if (payload.professionalRole !== undefined) {
    if (!PROFESSIONAL_ROLE_VALUES.includes(payload.professionalRole)) {
      throw new AppError('Please select your current role', 400);
    }
    updates.professionalRole = payload.professionalRole;
  }

  if (payload.country !== undefined) {
    if (!COUNTRY_CODES.includes(payload.country)) {
      throw new AppError('Please select your country', 400);
    }
    updates.country = payload.country;
  }

  if (payload.graduationYear !== undefined) {
    const year = Number(payload.graduationYear);
    const maxYear = graduationYearMax();
    if (!Number.isInteger(year) || year < GRADUATION_YEAR_MIN || year > maxYear) {
      throw new AppError(
        `Year of graduation must be between ${GRADUATION_YEAR_MIN} and ${maxYear}`,
        400
      );
    }
    updates.graduationYear = year;
  }

  if (payload.newPassword !== undefined && payload.newPassword !== '') {
    if (payload.newPassword.length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }
    const current = String(payload.currentPassword ?? '');
    const ok = current && (await bcrypt.compare(current, user.password));
    if (!ok) throw new AppError('Current password is incorrect', 400);
    updates.password = await bcrypt.hash(payload.newPassword, 10);
  }

  if (Object.keys(updates).length === 0) {
    return toProfile(user);
  }

  try {
    await user.update(updates);
  } catch (err) {
    // A concurrent signup can take the email between the check above and here;
    // the unique index is the real arbiter, so report it the same way.
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('An account with this email already exists', 409);
    }
    throw err;
  }

  return toProfile(user);
};

/**
 * Replaces the caller's profile picture.
 *
 * The old object is deleted after the new one is stored — best effort, because a
 * leaked S3 object is cheaper than a request that fails on a cleanup error after
 * the user's picture has already changed.
 */
export const setAvatar = async (userId, { buffer, contentType }) => {
  if (!isStorageConfigured) {
    throw new AppError('File storage is not configured on this server', 503);
  }
  if (!buffer?.length) throw new AppError('No image was uploaded', 400);

  const user = await User.findByPk(userId);
  if (!user) throw new AppError('Account not found', 404);

  const previousKey = user.avatarUrl;
  const key = `avatars/${userId}-${Date.now()}`;

  await uploadAvatar(buffer, key, contentType || 'image/jpeg');
  await user.update({ avatarUrl: key });

  if (previousKey && previousKey !== key) {
    destroyObject(previousKey).catch((err) =>
      console.error(`Deleting old avatar ${previousKey} failed:`, err.message)
    );
  }

  return toProfile(user);
};

export const removeAvatar = async (userId) => {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('Account not found', 404);

  const key = user.avatarUrl;
  if (!key) return toProfile(user);

  await user.update({ avatarUrl: null });
  destroyObject(key).catch((err) =>
    console.error(`Deleting avatar ${key} failed:`, err.message)
  );

  return toProfile(user);
};

/** The caller's avatar bytes, for streaming back. 404 when there is none. */
export const getAvatarObject = async (userId) => {
  if (!isStorageConfigured) {
    throw new AppError('File storage is not configured on this server', 503);
  }
  const user = await User.findByPk(userId, { attributes: ['avatarUrl'] });
  if (!user?.avatarUrl) throw new AppError('No profile picture', 404);
  return getObjectBuffer(user.avatarUrl);
};
