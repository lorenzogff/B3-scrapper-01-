/**
 * src/lib/discover.js
 *
 * Fase 1 — Descoberta de projetos B3.
 *
 * Fluxo:
 *   1) Carrega o listing real (bvmf.bmfbovespa.com.br/.../Resumoleiloesespeciais.aspx)
 *      e parseia as duas tabelas (Em Andamento + Anteriores).
 *   2) Filtra pelos anos solicitados.
 *   3) Para cada projeto, visita a pagina de detalhe e extrai:
 *        - url_manual (link "Manual de Procedimentos da B3", via lum-download.asp)
 *        - url_site_projeto (link externo do issuer)
 *   4) Merge com o seed (seeds preenchem casos verificados manualmente).
 *   5) Salva cache/projetos.json.
 *
 * Parsers HTML sao puros (src/lib/sources/*). Aqui so orquestra rede + IO.
 */

const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');
const { logger } = require('./logger');
const { newContext } = require('./http');
const { sleep } = require('./utils');
const { parseListing, filtrarPorAno } = require('./sources/bvmf-listing');
const { parseDetalhe } = require('./sources/bvmf-detalhe');

async function buscarListing(browser, cfg) {
  logger.info('  → carregando listing bvmf...');
  const ctx = await newContext(browser, cfg.userAgent);
  const page = await ctx.newPage();
  try {
    await page.goto(cfg.urls.bvmf, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    await page.waitForSelector('table', { timeout: 15_000 }).catch(() => {});
    const html = await page.content();
    return html;
  } finally {
    await ctx.close();
  }
}

async function buscarDetalhe(browser, projeto, cfg) {
  const ctx = await newContext(browser, cfg.userAgent);
  const page = await ctx.newPage();
  try {
    await page.goto(projeto.url_detalhe, {
      waitUntil: 'networkidle',
      timeout: cfg.navTimeout,
    });
    await sleep(500);
    const html = await page.content();
    return parseDetalhe(html, projeto.url_detalhe);
  } finally {
    await ctx.close();
  }
}

async function carregarSeed(cfg) {
  if (!await fs.pathExists(cfg.seedPath)) return {};
  return await fs.readJson(cfg.seedPath);
}

function mergeSeed(projetos, seed, anos) {
  const map = new Map(projetos.map((p) => [p.id, p]));
  for (const [id, v] of Object.entries(seed)) {
    if (!anos.includes(v.ano)) continue;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      id_leilao: null,
      num_edital: id,
      titulo: v.projeto,
      data: v.data,
      ano: v.ano,
      fonte: 'seed',
      url_detalhe: '',
      url_manual: '',
      url_site_projeto: '',
      seed_data: v,
    });
  }
  return Array.from(map.values());
}

async function descobrir(browser, cfg) {
  logger.info(`Fase 1 — Descobrindo projetos (anos: ${cfg.anos.join(', ')})`);

  // Etapa A: listing
  let listingHtml;
  try {
    listingHtml = await buscarListing(browser, cfg);
  } catch (e) {
    logger.err(`falha no listing: ${e.message}`);
    throw new Error('listing inacessivel — pipeline abortado');
  }

  const todosProjetos = parseListing(listingHtml);
  logger.ok(`  listing: ${todosProjetos.length} projetos (todos os anos)`);

  if (todosProjetos.length < 20) {
    throw new Error(`apenas ${todosProjetos.length} projetos no listing — estrutura provavelmente mudou`);
  }

  const projetos = filtrarPorAno(todosProjetos, cfg.anos);
  logger.ok(`  filtro anos: ${projetos.length} projetos`);

  // Etapa B: visitar paginas de detalhe (paralelo, com rate-limit)
  if (cfg.dryRun) {
    logger.info('  dry-run: pulando paginas de detalhe');
  } else {
    logger.info(`  → coletando documentos das ${projetos.length} paginas de detalhe`);
    const bar = new cliProgress.SingleBar({
      format: '  [{bar}] {percentage}% | {value}/{total} | {id}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
    });
    bar.start(projetos.length, 0, { id: 'iniciando...' });

    const limit = pLimit(cfg.concorrencia);
    await Promise.all(projetos.map((p) => limit(async () => {
      try {
        const det = await buscarDetalhe(browser, p, cfg);
        p.url_manual = det.url_manual;
        p.url_site_projeto = det.url_site_projeto;
        p.documentos = det.documentos;
      } catch (e) {
        p.detalhe_erro = e.message;
      }
      bar.increment(1, { id: p.id });
    })));
    bar.stop();

    const comManual = projetos.filter((p) => p.url_manual).length;
    logger.ok(`  ${comManual}/${projetos.length} projetos com Manual de Procedimentos`);
  }

  // Etapa C: merge com seed
  const seed = await carregarSeed(cfg);
  const final = mergeSeed(projetos, seed, cfg.anos);

  await fs.ensureDir(path.dirname(cfg.projectsPath));
  await fs.writeJson(cfg.projectsPath, final, { spaces: 2 });
  logger.ok(`Total: ${final.length} projetos salvos em ${path.relative(cfg.root, cfg.projectsPath)}`);
  return final;
}

module.exports = { descobrir, buscarListing, buscarDetalhe, mergeSeed };
