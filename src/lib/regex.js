/**
 * src/lib/regex.js
 * Regex de extração — coração do parser. Isolado para fácil ajuste sem mexer
 * em lógica de orquestração.
 *
 * ESTRATÉGIA REGEX-FIRST:
 *  - Padrão canônico do Manual de Procedimentos B3:
 *    "importância de R$ X.XXX,XX (extenso)"
 *  - Variantes capturadas por ordem de prioridade.
 *  - Toda extração é local (sem chamada de LLM).
 */

// ───────────────────────────────────────────────────────────────────────────
// Âncoras de sumário (TOC) — em ordem de prioridade
// ───────────────────────────────────────────────────────────────────────────

const ANCORAS_TOC = [
  [/obriga[çc][õo]es\s+pr[ée]vi(?:as|a)\s+(?:à\s+)?assinatura/i, 'obrigacoes_previas'],
  [/cap[íi]tulo\s+(?:6|VI)\b[^.\n]{0,80}remunera[çc][ãa]o/i, 'capitulo_6'],
  [/homologa[çc][ãa]o\s+da\s+licita[çc][ãa]o\s+e\s+remunera[çc][ãa]o/i, 'homologacao'],
  [/remunera[çc][ãa]o\s+(?:devida\s+)?(?:à\s+)?b3/i, 'remuneracao_b3'],
  [/reembolso\s+(?:à\s+)?b3/i, 'reembolso_b3'],
];

// ───────────────────────────────────────────────────────────────────────────
// Extração de valor monetário próximo a contexto B3
// ───────────────────────────────────────────────────────────────────────────

// Padrão canônico: "importância de R$ 396.000,00 (trezentos e ...)"
const RE_VALOR_CANONICO = /import[âa]ncia\s+de\s+R\$\s*([\d.,]+)(?:\s*\(([^)]{5,250})\))?/gi;

// Variantes (usadas se canonico não casar):
const RE_VALOR_REMUN = /remunera[çc](?:ão|ao)\s+(?:devida\s+)?(?:à\s+)?B3[^.]{0,200}?R\$\s*([\d.,]+)/gi;
const RE_VALOR_REEMBOLSO = /reembolso\s+(?:à\s+)?B3[^.]{0,200}?R\$\s*([\d.,]+)/gi;
const RE_VALOR_TAXA_ADESAO = /taxa\s+de\s+ades[ãa]o[^.]{0,200}?R\$\s*([\d.,]+)/gi;

// Identificação de lote no contexto antes do valor
const RE_LOTE = /\blote\s+(\d+|[IVX]+|[A-Z])\b/i;

// Marcador de página dentro do snippet montado (--- p.N ---)
const RE_PAGINA_MARK = /---\s*p\.(\d+)\s*---/g;

// Valor global do contrato (regex auxiliar — não é o foco principal)
const RE_VALOR_GLOBAL = [
  /valor\s+global\s+(?:do|estimado\s+do)?\s*contrato[^.]{0,300}?R\$\s*([\d.,]+)/gi,
  /investimento[s]?\s+(?:total\s+)?estimad[oa]s?[^.]{0,300}?R\$\s*([\d.,]+)/gi,
  /\bcapex\b[^.]{0,200}?R\$\s*([\d.,]+)/gi,
  /valor\s+m[íi]nimo\s+de\s+outorga[^.]{0,200}?R\$\s*([\d.,]+)/gi,
];

// ───────────────────────────────────────────────────────────────────────────
// Funções de extração
// ───────────────────────────────────────────────────────────────────────────

const { parseBR } = require('./utils');

/**
 * Localiza âncoras no texto do sumário (primeiras páginas), retorna a melhor.
 * Retorna { pagina, ancora } | null
 */
function localizarAncoraNoSumario(textoSumario, totalPaginas) {
  let melhor = null;
  for (let prio = 0; prio < ANCORAS_TOC.length; prio++) {
    const [rx, nome] = ANCORAS_TOC[prio];
    const rxG = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
    let m;
    while ((m = rxG.exec(textoSumario)) !== null) {
      const lineStart = textoSumario.lastIndexOf('\n', m.index) + 1;
      const lineEnd = textoSumario.indexOf('\n', m.index + m[0].length);
      const linha = textoSumario.slice(lineStart, lineEnd === -1 ? textoSumario.length : lineEnd);
      const numM = linha.match(/\b(\d{1,3})\s*$/);
      if (!numM) continue;
      const pag = parseInt(numM[1], 10);
      if (pag < 5 || pag > 500 || pag > totalPaginas) continue;
      if (!melhor || prio < melhor.prio) {
        melhor = { prio, pagina: pag, ancora: nome };
      }
    }
  }
  return melhor;
}

