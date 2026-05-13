/**
 * src/lib/sources/bvmf-listing.js
 *
 * Parser do listing real da B3 (iframe que vive em
 * https://bvmf.bmfbovespa.com.br/consulta-leiloes/Resumoleiloesespeciais.aspx).
 *
 * Estrutura observada (recon 2026-05):
 *   - <table id="...grdResumoLeiloesEspeciaisAndamento_ctl01">
 *       header: Data da Sessão | Projeto
 *       N linhas de leiloes futuros
 *   - <table id="...grdResumoLeiloesEspeciaisAnteriores_ctl01">
 *       header: Data | Descricao
 *       N linhas de leiloes ja realizados (~400)
 *
 * Cada linha do projeto tem dois <td>:
 *   1) data DD/MM/AAAA (sem link)
 *   2) titulo com um <a> apontando para
 *      ResumoLeiloesEspeciaisDetalhe.aspx?IdLeilao=NNNNN&TituloLeilao=...
 *
 * Modulo puro: nao toca rede. Recebe HTML, retorna array de projetos.
 */

const cheerio = require('cheerio');

const SELECTORS = {
  emAndamento: 'table[id*="grdResumoLeiloesEspeciaisAndamento"]',
  anteriores: 'table[id*="grdResumoLeiloesEspeciaisAnteriores"]',
};

const RE_DETALHE = /IdLeilao=(\d+)/i;
const RE_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
// Numero do edital: "001/2026", "14-2026", "100/24", etc.
const RE_NUM_EDITAL = /\b(\d{1,4})\s*[\/.-]\s*(\d{2,4})\b/;
// Prefixo de status no titulo do projeto (visto em 2024-2026):
// "DESERTO - BNDES - 01/2025 - ...", "SUSPENSO - ...", "CANCELADO - ...", "REVOGADO - ...".
// Tambem aceita "ADIADO" e "ANULADO" por seguranca.
const RE_STATUS_PREFIX = /^(DESERTO|SUSPENSO|CANCELADO|REVOGADO|ADIADO|ANULADO|FRACASSADO)\s*[-–—]\s*/i;

/**
 * Extrai um inteiro de 4 digitos representando o ano a partir de:
 *  - data DD/MM/AAAA (preferencia)
 *  - numero do edital (NNN/AAAA)
 *  - qualquer 4-digit run no titulo (fallback)
 */
function extrairAno(data, titulo) {
  const md = data.match(RE_DATA);
  if (md) return parseInt(md[3], 10);

  const mn = titulo.match(RE_NUM_EDITAL);
  if (mn) {
    let ano = parseInt(mn[2], 10);
    if (ano < 100) ano += ano >= 70 ? 1900 : 2000;
    return ano;
  }

  const mt = titulo.match(/\b(20\d{2})\b/);
  if (mt) return parseInt(mt[1], 10);

  return 0;
}

function extrairNumEdital(titulo) {
  const m = titulo.match(RE_NUM_EDITAL);
  return m ? `${m[1]}/${m[2]}` : '';
}

function parseRow($, row, fonte) {
  const cells = $(row).find('td');
  if (cells.length < 2) return null;

  const data = $(cells[0]).text().trim().replace(/\s+/g, ' ');
  if (!RE_DATA.test(data)) return null;

  const link = $(cells[1]).find('a[href*="IdLeilao="]').first();
  if (!link.length) return null;

  const href = link.attr('href') || '';
  const tituloRaw = link.text().trim().replace(/\s+/g, ' ');
  if (!tituloRaw) return null;

  const mid = href.match(RE_DETALHE);
  if (!mid) return null;
  const idLeilao = parseInt(mid[1], 10);

  // Detecta e remove prefixo de status (DESERTO, SUSPENSO, CANCELADO, ...).
  // O titulo limpo vai pra coluna 'Nome do projeto'; o status fica em status_b3.
  const ms = tituloRaw.match(RE_STATUS_PREFIX);
  const statusB3 = ms ? ms[1].toUpperCase() : 'ATIVO';
  const titulo = ms ? tituloRaw.slice(ms[0].length).trim() : tituloRaw;

  const ano = extrairAno(data, titulo);
  const numEdital = extrairNumEdital(titulo);
  const url = new URL(href, 'https://bvmf.bmfbovespa.com.br/consulta-leiloes/').toString();

  return {
    id: `BVMF_${idLeilao}`,
    id_leilao: idLeilao,
    num_edital: numEdital,
    titulo,
    titulo_original: tituloRaw,
    status_b3: statusB3,
    data,
    ano,
    fonte,
    url_detalhe: url,
  };
}

/**
 * @param {string} html  HTML completo da pagina de listing
 * @returns {Array<Object>} lista de projetos extraidos
 */
function parseListing(html) {
  const $ = cheerio.load(html);
  const projetos = [];
  const seen = new Set();

  const blocos = [
    { sel: SELECTORS.emAndamento, fonte: 'bvmf_em_andamento' },
    { sel: SELECTORS.anteriores, fonte: 'bvmf_anteriores' },
  ];

  for (const { sel, fonte } of blocos) {
    const tbl = $(sel).first();
    if (!tbl.length) continue;
    tbl.find('tr').each((_, row) => {
      const p = parseRow($, row, fonte);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        projetos.push(p);
      }
    });
  }

  return projetos;
}

/**
 * @param {Array<Object>} projetos resultado de parseListing
 * @param {Array<number>} anos anos desejados (ex.: [2024, 2025])
 */
function filtrarPorAno(projetos, anos) {
  if (!anos || !anos.length) return projetos;
  const set = new Set(anos);
  return projetos.filter((p) => set.has(p.ano));
}

/**
 * Filtra apenas leiloes com status ATIVO (remove DESERTO, SUSPENSO, CANCELADO,
 * REVOGADO, ADIADO, ANULADO, FRACASSADO).
 * @param {Array<Object>} projetos
 */
function filtrarAtivos(projetos) {
  return projetos.filter((p) => p.status_b3 === 'ATIVO');
}

module.exports = {
  parseListing,
  filtrarPorAno,
  filtrarAtivos,
  SELECTORS,
  RE_DETALHE,
  RE_DATA,
  RE_NUM_EDITAL,
  RE_STATUS_PREFIX,
};
