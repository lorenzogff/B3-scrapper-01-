#!/usr/bin/env node
/**
 * scripts/clean.js
 * Limpa cache e outputs. Útil para reprocessar do zero.
 */

const fs = require('fs-extra');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

async function clean() {
  const targets = ['cache', 'output'];
  for (const t of targets) {
    const p = path.join(ROOT, t);
    if (await fs.pathExists(p)) {
      await fs.remove(p);
      console.log(`  ✓ removido: ${t}/`);
    }
  }
  console.log('Limpeza concluída.');
}

clean().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
