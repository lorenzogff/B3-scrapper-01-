/**
 * src/lib/http.js
 * Sessões HTTP: Playwright (navegação) + Axios (downloads de PDF com stream).
 */

const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs-extra');
const { sleep } = require('./utils');

async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({ headless });
}

async function newContext(browser, userAgent) {
  return browser.newContext({
    userAgent,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 800 },
  });
}

/**
 * Download de PDF com stream, retry exponencial e rate-limit por host.
 */
async function baixarPdf(url, destino, opts = {}) {
  const {
    timeout = 180_000,
    maxRetries = 3,
    userAgent = 'Mozilla/5.0 b3-scraper/1.0',
    lastHostAccess,
    hostDelay = 600,
  } = opts;

  if (lastHostAccess) {
    const host = new URL(url).host;
    const lastT = lastHostAccess.get(host) || 0;
    const espera = Math.max(0, hostDelay - (Date.now() - lastT));
    if (espera > 0) await sleep(espera);
    lastHostAccess.set(host, Date.now());
  }

  let ultErro;
  for (let tent = 1; tent <= maxRetries; tent++) {
    try {
      const resp = await axios.get(url, {
        responseType: 'stream',
        timeout,
        headers: { 'User-Agent': userAgent },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      await new Promise((res, rej) => {
        const out = fs.createWriteStream(destino);
        resp.data.pipe(out);
        out.on('finish', res);
        out.on('error', rej);
        resp.data.on('error', rej);
      });

      return { ok: true, tentativas: tent };
    } catch (e) {
      ultErro = e;
      if (tent < maxRetries) {
        await sleep(1000 * Math.pow(2, tent - 1));
      }
    }
  }
  return { ok: false, erro: ultErro?.message || 'desconhecido' };
}

module.exports = { launchBrowser, newContext, baixarPdf };
