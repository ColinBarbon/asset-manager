/**
 * csv.js — minimal, dependency-free CSV serialise/parse (RFC-4180 style).
 *
 * Exports:
 *   toCsv(rows, columns)  → string   serialise row objects using `columns` as the header
 *   parseCsv(text)        → object[] parse CSV text into row objects keyed by the header row
 *
 * Handles quoted fields, escaped quotes (""), embedded commas/newlines and
 * CRLF or LF line endings. Output uses CRLF, which Excel and Sheets expect.
 */

/** Wrap a field in quotes only if it contains a comma, quote, CR or LF. */
function quoteField(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise an array of row objects to CSV text.
 * @param {object[]} rows
 * @param {string[]} columns ordered column keys; also the header row
 */
function toCsv(rows, columns) {
  const header = columns.map(quoteField).join(",");
  const body = rows.map(row => columns.map(c => quoteField(row[c])).join(",")).join("\r\n");
  return body ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

/** Tokenise CSV text into a 2D array of string cells. */
function parseRows(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"')      inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r") { /* swallow; the \n ends the row */ }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // Drop blank lines (a stray newline yields a single empty cell).
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

/**
 * Parse CSV text into row objects keyed by the (trimmed) header row.
 * @param {string} text
 * @returns {object[]}
 */
function parseCsv(text) {
  const rows = parseRows(text || "");
  if (!rows.length) return [];

  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    header.forEach((key, i) => { obj[key] = cells[i] != null ? cells[i] : ""; });
    return obj;
  });
}

module.exports = { toCsv, parseCsv };
