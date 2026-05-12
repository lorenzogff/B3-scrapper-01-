/**
 * src/lib/utils.js
 * Helpers compartilhados: hash, sleep, sanitize, parsing BR.
 */

const crypto = require('crypto');
const fs = require('fs-extra');

const sha1Buffer = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function sha1File(filepath) {
  const buf = await fs.readFile(filepath);
  return sha1Buffer(buf);
}

const sanitize = (s, maxLen = 120) =>
  s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, maxLen);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Converte string monetária BR para Number.
 * "1.234,56" -> 1234.56 | "396.000,00" -> 396000.00
 */
function parseBR(s) {
  if (s == null) return NaN;
  const cleaned = String(s).trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned);
}

/**
 * Formata Number para R$ XXX,XX (padrão pt-BR).
 */
function brl(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return 'R$ ' + v.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Para ordenação: "dd/mm/aaaa hh:mm" -> Date; "aaaa" -> 01/jan; outros -> epoch.
 */
function dataOrdenacao(s) {
  if (!s) return new Date(0);
  const m1 = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return new Date(`${m1[3]}-${m1[2]}-${m1[1]}`);
  const m2 = s.match(/(\d{4})/);
  if (m2) return new Date(`${m2[1]}-01-01`);
  return new Date(0);
}

module.exports = { sha1Buffer, sha1File, sanitize, sleep, parseBR, brl, dataOrdenacao };
