#!/usr/bin/env node
/**
 * scripts/diag-revisar.js
 *
 * Para cada projeto marcado como `manual_revisar`, abre o PDF baixado e dumpa:
 *   - paginas 1-7 (TOC area)
 *   - qualquer pagina que contenha "REMUNERAC..." (busca acent-insensitive)
 *   - qualquer pagina com "R$" proximo de "B3"
 *
 * Saida: ./diag-revisar.txt — anexar para Claude analisar variantes
 * sem mexer em regex.js de palpite.
 *
 * Uso:
 *   node scripts/diag-revisar.js
 */

const fs = require('fs-extra');
const path = require('path');
const { extrairTextoPorPagina } = require('../src/lib/pdf');

const ROOT = path.resolve(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'cache', 'resultados');
const PDF_DIR = path.join(ROOT, 'cache', 'pdfs');
const OUT_FILE = path.join(ROOT, 'diag-revisar.txt');

function nrm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

const RE_REM = /remunerac[ãa]o|remuneracão|REMUNERAC/i;
const RE_RS = /R\$\s*[\d.,]+/;
const RE_B3 = /\bB3\b/;

(async () => {
  if (!await fs.pathExists(RESULT_DIR)) {
    console.error('cache/resultados nao existe — rode extract primeiro');
    process.exit(1);
  }
  const arqs = (await fs.readdir(RESULT_DIR)).filter((f) => f.endsWith('.json'));
  const ids = [];
  for (const a of arqs) {
    const r = await fs.readJson(path.join(RESULT_DIR, a));
    if (r.status === 'manual_revisar') ids.push(r.projeto_id);
  }

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log(`Diagnostico de ${ids.length} projetos manual_revisar\n`);

  for (const id of ids) {
    const projPath = path.join(PDF_DIR, id);
    if (!await fs.pathExists(projPath)) { log(`[${id}] SEM PASTA`); continue; }
    const pdfs = (await fs.readdir(projPath)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) { log(`[${id}] SEM PDF`); continue; }

    const pdfPath = path.join(projPath, pdfs[0]);
    let paginas;
    try {
      const buf = await fs.readFile(pdfPath);
      paginas = await extrairTextoPorPagina(buf);
    } catch (e) {
      log(`[${id}] ERRO ${e.message}`); continue;
    }

    log(`\n══════════ ${id} (${paginas.length} pags) ══════════`);

    // TOC area
    log(`--- TOC (pags 1-7) ---`);
    for (let i = 0; i < Math.min(7, paginas.length); i++) {
      const t = nrm(paginas[i]);
      if (t.length > 0) log(`  [p${i + 1}] ${t.slice(0, 500)}`);
    }

    // Paginas com REMUNERAÇÃO + R$ + B3
    const relevantes = [];
    for (let i = 0; i < paginas.length; i++) {
      const t = paginas[i];
      const hits = (RE_REM.test(t) ? 1 : 0) + (RE_RS.test(t) ? 1 : 0) + (RE_B3.test(t) ? 1 : 0);
      if (hits >= 2) relevantes.push({ i: i + 1, t });
    }
    if (relevantes.length) {
      log(`--- ${relevantes.length} paginas com >=2 marcadores ---`);
      for (const { i, t } of relevantes.slice(0, 5)) {
        log(`  [p${i}] ${nrm(t).slice(0, 800)}`);
      }
    } else {
      log(`--- nenhuma pagina com >=2 marcadores ---`);
    }
  }

  log('\n──────────────────────────────────────────');
  log(`Saida em: ${OUT_FILE}`);
  await fs.writeFile(OUT_FILE, lines.join('\n'));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
