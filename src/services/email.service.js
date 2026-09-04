import { sendEmail } from '../config/email.js';
import { renderEmail, button, infoCard } from '../emails/layout.js';

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

const FRONTEND_URL = (process.env.FRONTEND_URL?.trim() || 'https://www.amccatalyst.com').replace(/\/$/, '');

/**
 * Sent the moment an admin approves a payment claim — this is the only signal
 * a buyer gets that their manual bank transfer was actually found and matched,
 * since nothing in the QR-payment flow is otherwise automatic.
 */
export const sendPaymentApprovedEmail = (user, subscription) =>
  sendEmail({
    to: user.email,
    subject: `You're in — access to ${subscription.plan_title} is active`,
    html: renderEmail({
      preheader: `Your payment is verified — ${subscription.plan_title} is ready to go.`,
      heroHeading: "You're all set! 🎉",
      heroSubtext: 'Your payment has been verified',
      bodyHtml: `
        <p style="margin: 0 0 4px; text-align: center; color: #475569;">
          Hi ${user.fullName}, your access to <strong style="color: #0f172a;">${subscription.plan_title}</strong> is now active.
        </p>
        ${infoCard([
          { label: 'Plan', value: subscription.plan_title },
          { label: 'Access until', value: formatDate(subscription.end_date) },
        ])}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">${button('Log in to your account', `${FRONTEND_URL}/login`)}</td></tr>
        </table>
        <p style="margin: 20px 0 0; text-align: center; font-size: 12px; color: #94a3b8;">
          Or paste this link into your browser: <a href="${FRONTEND_URL}/login" style="color: #94a3b8;">${FRONTEND_URL}/login</a>
        </p>
      `,
    }),
  });
