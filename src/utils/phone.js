import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AppError } from './AppError.js';

/**
 * Validates a phone number and returns it in E.164 form (e.g. +61412345678),
 * which is what is stored: one unambiguous format that also works directly as
 * a WhatsApp link. Expects the number to already carry its country code.
 */
export const normalisePhone = (value) => {
  const parsed = parsePhoneNumberFromString(String(value ?? '').trim());
  if (!parsed || !parsed.isValid()) {
    throw new AppError('Please check your WhatsApp number and the country code selected next to it', 400);
  }
  return parsed.number;
};
