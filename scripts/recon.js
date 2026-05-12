#!/usr/bin/env node
/**
 * scripts/recon.js
 * Reconhecimento do site da B3 para o b3-scraper.
 *
 * Abre o portal de licitacoes da B3, captura:
 *  - HTML completo do listing apos render JS
 *  - Todos os links (<a>) e tabelas
 *  - Filtros / paginacao detectaveis
 *  - Requisicoes XHR/JSON feitas pela pagina
 *  - Screenshot do listing
 *  - O mesmo para a pagina de detalhe do PRIMEIRO projeto encontrado
 *
 * Saida: pasta ./recon/ com tudo. Zipe e envie para analise.
 *
 * Uso:
 *   node scripts/recon.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve('recon');
const LISTING = 'https://b3.com.br/pt_br/produtos-e-servicos/negociacao/leiloes/licitacoes-publicas/licitacoes/em-andamento-e-anteriores/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function save(name, data) {
  const p = path.join(OUT, name);
  if (typeof data === 'string') fs.writeFileSync(p, data, 'utf8');
  else fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  const size = typeof data === 'string' ? data.length : JSON.stringify(data).length;
  console.log(`  saved ${name} (${size} bytes)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('[1/4] launching chromium (headed)...');
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 800 },
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();

  const xhr = [];
  page.on('response', async (r) => {
    try {
      const url = r.url();
      const ct = r.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('xml') || /\/api\/|\.json(\?|$)/.test(url)) {
        const body = await r.body().catch(() => Buffer.alloc(0));
        xhr.push({ url, status: r.status(), contentType: ct, bytes: body.length });
      }
    } catch { /* ignore */ }
  });

  console.log('[2/4] loading listing...');
  console.log('       ' + LISTING);
  await page.goto(LISTING, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(5_000);

  save('listing.html', await page.content());
  await page.screenshot({ path: path.join(OUT, 'listing.png'), fullPage: true });
  console.log('  saved listing.png');

  const links = await page.$$eval('a', (as) => as.map((a) => ({
    text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    href: a.href,
    target: a.target || '',
  })));
  save('listing-links.json', links);
  console.log(`       total <a>: ${links.length}`);

  const projectLinks = links.filter((l) =>
    /\d{2,3}\s*[/-]\s*\d{4}/.test(l.text) || /\d{2}\/\d{2}\/\d{4}/.test(l.text)
  );
  save('listing-project-links.json', projectLinks);
  console.log(`       project-like links: ${projectLinks.length}`);

  const tables = await page.$$eval('table', (ts) => ts.map((t, i) => ({
    index: i,
    rows: t.rows.length,
    headerText: (t.rows[0] && t.rows[0].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
    sampleRow: (t.rows[1] && t.rows[1].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
  })));
  save('listing-tables.json', tables);
  console.log(`       tables found: ${tables.length}`);

  const ui = await page.$$eval('select, input[type="search"], [class*="paginat" i], [class*="filtr" i], [class*="pager" i]', (els) =>
    els.map((e) => ({
      tag: e.tagName,
      type: e.type || '',
      name: e.name || '',
      id: e.id || '',
      class: (typeof e.className === 'string' ? e.className : '').slice(0, 200),
      text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    })));
  save('listing-ui.json', ui);

  save('listing-xhr.json', xhr);
  console.log(`       xhr/json captured: ${xhr.length}`);

  console.log('[3/4] opening first project detail...');
  if (projectLinks.length === 0) {
    console.log('  !! nenhum link de projeto detectado; veja listing-links.json manualmente');
    save('detalhe-status.json', { ok: false, reason: 'no project-like links found' });
  } else {
    const first = projectLinks[0];
    console.log(`       text: "${first.text}"`);
    console.log(`       href: ${first.href}`);
    try {
      await page.goto(first.href, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForTimeout(3_000);

      save('detalhe.html', await page.content());
      await page.screenshot({ path: path.join(OUT, 'detalhe.png'), fullPage: true });
      console.log('  saved detalhe.png');

      const detLinks = await page.$$eval('a', (as) => as.map((a) => ({
        text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
        href: a.href,
        target: a.target || '',
      })));
      save('detalhe-links.json', detLinks);
      console.log(`       total <a>: ${detLinks.length}`);

      const pdfs = detLinks.filter((l) => /\.pdf(\?|$)/i.test(l.href));
      save('detalhe-pdfs.json', pdfs);
      console.log(`       pdf links: ${pdfs.length}`);

      save('detalhe-info.json', {
        ok: true,
        opened_href: first.href,
        landed_url: page.url(),
        title: await page.title(),
        listing_text: first.text,
      });
    } catch (e) {
      console.log(`  !! erro abrindo detalhe: ${e.message}`);
      save('detalhe-status.json', { ok: false, reason: e.message });
    }
  }

  console.log('[4/4] done.');
  console.log('');
  console.log('   Saida em:', OUT);
  console.log('');
  console.log('   Para zipar (PowerShell):');
  console.log('     Compress-Archive -Path recon -DestinationPath recon.zip -Force');
  console.log('');
  console.log('   Mande recon.zip para o Claude.');
  console.log('');

  await page.waitForTimeout(1_500);
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
