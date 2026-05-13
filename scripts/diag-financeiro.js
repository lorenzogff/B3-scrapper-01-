#!/usr/bin/env node
/**
 * scripts/diag-financeiro.js
 *
 * Diagnostico abrangente — usado para extender o regex.js sem chutar:
 *   1) Para PROJETOS COM STATUS manual_revisar: dumpa o TOC + paginas com
 *      "REMUNERAÇÃO" + R$ próximos (mesma logica do diag-revisar antigo).
 *   2) Para TODOS OS PDFs baixados: procura ocorrencias de CAPEX, OPEX,
 *      investimento estimado/previsto/total, valor global/estimado/total,
 *      valor de outorga — qualquer termo financeiro que possa virar coluna.
 *
 * Saida: ./diag-financeiro.txt — anexar para o Claude analisar.
 *
 * Uso:
 *   node scripts/diag-financeiro.js
 */

const fs = require('fs-extra');
const path = require('path');
const { extrairTextoPorPagina } = require('../src/lib/pdf');

const ROOT = path.resolve(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'cache', 'resultados');
const PDF_DIR = path.join(ROOT, 'cache', 'pdfs');
const OUT_FILE = path.join(ROOT, 'diag-financeiro.txt');

function nrm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function snippet(t, idx, before = 120, after = 200) {
  const ini = Math.max(0, idx - before);
  const fim = Math.min(t.length, idx + after);
  return nrm(t.slice(ini, fim));
}

// Padroes a varrer por cada PDF (para descobrir variantes e contextos)
const PADROES = [
  { nome: 'remun_b3',     rx: /remunera[çc][ãa]o[\s\S]{0,60}b3/gi },
  { nome: 'importancia',  rx: /import[âa]ncia\s*de\s*R\$\s*[\d.,]+/gi },
  { nome: 'montante',     rx: /(?:no\s+)?montante[\s\S]{0,40}R\$\s*[\d.,]+/gi },
  { nome: 'capex',        rx: /\bcapex\b[\s\S]{0,200}/gi },
  { nome: 'opex',         rx: /\bopex\b[\s\S]{0,200}/gi },
  { nome: 'investimento', rx: /investiment[oa]s?[\s\S]{0,100}R\$\s*[\d.,]+/gi },
  { nome: 'valor_global', rx: /valor\s+global[\s\S]{0,200}R\$\s*[\d.,]+/gi },
  { nome: 'valor_estimado', rx: /valor\s+(?:total\s+)?estimad[oa]s?[\s\S]{0,150}R\$\s*[\d.,]+/gi },
  { nome: 'outorga',      rx: /outorga[\s\S]{0,200}R\$\s*[\d.,]+/gi },
  { nome: 'capital_giro', rx: /capital\s+de\s+giro[\s\S]{0,150}R\$\s*[\d.,]+/gi },
];

(async () => {
  if (!await fs.pathExists(RESULT_DIR) || !await fs.pathExists(PDF_DIR)) {
    console.error('cache/resultados ou cache/pdfs nao existe. Rode extract antes.');
    process.exit(1);
  }

  const arqs = (await fs.readdir(RESULT_DIR)).filter((f) => f.endsWith('.json'));
  const resultados = {};
  for (const a of arqs) {
    const r = await fs.readJson(path.join(RESULT_DIR, a));
    resultados[r.projeto_id] = r.status;
  }

  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  const contagem = {};
  for (const p of PADROES) contagem[p.nome] = 0;
  let projetosVarridos = 0;

  log('═══ Diagnostico financeiro ═══');
  log(`Total de resultados em cache: ${Object.keys(resultados).length}`);
  log('');

  const projetos = (await fs.readdir(PDF_DIR)).sort();

  for (const id of projetos) {
    const projPath = path.join(PDF_DIR, id);
    const stat = await fs.stat(projPath);
    if (!stat.isDirectory()) continue;

    const pdfs = (await fs.readdir(projPath)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) continue;

    const status = resultados[id] || '?';
    const pdfPath = path.join(projPath, pdfs[0]);
    let paginas;
    try {
      const buf = await fs.readFile(pdfPath);
      paginas = await extrairTextoPorPagina(buf);
    } catch (e) {
      log(`[${id}] (${status}) ERRO ${e.message}`);
      continue;
    }
    projetosVarridos++;

    const textoTodo = paginas.join('\n\n');
    const hits = {};
    for (const p of PADROES) {
      p.rx.lastIndex = 0;
      let m;
      const matches = [];
      while ((m = p.rx.exec(textoTodo)) !== null && matches.length < 3) {
        matches.push({ idx: m.index, txt: nrm(m[0]) });
      }
      if (matches.length) {
        hits[p.nome] = matches;
        contagem[p.nome] += matches.length;
      }
    }

    // So loga projetos que tem hits relevantes (capex/opex/global/etc.) OU que
    // estao em manual_revisar (precisamos das variantes B3 deles)
    const temFinanceiro = ['capex','opex','investimento','valor_global','valor_estimado','outorga','capital_giro']
      .some((k) => hits[k]);
    const ehManualRevisar = status === 'manual_revisar';
    if (!temFinanceiro && !ehManualRevisar) continue;

    log(`\n[${id}] (${status})  paginas=${paginas.length}`);
    for (const [nome, matches] of Object.entries(hits)) {
      for (const { idx, txt } of matches) {
        const ctx = snippet(textoTodo, idx, 80, 180);
        log(`  ${nome}: ${ctx.slice(0, 260)}`);
      }
    }
  }

  log('');
  log('═══ Resumo de hits por padrao ═══');
  log(`Projetos varridos: ${projetosVarridos}`);
  for (const [nome, n] of Object.entries(contagem)) {
    log(`  ${nome.padEnd(18)}: ${n} matches`);
  }
  log('');
  log(`Saida em: ${OUT_FILE}`);
  await fs.writeFile(OUT_FILE, lines.join('\n'));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
