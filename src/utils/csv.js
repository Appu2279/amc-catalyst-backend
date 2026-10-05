const csvCell = (value) => {
  if (value == null) return '';
  const text = String(value);
  // Leading =, +, - or @ would run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** A CSV document from a header row and data rows. The BOM makes Excel read it as UTF-8. */
export const toCsv = (header, rows) =>
  '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
