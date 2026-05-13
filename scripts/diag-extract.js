#!/usr/bin/env node
/**
 * scripts/diag-extract.js
 *
 * Diagnostico do extract sem mexer em regex.
 *
 * Para cada PDF baixado em cache/pdfs/<id>/, imprime:
 *   - tamanho, num paginas
 *   - se a ancora foi encontrada (e qual)
 *   - primeiros 400 chars da pagina 1 (sumario provavel)
 *   - se a frase "REMUNERAÇÃO DA B3" aparece em alguma das 7 primeiras paginas
 *
 * Uso:
 *   node scripts/diag-extract.js
 *
 * Saida: ./diag-extract.txt (e tambem no stdout)
 */

const fs = require('fs-extra');
const path = require('path');
const { extrairTextoPorPagina, localizarAlvo } = require('../src/lib/pdf');

const ROOT = path.resolve(__dirname, '..');
const PDF_DIR = path.join(ROOT, 'cache', 'pdfs');
const OUT_FILE = path.join(ROOT, 'diag-extract.txt');

function nrm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

(async () => {
  if (!await fs.pathExists(PDF_DIR)) {
    console.error(`Nao existe ${PDF_DIR} — rode o download primeiro.`);
    process.exit(1);
  }

  const projetos = await fs.readdir(PDF_DIR);
  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log(`Diagnostico de ${projetos.length} projetos em cache/pdfs/\n`);

  let achouAncora = 0;
  let mencionaRem = 0;
  let total = 0;

  for (const proj of projetos.sort()) {
    const projPath = path.join(PDF_DIR, proj);
    const stat = await fs.stat(projPath);
    if (!stat.isDirectory()) continue;

    const pdfs = (await fs.readdir(projPath)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) {
      log(`[${proj}] SEM PDF`);
      continue;
    }

    for (const pdf of pdfs) {
      total++;
      const full = path.join(projPath, pdf);
      const s = (await fs.stat(full)).size;

      try {
        const { alvo, totalPaginas, paginas } = await localizarAlvo(full);
        const sumario = paginas.slice(0, 7).map(nrm).join(' | ').slice(0, 800);
        const mencao = /REMUNERAC[ÃA]O\s+DA\s+B3|REMUNERAC[ÃA]O\s+B3/i.test(sumario);

        if (alvo) achouAncora++;
        if (mencao) mencionaRem++;

        log(`[${proj}/${pdf}] size=${s}B paginas=${totalPaginas} ancora=${alvo ? alvo.ancora+'@p'+alvo.pagina : 'NAO'} mencaoB3=${mencao}`);
        log(`  inicio: ${nrm(paginas[0]).slice(0, 250)}`);
        if (alvo) {
          log(`  trecho: ${nrm(paginas[alvo.pagina - 1] || '').slice(0, 250)}`);
        }
      } catch (e) {
        log(`[${proj}/${pdf}] ERRO: ${e.message}`);
      }
    }
  }

  log('\n──────────────────────────────────────────');
  log(`PDFs processados:        ${total}`);
  log(`Com ancora encontrada:   ${achouAncora}`);
  log(`Mencionam "REM. DA B3":  ${mencionaRem}`);
  log(`Saida completa em:       ${OUT_FILE}`);

  await fs.writeFile(OUT_FILE, lines.join('\n'));
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
