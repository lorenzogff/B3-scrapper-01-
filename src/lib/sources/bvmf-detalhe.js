/**
 * src/lib/sources/bvmf-detalhe.js
 *
 * Parser da pagina de detalhe de um leilao especifico
 * (ResumoLeiloesEspeciaisDetalhe.aspx?IdLeilao=N).
 *
 * Estrutura observada: a pagina lista 1..N documentos com texto numerado.
 * Os dois principais sao:
 *   "01. Site do Projeto"           -> URL externa do issuer (CAGEPA, gov.br, ...)
 *   "02. Manual de Procedimentos da B3" -> lum-download.asp?CodLeil=N&CodLeilSubt=2&idioma=pt-br
 *
 * Outros sub-tipos vistos em outros projetos: edital, anexos, errata etc.,
 * sempre via lum-download.asp com CodLeilSubt diferente.
 *
 * Modulo puro: nao toca rede. Recebe HTML, retorna documentos identificados.
 */

const cheerio = require('cheerio');

const RE_LUM = /lum-download\.asp\?CodLeil=(\d+)(?:&CodLeilSubt=(\d+))?/i;
const PADROES = [
  { re: /manual.*procedim/i, categoria: 'manual_b3', prioridade: 1 },
  { re: /^site.*projeto|^\d+\.\s*site/i, categoria: 'site_projeto', prioridade: 99 },
  { re: /edital/i, categoria: 'edital', prioridade: 2 },
  { re: /minuta.*contrato|contrato.*concess/i, categoria: 'anexo_contrato', prioridade: 3 },
  { re: /anexo.*assinatura|anexo.*obriga[çc][õo]es/i, categoria: 'anexo_contrato', prioridade: 3 },
  { re: /errata|adendo|retifica/i, categoria: 'errata', prioridade: 4 },
];

function classificar(texto) {
  for (const { re, categoria, prioridade } of PADROES) {
    if (re.test(texto)) return { categoria, prioridade };
  }
  return { categoria: 'outros', prioridade: 90 };
}

/**
 * @param {string} html        HTML da pagina de detalhe
 * @param {string} baseUrl     URL absoluta para resolver hrefs relativos
 * @returns {Object} { documentos: [], url_manual, url_site_projeto, id_leilao }
 */
function parseDetalhe(html, baseUrl) {
  const $ = cheerio.load(html);
  const documentos = [];
  const seen = new Set();
  let idLeilao = null;

  $('a[href]').each((_, a) => {
    const href = ($(a).attr('href') || '').trim();
    if (!href) return;
    const texto = $(a).text().trim().replace(/\s+/g, ' ');
    if (!texto) return;

    // Resolver URL absoluta
    let url;
    try { url = baseUrl ? new URL(href, baseUrl).toString() : href; }
    catch { url = href; }

    if (seen.has(url)) return;
    seen.add(url);

    const ehLumDownload = RE_LUM.test(url);
    if (ehLumDownload) {
      const m = url.match(RE_LUM);
      if (m) {
        idLeilao = idLeilao || parseInt(m[1], 10);
      }
    }

    // So coleta links que sao documento da B3 (lum-download.asp) ou Site do Projeto
    const ehSiteProjeto = /site.*projeto/i.test(texto) || /^\d+\.\s*site/i.test(texto);
    if (!ehLumDownload && !ehSiteProjeto) return;

    const { categoria, prioridade } = classificar(texto);
    documentos.push({ texto, url, categoria, prioridade });
  });

  documentos.sort((a, b) => a.prioridade - b.prioridade);

  const manual = documentos.find((d) => d.categoria === 'manual_b3');
  const site = documentos.find((d) => d.categoria === 'site_projeto');

  return {
    id_leilao: idLeilao,
    url_manual: manual ? manual.url : '',
    url_site_projeto: site ? site.url : '',
    documentos,
  };
}

module.exports = {
  parseDetalhe,
  classificar,
  RE_LUM,
  PADROES,
};
