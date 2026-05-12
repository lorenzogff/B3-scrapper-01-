/**
 * src/lib/extract.js
 * Fase 3 — Extração regex-first dos PDFs já baixados.
 * ZERO chamadas de LLM. ZERO leitura de PDF inteiro.
 */

const fs = require('fs-extra');
const path = require('path');
const cliProgress = require('cli-progress');
const { logger } = require('./logger');
const { sanitize } = require('./utils');
const { localizarAlvo, montarTrecho } = require('./pdf');
const { extrairRemuneracaoB3, extrairValorGlobal } = require('./regex');

async function processarProjeto(proj, manifest, cfg, bar) {
  const seed = manifest._seed || {};
  const entry = manifest.projetos[proj.id];
  const cacheResultado = path.join(cfg.resultDir, sanitize(proj.id) + '.json');

  // Seed shortcut
  if (proj.fonte === 'seed' && seed[proj.id]) {
    const s = seed[proj.id];
    const r = {
      projeto_id: proj.id, titulo: s.projeto, data: s.data, ano: s.ano,
      valor_global: s.valor_global,
      valores: [{ valor: s.remuneracao_b3, lote: 'geral', pagina_pdf: 0,
                  contexto: '(seed)', fonte_regex: 'seed' }],
      status: 'seed_verificado',
      fonte_observacao: s.fonte,
    };
    await fs.writeJson(cacheResultado, r, { spaces: 2 });
    bar.increment(1, { proj: proj.id.slice(0, 30) + ' [seed]' });
    return r;
  }

  if (!entry || !entry.pdfs_baixados || entry.pdfs_baixados.length === 0) {
    const r = {
      projeto_id: proj.id, titulo: proj.titulo, data: proj.data, ano: proj.ano,
      valores: [], status: 'sem_pdf', erro: 'nenhum PDF baixado',
    };
    await fs.writeJson(cacheResultado, r, { spaces: 2 });
    bar.increment(1, { proj: proj.id.slice(0, 30) + ' [sem_pdf]' });
    return r;
  }

  let valorGlobal = null;
  let resultado = null;

  // PDFs ordenados por prioridade: manual_b3 primeiro
  const pdfsOrdenados = [...entry.pdfs_baixados]
    .sort((a, b) => (a.prioridade || 99) - (b.prioridade || 99));

  for (const pdfInfo of pdfsOrdenados) {
    const pdfPath = pdfInfo.caminho;
    if (!await fs.pathExists(pdfPath)) continue;

    try {
      const { alvo, paginas } = await localizarAlvo(pdfPath);
      if (!alvo) continue;

      const snippet = montarTrecho(paginas, alvo.pagina);
      const achados = extrairRemuneracaoB3(snippet);
      if (!valorGlobal) valorGlobal = extrairValorGlobal(snippet);

      if (achados.length > 0) {
        // Salva snippet para auditoria
        await fs.ensureDir(cfg.snippetDir);
        const snipFile = path.join(cfg.snippetDir, sanitize(proj.id) + '.txt');
        await fs.writeFile(snipFile, snippet);

        resultado = {
          projeto_id: proj.id,
          titulo: proj.titulo,
          data: proj.data,
          ano: proj.ano,
          pdf_processado: pdfInfo.nome,
          ancora: alvo.ancora,
          pagina_alvo: alvo.pagina,
          valor_global: valorGlobal,
          valores: achados,
          status: 'auto',
        };
        break;
      }
    } catch (e) {
      // erro nesse PDF; tenta o próximo
      continue;
    }
  }

  if (!resultado) {
    resultado = {
      projeto_id: proj.id, titulo: proj.titulo, data: proj.data, ano: proj.ano,
      valor_global: valorGlobal,
      valores: [], status: 'manual_revisar',
      pdfs_baixados: entry.pdfs_baixados.map((p) => p.nome),
    };
  }

  await fs.writeJson(cacheResultado, resultado, { spaces: 2 });
  bar.increment(1, { proj: proj.id.slice(0, 30) });
  return resultado;
}

async function extrairTodos(projetos, cfg) {
  logger.info(`Fase 3 — Extraindo valores (regex-first, ${projetos.length} projetos)`);
  await fs.ensureDir(cfg.resultDir);
  await fs.ensureDir(cfg.snippetDir);

  const manifest = await fs.readJson(cfg.manifestPath).catch(() => ({ projetos: {} }));
  const seed = await fs.readJson(cfg.seedPath).catch(() => ({}));
  manifest._seed = seed;

  const bar = new cliProgress.SingleBar({
    format: '  [{bar}] {percentage}% | {value}/{total} | {proj}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    clearOnComplete: false,
  });
  bar.start(projetos.length, 0, { proj: 'iniciando...' });

  const resultados = [];
  for (let i = 0; i < projetos.length; i += cfg.batchSize) {
    const lote = projetos.slice(i, i + cfg.batchSize);
    const r = await Promise.all(lote.map((p) => processarProjeto(p, manifest, cfg, bar)));
    resultados.push(...r);
  }
  bar.stop();

  return resultados;
}

module.exports = { extrairTodos };
