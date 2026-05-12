/**
 * src/lib/logger.js
 * Logger com timestamp e cores ANSI.
 */

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const ts = () => new Date().toISOString().slice(11, 19);

const logger = {
  info: (...a) => console.log(`${C.dim}[${ts()}]${C.reset}`, ...a),
  ok:   (...a) => console.log(`${C.dim}[${ts()}]${C.reset} ${C.green}✓${C.reset}`, ...a),
  warn: (...a) => console.warn(`${C.dim}[${ts()}]${C.reset} ${C.yellow}!${C.reset}`, ...a),
  err:  (...a) => console.error(`${C.dim}[${ts()}]${C.reset} ${C.red}✗${C.reset}`, ...a),
  step: (n, total, msg) => console.log(`\n${C.cyan}[${n}/${total}]${C.reset} ${msg}`),
  divider: () => console.log(`${C.dim}${'─'.repeat(70)}${C.reset}`),
};

module.exports = { logger, C };