/**
 * Identifica a página atual no snippet (com marcadores "--- p.N ---").
 */
function paginaDoMatch(snippet, posicao) {
  let pag = 0;
  let m;
  RE_PAGINA_MARK.lastIndex = 0;
  while ((m = RE_PAGINA_MARK.exec(snippet)) !== null) {
    if (m.index > posicao) break;
    pag = parseInt(m[1], 10);
  }
  return pag;
}

/**
 * Identifica o lote a partir do contexto. Usa janela curta (100 chars)
 * para evitar cruzar fronteira de página em editais multi-lote.
 */
function loteDoContexto(contextoCurto) {
  const m = contextoCurto.match(RE_LOTE);
  return m ? m[1] : 'geral';
}

/**
 * Extração principal de remuneração B3 do snippet.
 * Retorna lista de { valor, valor_str, extenso, lote, pagina_pdf, contexto }
 */
function extrairRemuneracaoB3(snippet) {
  const achados = [];
  const padroes = [
    { rx: RE_VALOR_CANONICO, fonte: 'canonico' },
    { rx: RE_VALOR_REMUN, fonte: 'remuneracao_b3' },
    { rx: RE_VALOR_REEMBOLSO, fonte: 'reembolso_b3' },
    { rx: RE_VALOR_TAXA_ADESAO, fonte: 'taxa_adesao' },
  ];

  for (const { rx, fonte } of padroes) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(snippet)) !== null) {
      const valorStr = m[1];
      const extenso = (m[2] || '').trim();
      const valor = parseBR(valorStr);
      if (!Number.isFinite(valor) || valor < 1000 || valor > 50_000_000) continue;

      const ctxIni = Math.max(0, m.index - 300);
      const ctxFim = Math.min(snippet.length, m.index + m[0].length + 100);
      const contexto = snippet.slice(ctxIni, ctxFim);

      // Janela curta para detecção de lote (evita cruzar fronteira de página
      // em editais multi-lote, onde "Lote 1" e "Lote 2" estão em páginas diferentes)
      const ctxLoteIni = Math.max(0, m.index - 100);
      const contextoLote = snippet.slice(ctxLoteIni, m.index);

      // Filtro: padrão canônico já é específico ("importância de"), mas
      // os fallbacks precisam confirmar contexto B3
      if (fonte !== 'canonico' && !/\bB3\b/i.test(contexto)) continue;

      // Dedup: evita capturar mesmo valor 2x se padrões se sobrepõem
      const jaAchou = achados.some((a) =>
        Math.abs(a.valor - valor) < 0.01 && Math.abs(a.pos - m.index) < 50);
      if (jaAchou) continue;

      achados.push({
        valor,
        valor_str: `R$ ${valorStr}`,
        extenso,
        lote: loteDoContexto(contextoLote),
        pagina_pdf: paginaDoMatch(snippet, m.index),
        contexto: contexto.trim().slice(0, 500),
        fonte_regex: fonte,
        pos: m.index,
      });
    }
    if (achados.length > 0 && fonte === 'canonico') break;  // canônico tem prioridade
  }

  // Remove o campo auxiliar 'pos' do retorno final
  return achados.map(({ pos, ...rest }) => rest);
}

/**
 * Tenta extrair o valor global do contrato.
 * Retorna Number | null.
 */
function extrairValorGlobal(snippet) {
  for (const rx of RE_VALOR_GLOBAL) {
    rx.lastIndex = 0;
    const m = rx.exec(snippet);
    if (m) {
      const v = parseBR(m[1]);
      if (Number.isFinite(v) && v >= 100_000) return v;
    }
  }
  return null;
}

module.exports = {
  ANCORAS_TOC,
  localizarAncoraNoSumario,
  extrairRemuneracaoB3,
  extrairValorGlobal,
  paginaDoMatch,
  loteDoContexto,
};
