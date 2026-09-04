// Shared chrome (hero, logo chip, info card, button, footer) for every
// transactional email. Table-based and inline-styled throughout — that's not
// a style choice, it's what Outlook/older clients require; anything in a
// <style> block or built with flex/grid silently breaks there.

const FRONTEND_URL = (process.env.FRONTEND_URL?.trim() || 'https://www.amccatalyst.com').replace(/\/$/, '');
const LOGO_URL = `${FRONTEND_URL}/images/logo.png`;

// Matches --color-brand-blue / --color-brand-violet / --color-brand-dark in
// the frontend's index.css — kept in sync by hand since an email template
// can't import a CSS file.
const BRAND_BLUE = '#2563eb';
const BRAND_VIOLET = '#7c3aed';
const BRAND_DARK = '#0f172a';
const BORDER = '#e2e8f0';
const MUTED = '#64748b';

export const button = (label, href) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px auto 4px;">
    <tr>
      <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius: 10px; background: ${BRAND_BLUE}; background-image: linear-gradient(135deg, ${BRAND_BLUE} 0%, ${BRAND_VIOLET} 100%); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);">
        <a href="${href}" style="display: inline-block; padding: 16px 40px; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.2px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>
`;

/** Two label/value pairs side by side in a tinted card — e.g. Plan / Access until. */
export const infoCard = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 4px 0 28px; border-radius: 12px; background-color: #f8fafc; background-image: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%); border: 1px solid #e0e7ff;">
    <tr>
      ${rows
        .map(
          ({ label, value }) => `
        <td style="padding: 18px 20px; vertical-align: top;" width="${Math.floor(100 / rows.length)}%">
          <p style="margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: ${BRAND_VIOLET};">${label}</p>
          <p style="margin: 4px 0 0; font-size: 16px; font-weight: 700; color: ${BRAND_DARK};">${value}</p>
        </td>`
        )
        .join('')}
    </tr>
  </table>
`;

/**
 * Full-width gradient hero: logo sits in a white chip (so its own white
 * background reads as intentional rather than a stray box on a dark ground),
 * then a large white headline in the hero itself rather than on the white
 * body section below it.
 */
const hero = (heroHeading, heroSubtext) => `
  <tr>
    <td align="center" bgcolor="${BRAND_BLUE}" style="background: ${BRAND_BLUE}; background-image: linear-gradient(135deg, ${BRAND_BLUE} 0%, ${BRAND_VIOLET} 100%); padding: 40px 32px 36px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto 20px;">
        <tr>
          <td width="76" height="76" align="center" valign="middle" bgcolor="#ffffff" style="width: 76px; height: 76px; border-radius: 20px; background-color: #ffffff;">
            <img src="${LOGO_URL}" alt="AMC Catalyst" width="56" height="56" style="height: 56px; width: 56px; display: block;" />
          </td>
        </tr>
      </table>
      <h1 style="margin: 0; font-size: 24px; line-height: 1.3; font-weight: 800; color: #ffffff;">${heroHeading}</h1>
      ${heroSubtext ? `<p style="margin: 8px 0 0; font-size: 14px; color: #e0e7ff;">${heroSubtext}</p>` : ''}
    </td>
  </tr>
`;

export const renderEmail = ({ preheader = '', heroHeading, heroSubtext = '', bodyHtml }) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AMC Catalyst</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #eef2f9; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
    <!-- Preheader: shows in the inbox preview, hidden in the body -->
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #eef2f9; padding: 40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 12px 32px rgba(15,23,42,0.08);">
            ${hero(heroHeading, heroSubtext)}
            <tr>
              <td style="padding: 32px 40px 8px; color: ${BRAND_DARK}; font-size: 15px; line-height: 1.65;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 0 40px;">
                <div style="border-top: 1px solid ${BORDER}; font-size: 0; line-height: 0;">&nbsp;</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 22px 40px 28px; color: ${MUTED}; font-size: 12px; line-height: 1.7;" align="center">
                Need help? Write to <a href="mailto:support@amccatalyst.com" style="color: ${BRAND_BLUE}; text-decoration: none; font-weight: 600;">support@amccatalyst.com</a><br />
                <span style="color: #94a3b8;">Sailing Minds to Australian Medicine</span><br />
                © ${new Date().getFullYear()} AMC Catalyst. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
