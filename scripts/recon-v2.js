#!/usr/bin/env node
/**
 * scripts/recon-v2.js
 * Recon focado: vai DIRETO na URL do iframe da B3 (bvmf antiga),
 * captura a tabela real de licitacoes e a pagina secundaria de
 * um projeto especifico.
 *
 * Saida: pasta ./recon2/ (separada do recon anterior).
 *
 * Uso:
 *   node scripts/recon-v2.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve('recon2');
const LISTING = 'https://bvmf.bmfbovespa.com.br/consulta-leiloes/Resumoleiloesespeciais.aspx?Idioma=pt-br';
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
  console.log('[1/5] launching chromium (headed)...');
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();

  const xhr = [];
  page.on('response', async (r) => {
    try {
      xhr.push({
        url: r.url(),
        status: r.status(),
        contentType: r.headers()['content-type'] || '',
      });
    } catch { /* ignore */ }
  });

  console.log('[2/5] loading bvmf listing directly...');
  console.log('       ' + LISTING);
  await page.goto(LISTING, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(4_000);

  save('listing.html', await page.content());
  await page.screenshot({ path: path.join(OUT, 'listing.png'), fullPage: true });
  console.log('  saved listing.png');
  save('listing-xhr.json', xhr);

  // Extract all tables, row by row, with cell text AND links per cell
  const tables = await page.$$eval('table', (ts) => ts.map((t, idx) => {
    const headerCells = t.rows[0] ? Array.from(t.rows[0].cells).map(c => c.textContent.trim()) : [];
    const rows = [];
    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      const cells = Array.from(r.cells).map(c => ({
        text: (c.textContent || '').trim().replace(/\s+/g, ' '),
        links: Array.from(c.querySelectorAll('a')).map(a => ({
          text: (a.textContent || '').trim().replace(/\s+/g, ' '),
          href: a.href,
        })),
      }));
      rows.push(cells);
    }
    return {
      index: idx,
      class: t.className || '',
      id: t.id || '',
      rowCount: t.rows.length,
      headerCells,
      rowsSample: rows.slice(0, 5),
      rowsAll: rows,
    };
  }));
  save('listing-tables.json', tables);
  console.log(`       tables found: ${tables.length}`);
  tables.forEach(t => console.log(`         table[${t.index}] rows=${t.rowCount} header=${JSON.stringify(t.headerCells)}`));

  // Section headings (h1/h2/h3) for context
  const headings = await page.$$eval('h1, h2, h3', (hs) => hs.map(h => ({
    tag: h.tagName,
    text: (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
  })));
  save('listing-headings.json', headings);

  // All links anywhere on page
  const links = await page.$$eval('a', (as) => as.map((a) => ({
    text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    href: a.href,
    target: a.target || '',
  })));
  save('listing-links.json', links);
  console.log(`       total <a>: ${links.length}`);

  // Project links: those whose text matches "XXX/AAAA" or are inside data-rich rows
  // Pick first project from the "Em Andamento" table heuristically
  console.log('[3/5] picking first project to click...');
  let firstProjectHref = null;
  let firstProjectText = null;
  for (const t of tables) {
    if (t.rowCount < 2) continue;
    for (let i = 1; i < t.rowsAll.length; i++) {
      const row = t.rowsAll[i];
      if (!row || row.length < 2) continue;
      const allLinks = row.flatMap(c => c.links);
      const projLink = allLinks.find(l =>
        /\d{2,3}\s*[/-]\s*\d{4}/.test(l.text) ||
        /licitac|leil|edital|concess/i.test(l.text)
      );
      if (projLink) {
        firstProjectHref = projLink.href;
        firstProjectText = row.map(c => c.text).join(' | ').slice(0, 200);
        break;
      }
      // Fallback: first link in the row whose href is not just '#'
      const anyLink = allLinks.find(l => l.href && !l.href.endsWith('#'));
      if (anyLink) {
        firstProjectHref = anyLink.href;
        firstProjectText = row.map(c => c.text).join(' | ').slice(0, 200);
        break;
      }
    }
    if (firstProjectHref) break;
  }

  if (!firstProjectHref) {
    console.log('  !! nenhuma linha com link encontrada');
    save('detalhe-status.json', { ok: false, reason: 'no clickable row link found' });
  } else {
    console.log(`       text: "${firstProjectText}"`);
    console.log(`       href: ${firstProjectHref}`);

    console.log('[4/5] navigating to project detail...');
    try {
      await page.goto(firstProjectHref, { waitUntil: 'networkidle', timeout: 60_000 });
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

      const pdfs = detLinks.filter((l) => /\.pdf(\?|$)/i.test(l.href));
      save('detalhe-pdfs.json', pdfs);
      console.log(`       pdf links on detalhe: ${pdfs.length}`);

      // Possibly "Manual de Procedimentos" link
      const manuais = detLinks.filter((l) => /manual.*procedim|procedim.*manual/i.test(l.text));
      save('detalhe-manuais.json', manuais);
      console.log(`       links com "Manual de Procedimentos": ${manuais.length}`);

      save('detalhe-info.json', {
        ok: true,
        opened_href: firstProjectHref,
        landed_url: page.url(),
        title: await page.title(),
        listing_text: firstProjectText,
      });
    } catch (e) {
      console.log(`  !! erro: ${e.message}`);
      save('detalhe-status.json', { ok: false, reason: e.message });
    }
  }

  console.log('[5/5] done.');
  console.log('');
  console.log('   Para zipar (PowerShell):');
  console.log('     Compress-Archive -Path recon2 -DestinationPath recon2.zip -Force');
  console.log('');

  await page.waitForTimeout(1_500);
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
