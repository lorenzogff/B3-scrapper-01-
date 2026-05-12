/**
 * src/lib/download.js
 * Fase 2 — Download de PDFs relevantes (manual_b3 prioritário).
 */

const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');
const { logger } = require('./logger');
const { sanitize, sha1File } = require('./utils');
const { newContext, baixarPdf } = require('./http');
const { validarPdf } = require('./pdf');
const { categorizar, deveBaixar } = require('./categorizer');

async function listarPdfsDoProjeto(browser, projeto, cfg) {
  if (!projeto.url_detalhe) return [];
  const ctx = await newContext(browser, cfg.userAgent);
  const page = await ctx.newPage();
  let html;
  try {
    await page.goto(projeto.url_detalhe, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    html = await page.content();
  } catch (e) {
    await ctx.close();
    throw new Error(`detalhe inacessível: ${e.message}`);
  }
  await ctx.close();

  const $ = cheerio.load(html);
  const pdfs = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!/\.pdf(\?|$)/i.test(href)) return;
    const url = new URL(href, projeto.url_detalhe).toString();
    const nome = sanitize(path.basename(href.split('?')[0]));
    const { categoria, prioridade } = categorizar(nome);
    pdfs.push({ url, nome, categoria, prioridade });
  });
  pdfs.sort((a, b) => a.prioridade - b.prioridade);
  return pdfs;
}

async function carregarManifest(cfg) {
  if (await fs.pathExists(cfg.manifestPath)) return await fs.readJson(cfg.manifestPath);
  return { gerado_em: new Date().toISOString(), projetos: {} };
}
async function salvarManifest(cfg, m) {
  m.atualizado_em = new Date().toISOString();
  await fs.writeJson(cfg.manifestPath, m, { spaces: 2 });
}
async function carregarDedup(cfg) {
  if (await fs.pathExists(cfg.dedupPath)) return await fs.readJson(cfg.dedupPath);
  return {};
}
async function salvarDedup(cfg, idx) {
  await fs.writeJson(cfg.dedupPath, idx, { spaces: 2 });
}

async function processarProjeto(browser, proj, manifest, dedup, cfg, lastHostAccess, bar) {
  const entry = manifest.projetos[proj.id] || {
    titulo: proj.titulo, data: proj.data, ano: proj.ano, url_detalhe: proj.url_detalhe,
    pdfs_disponiveis: [], pdfs_baixados: [], erros: [],
  };
  manifest.projetos[proj.id] = entry;

  // Seed não precisa baixar nada
  if (proj.fonte === 'seed') {
    bar.increment(1, { proj: proj.id.slice(0, 30) + ' [seed]' });
    return { id: proj.id, seed: true };
  }

  if (cfg.retomar && entry.pdfs_baixados.length > 0) {
    bar.increment(1, { proj: proj.id.slice(0, 30) });
    return { id: proj.id, skipped: true };
  }

  let pdfs;
  try {
    pdfs = await listarPdfsDoProjeto(browser, proj, cfg);
  } catch (e) {
    entry.erros.push({ etapa: 'listar', msg: e.message, em: new Date().toISOString() });
    bar.increment(1, { proj: proj.id.slice(0, 30) + ' [ERR]' });
    return { id: proj.id, erro: e.message };
  }

  entry.pdfs_disponiveis = pdfs.map(({ nome, categoria, url }) => ({ nome, categoria, url }));
  const aBaixar = pdfs
    .filter((p) => deveBaixar(p.categoria, cfg.categorias, cfg.baixarTudo))
    .slice(0, cfg.maxPdfsPorProjeto);

  if (!aBaixar.length) {
    bar.increment(1, { proj: proj.id.slice(0, 30) + ' [vazio]' });
    return { id: proj.id, sem_relevantes: true };
  }

  if (cfg.dryRun) {
    bar.increment(1, { proj: proj.id.slice(0, 30) });
    return { id: proj.id, dryRun: true, listados: aBaixar.length };
  }

  const pastaProjeto = path.join(cfg.pdfDir, sanitize(proj.id));
  await fs.ensureDir(pastaProjeto);

  for (const pdf of aBaixar) {
    const nomeFinal = `${pdf.categoria}__${pdf.nome}`;
    const destino = path.join(pastaProjeto, nomeFinal);

    // Cache hit?
    if (await fs.pathExists(destino) && !cfg.forceRedownload) {
      const v = await validarPdf(destino, cfg.minPdfSize).catch(() => ({ ok: false }));
      if (v.ok) {
        entry.pdfs_baixados.push({ ...pdf, caminho: destino, size: v.size, cache: true });
        continue;
      }
    }

    const r = await baixarPdf(pdf.url, destino, {
      timeout: cfg.dlTimeout,
      maxRetries: cfg.maxRetries,
      userAgent: cfg.userAgent,
      lastHostAccess,
      hostDelay: cfg.hostDelay,
    });

    if (!r.ok) {
      entry.erros.push({ etapa: 'download', pdf: pdf.nome, msg: r.erro,
                         em: new Date().toISOString() });
      continue;
    }

    const valid = await validarPdf(destino, cfg.minPdfSize);
    if (!valid.ok) {
      await fs.unlink(destino).catch(() => {});
      entry.erros.push({ etapa: 'validacao', pdf: pdf.nome, msg: valid.motivo,
                         em: new Date().toISOString() });
      continue;
    }

    const hash = await sha1File(destino);
    if (dedup[hash] && dedup[hash] !== destino) {
      entry.pdfs_baixados.push({
        ...pdf, caminho: destino, size: valid.size, sha1: hash,
        duplicado_de: dedup[hash],
      });
    } else {
      dedup[hash] = destino;
      entry.pdfs_baixados.push({
        ...pdf, caminho: destino, size: valid.size, sha1: hash,
        tentativas: r.tentativas,
      });
    }
  }

  bar.increment(1, { proj: proj.id.slice(0, 30) });
  return { id: proj.id, baixados: entry.pdfs_baixados.length };
}

async function baixarTodos(browser, projetos, cfg) {
  logger.info(`Fase 2 — Baixando PDFs (${projetos.length} projetos, conc=${cfg.concorrencia})`);
  await fs.ensureDir(cfg.pdfDir);

  const manifest = await carregarManifest(cfg);
  const dedup = await carregarDedup(cfg);
  const lastHostAccess = new Map();

  const bar = new cliProgress.SingleBar({
    format: '  [{bar}] {percentage}% | {value}/{total} | {proj}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    clearOnComplete: false,
  });
  bar.start(projetos.length, 0, { proj: 'iniciando...' });

  const limit = pLimit(cfg.concorrencia);
  const saveInterval = setInterval(() => {
    salvarManifest(cfg, manifest).catch(() => {});
    salvarDedup(cfg, dedup).catch(() => {});
  }, 10_000);

  let resultados;
  try {
    resultados = await Promise.all(projetos.map((p) =>
      limit(() => processarProjeto(browser, p, manifest, dedup, cfg, lastHostAccess, bar))
    ));
  } finally {
    clearInterval(saveInterval);
    bar.stop();
    await salvarManifest(cfg, manifest);
    await salvarDedup(cfg, dedup);
  }

  return { resultados, manifest, dedup };
}

module.exports = { baixarTodos, listarPdfsDoProjeto };
