import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { sequelize, User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { ensureUserCode, recordReferralOnSignup } from './referral.service.js';
import {
  PROFESSIONAL_ROLE_VALUES,
  COUNTRY_CODES,
  GRADUATION_YEAR_MIN,
  graduationYearMax,
} from '../constants/registration.js';

export const register = async ({
  fullName,
  email,
  password,
  professionalRole,
  country,
  graduationYear,
  referralCode,
}) => {
  const name = (fullName ?? '').trim();
  const cleanEmail = (email ?? '').trim();

  if (!name) throw new AppError('Full name is required', 400);
  if (!cleanEmail) throw new AppError('Email is required', 400);
  if (!password || password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400);
  }

  if (!PROFESSIONAL_ROLE_VALUES.includes(professionalRole)) {
    throw new AppError('Please select your current role', 400);
  }
  if (!COUNTRY_CODES.includes(country)) {
    throw new AppError('Please select your country', 400);
  }

  const year = Number(graduationYear);
  const maxYear = graduationYearMax();
  if (!Number.isInteger(year) || year < GRADUATION_YEAR_MIN || year > maxYear) {
    throw new AppError(
      `Year of graduation must be between ${GRADUATION_YEAR_MIN} and ${maxYear}`,
      400
    );
  }

  const existing = await User.findOne({ where: { email: cleanEmail } });
  if (existing) throw new AppError('An account with this email already exists', 409);

  const hashed = await bcrypt.hash(password, 10);

  // One transaction for the account, its own referral code, and — if they came
  // in on someone's code — the attribution row. A half-registered user with no
  // referral code is exactly the drift the lazy fallback in referral.service.js
  // exists to paper over, but there is no reason to lean on it at signup.
  const transaction = await sequelize.transaction();
  try {
    const user = await User.create(
      {
        fullName: name,
        email: cleanEmail,
        password: hashed,
        professionalRole,
        country,
        graduationYear: year,
      },
      { transaction }
    );

    await ensureUserCode(user, { transaction });
    // Best-effort: an unknown, inactive or self code records nothing and does
    // not fail the signup.
    await recordReferralOnSignup(user.id, referralCode, { transaction });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    // Two requests for the same email can both clear the check above; the unique
    // index is what actually decides, so report it the same way.
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('An account with this email already exists', 409);
    }
    throw err;
  }

  return { message: 'User registered successfully' };
};

export const login = async (email, password) => {
  const user = await User.findOne({ where: { email } });
  // Same message either way — a distinct "user not found" tells an attacker
  // which addresses are registered.
  if (!user) throw new AppError('Invalid email or password', 401);

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) throw new AppError('Invalid email or password', 401);

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Never ship the password hash to the client — it ends up in localStorage.
  // avatarUrl is a raw S3 key with no client use; expose only whether one is set
  // (the picture itself comes from GET /api/me/avatar).
  const { password: _hash, avatarUrl, ...safeUser } = user.toJSON();

  return { token, user: { ...safeUser, hasAvatar: Boolean(avatarUrl) } };
};
