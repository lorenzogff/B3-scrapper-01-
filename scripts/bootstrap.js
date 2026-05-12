#!/usr/bin/env node
/**
 * scripts/bootstrap.js
 * Setup completo do projeto em uma chamada.
 * Verifica Node, instala dependências, baixa Chromium.
 */

const { execSync } = require('child_process');

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`  ✓ ${label} ok`);
  } catch (e) {
    console.error(`  ✗ falhou: ${e.message}`);
    process.exit(1);
  }
}

function verificarNode() {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  if (major < 18) {
    console.error(`Node ${v} é muito antigo. Instale Node 18+.`);
    process.exit(1);
  }
  console.log(`✓ Node ${v} OK`);
}

(function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' B3 Scraper — Bootstrap');
  console.log('═══════════════════════════════════════════════════════════════');
  verificarNode();
  run('npm install', 'Instalando dependências');
  run('npx playwright install chromium', 'Baixando Chromium (~150 MB)');
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Setup concluído. Próximo passo:');
  console.log('   npm run discover            # listar projetos');
  console.log('   npm run full                # pipeline completo');
  console.log('═══════════════════════════════════════════════════════════════');
})();
