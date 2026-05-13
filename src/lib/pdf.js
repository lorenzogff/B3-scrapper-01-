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

/**
 * Localiza a página alvo lendo APENAS as primeiras 7 páginas (sumário).
 * Retorna { pagina, ancora, totalPaginas, paginas } | { paginas, totalPaginas } se não achou.
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
  // Fallback: TOC pode estar ausente/malformatado (visto em manuais ANTT
  // e PPP recentes onde pdf-parse junta a linha do sumário). Tenta achar
  // o cabeçalho da seção direto no corpo do PDF.
  if (!alvo) alvo = localizarAncoraNoCorpo(paginas);
  return { alvo, totalPaginas, paginas };
}

/**
 * Monta o snippet de 3-4 páginas em torno da página alvo.
 */
function montarTrecho(paginas, paginaAlvo) {
  const total = paginas.length;
  const indices = [paginaAlvo - 1, paginaAlvo, paginaAlvo + 1, paginaAlvo + 2];
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
