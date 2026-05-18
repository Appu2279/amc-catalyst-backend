import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

export const register = async (fullName, email, password) => {
  const hashed = await bcrypt.hash(password, 10);
  await User.create({ fullName, email, password: hashed });
  return { message: 'User registered successfully' };
};

export const login = async (email, password) => {
  const user = await User.findOne({ where: { email } });
  if (!user) throw new AppError('User not found', 400);

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) throw new AppError('Invalid password', 400);

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { token, user };
};
