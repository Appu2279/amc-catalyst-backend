// =============================================
// config/email.js
// =============================================
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.RESEND_API_KEY?.trim();
// "AMC Catalyst <support@amccatalyst.com>" — the address must be on a domain
// verified in the Resend dashboard, or sends are rejected.
const from = process.env.EMAIL_FROM?.trim();

export const isEmailConfigured = Boolean(apiKey && from);

const resend = isEmailConfigured ? new Resend(apiKey) : null;

/**
 * Fire-and-log, never fire-and-throw: a failed send must not undo whatever
 * database change it was announcing (see the caller in payment.service.js).
 * Same reasoning as the screenshot upload in submitClaim.
 */
export const sendEmail = async ({ to, subject, html }) => {
  if (!isEmailConfigured) {
    console.warn(`Email not configured — skipped "${subject}" to ${to}`);
    return;
  }

  try {
    await resend.emails.send({ from, to, subject, html });
  } catch (err) {
    console.error(`Failed to send "${subject}" to ${to}:`, err.message);
  }
};
