#!/usr/bin/env node
/**
 * src/cli.js
 * Interface CLI principal. Subcomandos: discover, download, extract, report, full.
 */

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs-extra');

const { loadConfig } = require('./lib/config');
const { logger } = require('./lib/logger');
const { launchBrowser } = require('./lib/http');
const { descobrir } = require('./lib/discover');
const { baixarTodos } = require('./lib/download');
const { extrairTodos } = require('./lib/extract');
const { gerar, resumo } = require('./lib/report');

async function carregarProjetos(cfg) {
  if (!await fs.pathExists(cfg.projectsPath)) {
    throw new Error(`Lista de projetos não encontrada. Rode primeiro: b3-scraper discover`);
  }
  const todos = await fs.readJson(cfg.projectsPath);
  return todos.filter((p) => cfg.anos.includes(p.ano));
}

const COMMANDS = {
  // ──────────────────────────────────────────────
  async discover(argv) {
    const cfg = loadConfig(argv);
    logger.info(`Anos: ${cfg.anos.join(', ')}`);
    const browser = await launchBrowser();
    try {
      const todos = await descobrir(browser, cfg);
      logger.divider();
      logger.ok(`${todos.length} projetos descobertos. Saída: cache/projetos.json`);
    } finally {
      await browser.close();
    }
  },

  // ──────────────────────────────────────────────
  async download(argv) {
    const cfg = loadConfig(argv);
    const projetos = await carregarProjetos(cfg);
    logger.info(`Baixando para ${projetos.length} projetos (anos: ${cfg.anos.join(', ')})`);

    const browser = await launchBrowser();
    try {
      const { resultados, manifest } = await baixarTodos(browser, projetos, cfg);
      logger.divider();
      const ok = resultados.filter((r) => r.baixados > 0).length;
      const skipped = resultados.filter((r) => r.skipped).length;
      const vazio = resultados.filter((r) => r.sem_relevantes).length;
      const erros = resultados.filter((r) => r.erro).length;
      const dry = resultados.filter((r) => r.dryRun).length;
      const seed = resultados.filter((r) => r.seed).length;

      logger.ok(`Bem-sucedidos: ${ok} | Pulados (retomar): ${skipped} | Sem PDFs: ${vazio} | Erros: ${erros}`);
      if (dry) logger.info(`Dry-run (listados): ${dry}`);
      if (seed) logger.info(`Seed (sem download): ${seed}`);

      const totalSize = Object.values(manifest.projetos)
        .flatMap((p) => p.pdfs_baixados || [])
        .reduce((a, b) => a + (b.size || 0), 0);
      logger.info(`Cache: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    } finally {
      await browser.close();
    }
  },

  // ──────────────────────────────────────────────
  async extract(argv) {
    const cfg = loadConfig(argv);
    const projetos = await carregarProjetos(cfg);
    const resultados = await extrairTodos(projetos, cfg);

    const { contagem, total, taxa_auto } = resumo(resultados);
    logger.divider();
    logger.ok(`Extração concluída — ${total} projetos`);
    logger.info(`  ✓ auto:            ${contagem.auto || 0}`);
    logger.info(`  ✓ seed_verificado: ${contagem.seed_verificado || 0}`);
    logger.info(`  ? manual_revisar:  ${contagem.manual_revisar || 0}`);
    logger.info(`  ✗ sem_pdf:         ${contagem.sem_pdf || 0}`);
    logger.info(`  Taxa de sucesso (auto+seed): ${(taxa_auto * 100).toFixed(1)}%`);

    return resultados;
  },

  // ──────────────────────────────────────────────
  async report(argv) {
    const cfg = loadConfig(argv);
    const projetos = await carregarProjetos(cfg);
    const resultados = [];
    for (const proj of projetos) {
      const cacheFile = `${cfg.resultDir}/${proj.id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
      if (await fs.pathExists(cacheFile)) {
        resultados.push(await fs.readJson(cacheFile));
      }
    }
    if (resultados.length === 0) {
      logger.warn('Nenhum resultado em cache. Rode antes: b3-scraper extract');
      return;
    }
    const out = await gerar(resultados, cfg);
    logger.divider();
    logger.ok(`Planilha: ${out}`);
  },

  // ──────────────────────────────────────────────
  async full(argv) {
    const cfg = loadConfig(argv);
    const browser = await launchBrowser();
    try {
      logger.divider();
      const todos = await descobrir(browser, cfg);
      logger.divider();
      await baixarTodos(browser, todos, cfg);
      logger.divider();
      const resultados = await extrairTodos(todos, cfg);
      logger.divider();
      const out = await gerar(resultados, cfg);
      logger.divider();
      const r = resumo(resultados);
      logger.ok(`Tudo concluído.`);
      logger.info(`  Planilha:      ${out}`);
      logger.info(`  Total:         ${r.total} projetos`);
      logger.info(`  Taxa sucesso:  ${(r.taxa_auto * 100).toFixed(1)}%`);
    } finally {
      await browser.close();
    }
  },
};

// ───────────────────────────────────────────────────────────────────────────
yargs(hideBin(process.argv))
  .scriptName('b3-scraper')
  .usage('$0 <comando> [opções]')
  .command('discover', 'Fase 1: lista projetos da B3', (y) => y
    .option('anos', { type: 'array', describe: 'Anos a processar', default: undefined })
    , (a) => COMMANDS.discover(a).catch(handleErr))
  .command('download', 'Fase 2: baixa PDFs relevantes', (y) => y
    .option('anos', { type: 'array' })
    .option('concorrencia', { type: 'number' })
    .option('dry-run', { type: 'boolean', default: false })
    .option('retomar', { type: 'boolean', default: false })
    .option('baixar-tudo', { type: 'boolean', default: false })
    .option('force-redownload', { type: 'boolean', default: false })
    .option('categorias', { type: 'array' })
    , (a) => COMMANDS.download(a).catch(handleErr))
  .command('extract', 'Fase 3: extrai valores via regex', (y) => y
    .option('anos', { type: 'array' })
    .option('batch-size', { type: 'number' })
    , (a) => COMMANDS.extract(a).catch(handleErr))
  .command('report', 'Fase 4: gera planilha XLSX consolidada', (y) => y
    .option('anos', { type: 'array' })
    , (a) => COMMANDS.report(a).catch(handleErr))
  .command('full', 'Pipeline completo (1+2+3+4)', (y) => y
    .option('anos', { type: 'array' })
    .option('concorrencia', { type: 'number' })
    .option('batch-size', { type: 'number' })
    , (a) => COMMANDS.full(a).catch(handleErr))
  .demandCommand(1, 'Informe um comando: discover, download, extract, report ou full')
  .strict()
  .help()
  .argv;

function handleErr(e) {
  logger.err(e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
