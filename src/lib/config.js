/**
 * src/lib/config.js
 * Configuração centralizada (CLI args + env vars + defaults).
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  anos: [2024, 2025],
  concorrencia: 3,
  batchSize: 5,
  cacheDir: 'cache',
  outputDir: 'output',
  pdfDir: 'cache/pdfs',
  snippetDir: 'cache/snippets',
  resultDir: 'cache/resultados',
  manifestPath: 'cache/download_manifest.json',
  dedupPath: 'cache/dedup_index.json',
  projectsPath: 'cache/projetos.json',
  progressPath: 'cache/progress.json',
  seedPath: 'src/data/seed_verificados.json',
  navTimeout: 60_000,
  dlTimeout: 180_000,
  hostDelay: 600,
  maxRetries: 3,
  minPdfSize: 5_000,
  maxPdfsPorProjeto: 3,
  userAgent: 'Mozilla/5.0 (compatible; b3-scraper/1.0)',
};

const URLS = {
  legacy: 'https://sistemasweb.b3.com.br/Leiloes/ConsultarLeilao/Index',
  bvmf: 'https://bvmf.bmfbovespa.com.br/consulta-leiloes/Resumoleiloesespeciais.aspx?Idioma=pt-br',
  detalhe: 'https://sistemasweb.b3.com.br/Leiloes/ConsultarLeilao/Detalhe',
};

function fromEnv(key, defaultVal, parse = (v) => v) {
  const v = process.env[key];
  return v != null && v !== '' ? parse(v) : defaultVal;
}

function loadConfig(argv = {}) {
  const cfg = {
    ...DEFAULTS,
    anos: argv.anos || fromEnv('B3_ANOS', DEFAULTS.anos,
      (v) => v.split(',').map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite)),
    concorrencia: argv.concorrencia || fromEnv('B3_CONCURRENCY', DEFAULTS.concorrencia, parseInt),
    batchSize: argv.batchSize || fromEnv('B3_BATCH_SIZE', DEFAULTS.batchSize, parseInt),
    cacheDir: fromEnv('B3_CACHE_DIR', DEFAULTS.cacheDir),
    outputDir: fromEnv('B3_OUTPUT_DIR', DEFAULTS.outputDir),
    navTimeout: fromEnv('B3_NAV_TIMEOUT', DEFAULTS.navTimeout, parseInt),
    dlTimeout: fromEnv('B3_DL_TIMEOUT', DEFAULTS.dlTimeout, parseInt),
    hostDelay: fromEnv('B3_HOST_DELAY', DEFAULTS.hostDelay, parseInt),
    root: ROOT,
    urls: URLS,
    dryRun: argv.dryRun || false,
    retomar: argv.retomar || false,
    forceRedownload: argv.forceRedownload || false,
    baixarTudo: argv.baixarTudo || false,
    categorias: argv.categorias || ['manual_b3', 'edital', 'anexo_contrato', 'errata'],
  };

  // Resolver caminhos absolutos
  for (const key of ['pdfDir', 'snippetDir', 'resultDir', 'manifestPath',
                     'dedupPath', 'projectsPath', 'progressPath', 'seedPath']) {
    cfg[key] = path.resolve(ROOT, DEFAULTS[key]);
  }
  cfg.cacheDir = path.resolve(ROOT, cfg.cacheDir);
  cfg.outputDir = path.resolve(ROOT, cfg.outputDir);
  return cfg;
}

module.exports = { loadConfig, URLS, DEFAULTS };
