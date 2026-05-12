/**
 * src/lib/discover.js
 * Fase 1 — Descoberta de projetos.
 * Combina fontes: sistema legado da B3 + página bvmf (cobertura completa).
 */

const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('./logger');
const { sanitize, sleep } = require('./utils');
const { newContext } = require('./http');

async function descobrirLegacy(browser, cfg) {
  logger.info('  → varrendo sistema legado (ANEEL e federais)');
  const ctx = await newContext(browser, cfg.userAgent);
  const page = await ctx.newPage();
  const projetos = [];

  try {
    await page.goto(cfg.urls.legacy, {
      waitUntil: 'domcontentloaded',
      timeout: cfg.navTimeout,
    });
    const $ = cheerio.load(await page.content());
    const visto = new Set();

    $('a[href*="Detalhe?strNumEdital="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/strNumEdital=([^&]+)/);
      if (!m) return;
      const num = m[1].trim();
      if (visto.has(num)) return;

      const titulo = $(el).text().trim();
      if (!titulo || /^[\d/.\s-]+$/.test(titulo)) return;

      let ctxNode = $(el);
      for (let i = 0; i < 8; i++) {
        if (ctxNode.text().includes('Data/Hor')) break;
        ctxNode = ctxNode.parent();
      }
      const ctxTxt = ctxNode.text();
      const md = ctxTxt.match(/Data\/Hor[áa]rio:\s*([\d/: ]+)/);
      const data = md ? md[1].trim() : '';
      const anoM = (num + ' ' + data).match(/(\d{4})/);
      const ano = anoM ? parseInt(anoM[1], 10) : 0;
      if (!cfg.anos.includes(ano)) return;

      visto.add(num);
      projetos.push({
        id: 'LEGACY_' + sanitize(num, 60),
        num_edital: num,
        titulo,
        data,
        ano,
        fonte: 'legacy',
        url_detalhe: new URL(href, cfg.urls.legacy).toString(),
      });
    });
  } catch (e) {
    logger.warn(`legacy inacessível: ${e.message}`);
  } finally {
    await ctx.close();
  }

  logger.ok(`  legacy: ${projetos.length} projetos`);
  return projetos;
}

async function descobrirBvmf(browser, cfg) {
  logger.info('  → varrendo bvmf (cobertura completa)');
  const ctx = await newContext(browser, cfg.userAgent);
  const page = await ctx.newPage();
  const projetos = [];

  try {
    await page.goto(cfg.urls.bvmf, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    await page.waitForSelector('table', { timeout: 10_000 }).catch(() => {});

    const seletorAno = await page.$('select[name*="Ano" i], select[id*="Ano" i]');
    const tentativas = seletorAno ? cfg.anos : [null];

    for (const ano of tentativas) {
      if (ano && seletorAno) {
        try {
          await page.selectOption(seletorAno, { label: String(ano) });
          await page.waitForLoadState('networkidle', { timeout: 15_000 });
          await sleep(800);
        } catch { /* segue */ }
      }
      const $ = cheerio.load(await page.content());
      $('table tr').each((_, row) => {
        const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
        if (cells.length < 2) return;
        const m = cells.join(' | ').match(/(Edital|Leilão|Concorrência)[^\d]*(\d+[/.-]?\d{2,4})/i);
        if (!m) return;
        const num = m[2];
        const anoLinha = parseInt((num.match(/(\d{4})/) || [])[1] || ano || 0, 10);
        if (!cfg.anos.includes(anoLinha)) return;
        const a = $(row).find('a[href]').first();
        const href = a.attr('href') || '';
        const id = 'BVMF_' + sanitize(num, 60);
        if (projetos.find((p) => p.id === id)) return;
        projetos.push({
          id,
          num_edital: num,
          titulo: cells[0],
          data: cells[2] || '',
          ano: anoLinha,
          fonte: 'bvmf',
          url_detalhe: href ? new URL(href, cfg.urls.bvmf).toString() : '',
        });
      });
    }
  } catch (e) {
    logger.warn(`bvmf inacessível: ${e.message}`);
  } finally {
    await ctx.close();
  }

  logger.ok(`  bvmf: ${projetos.length} projetos`);
  return projetos;
}

async function carregarSeed(cfg) {
  if (!await fs.pathExists(cfg.seedPath)) return {};
  return await fs.readJson(cfg.seedPath);
}

async function descobrir(browser, cfg) {
  logger.info('Fase 1 — Descobrindo projetos');
  const seed = await carregarSeed(cfg);

  const seedProjs = Object.entries(seed)
    .filter(([, v]) => cfg.anos.includes(v.ano))
    .map(([id, v]) => ({
      id,
      num_edital: id,
      titulo: v.projeto,
      data: v.data,
      ano: v.ano,
      fonte: 'seed',
      url_detalhe: '',
      seed_data: v,
    }));

  const legacy = await descobrirLegacy(browser, cfg);
  const bvmf = await descobrirBvmf(browser, cfg);

  const map = new Map();
  [...seedProjs, ...legacy, ...bvmf].forEach((p) => {
    if (!map.has(p.id)) map.set(p.id, p);
  });
  const todos = Array.from(map.values());

  await fs.ensureDir(path.dirname(cfg.projectsPath));
  await fs.writeJson(cfg.projectsPath, todos, { spaces: 2 });
  logger.ok(`Total: ${todos.length} projetos salvos em ${path.relative(cfg.root, cfg.projectsPath)}`);
  return todos;
}

module.exports = { descobrir, descobrirLegacy, descobrirBvmf, carregarSeed };
