/**
 * src/lib/pdf.js
 * Leitura otimizada de PDFs — sumário-first.
 * NUNCA carrega o PDF inteiro para o LLM; só extrai trechos curtos.
 */

const fs = require('fs-extra');
const fsp = require('fs').promises;
const pdfParse = require('pdf-parse');
const { localizarAncoraNoSumario, localizarAncoraNoCorpo } = require('./regex');

/**
 * Extrai texto do PDF dividido por página (usa \f como delimitador).
 */
async function extrairTextoPorPagina(buffer) {
  const opts = {
    pagerender: (pageData) => pageData.getTextContent().then((tc) => {
      let text = '';
      let lastY = -1;
      for (const item of tc.items) {
        if (lastY === item.transform[5] || lastY === -1) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      // Marcador de fim de pagina — pdf-parse concatena os retornos
      // de pagerender sem separador, entao precisamos emitir um \f
      // para que o split(/\f/) abaixo recupere a estrutura de paginas.
      return text + '\f';
    }),
  };
  const data = await pdfParse(buffer, opts);
  const paginas = data.text.split(/\f/);
  // Remove ultima entrada vazia (decorrente do \f final)
  if (paginas.length && paginas[paginas.length - 1].trim() === '') paginas.pop();
  return paginas;
}

// Verifica se a janela ao redor de uma pagina contem cabecalho de
// remuneracao/emolumentos B3 + algum valor R$. Usado para descartar
// alvos do TOC que apontam para paginas erradas (off-by-N comum em
// manuais antigos onde a numeracao tipografica diverge da pagina fisica).
const RE_REM_B3_LOOSE = /(?:remunera[çc][ãa]o|emolumentos?)[\s\S]{0,80}b3/i;
const RE_VALOR_LOOSE = /R\$\s*[\d.,]+/;
function janelaTemRemuneracaoComValor(paginas, paginaAlvo) {
  const ini = Math.max(0, paginaAlvo - 2);
  const fim = Math.min(paginas.length, paginaAlvo + 3);
  const trecho = paginas.slice(ini, fim).join(' ');
  return RE_REM_B3_LOOSE.test(trecho) && RE_VALOR_LOOSE.test(trecho);
}

/**
 * Localiza a página alvo lendo APENAS as primeiras 7 páginas (sumário).
 * Retorna { pagina, ancora, totalPaginas, paginas } | { paginas, totalPaginas } se não achou.
 *
 * Encadeamento:
 *   1) TOC anchor (rápido, casa maioria dos manuais bem-formatados)
 *   2) Verifica se a janela apontada contem remuneracao+R\$. Se não tem,
 *      assume que o TOC apontou para a pagina errada (caso BVMF_10923,
 *      10811, 10590 etc.) e tenta novamente pelo corpo.
 *   3) Body anchor (varre todas as paginas procurando o header de secao)
 */
async function localizarAlvo(pdfPath) {
  const buffer = await fs.readFile(pdfPath);
  const paginas = await extrairTextoPorPagina(buffer);
  const totalPaginas = paginas.length;

  const nTOC = Math.min(7, totalPaginas);
  const sumario = paginas.slice(0, nTOC)
    .map((t, i) => `[[P${i + 1}]]\n${t}`)
    .join('\n\n');

  let alvo = localizarAncoraNoSumario(sumario, totalPaginas);
  // Validacao: o TOC pode apontar uma pagina sem o conteudo real (off-by-N
  // entre numeracao tipografica e pagina fisica do PDF). Se a janela nao
  // tem remuneracao+valor, faz fallback no corpo.
  if (alvo && !janelaTemRemuneracaoComValor(paginas, alvo.pagina)) {
    const alt = localizarAncoraNoCorpo(paginas);
    if (alt && janelaTemRemuneracaoComValor(paginas, alt.pagina)) {
      alvo = alt;
    }
  }
  // Fallback total: TOC pode estar ausente/malformatado (manuais ANTT, PPP
  // recentes). Tenta achar o cabecalho da secao direto no corpo do PDF.
  if (!alvo) alvo = localizarAncoraNoCorpo(paginas);
  return { alvo, totalPaginas, paginas };
}

/**
 * Monta o snippet de 5-6 páginas em torno da página alvo.
 * Janela expandida de [paginaAlvo-1, +2] para [paginaAlvo-2, +3] para
 * compensar off-by-N entre numeracao do TOC e pagina fisica do PDF.
 */
function montarTrecho(paginas, paginaAlvo) {
  const total = paginas.length;
  const indices = [paginaAlvo - 2, paginaAlvo - 1, paginaAlvo, paginaAlvo + 1, paginaAlvo + 2, paginaAlvo + 3];
  const partes = [];
  for (const i of indices) {
    if (i >= 1 && i <= total) {
      partes.push(`--- p.${i} ---\n${paginas[i - 1]}`);
    }
  }
  return partes.join('\n\n');
}

/**
 * Valida que o arquivo é um PDF legítimo.
 */
async function validarPdf(filepath, minSize = 5000) {
  const stat = await fs.stat(filepath);
  if (stat.size < minSize) {
    return { ok: false, motivo: `tamanho ${stat.size}B < mínimo ${minSize}B` };
  }
  const fd = await fsp.open(filepath, 'r');
  try {
    const buf = Buffer.alloc(5);
    await fd.read(buf, 0, 5, 0);
    if (buf.toString('ascii') !== '%PDF-') {
      return { ok: false, motivo: 'magic bytes inválidos' };
    }
  } finally {
    await fd.close();
  }
  return { ok: true, size: stat.size };
}

module.exports = { extrairTextoPorPagina, localizarAlvo, montarTrecho, validarPdf };
