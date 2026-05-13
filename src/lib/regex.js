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

// Helper: conector entre "remuneração" e "B3" — aceita "da/de/do/à/devida"
// com variantes (ex.: "remuneração da B3", "remuneração à B3", "remuneração
// devida à B3", "remuneração devida pela X de cada BLOCO de R$").
// Os manuais 2018-2020 esmagadoramente usam "da B3" (ausente no regex antigo).
const CONECTOR_B3 = '(?:d[aeo]\\s+|à\\s+|devida\\s+(?:à\\s+|d[aeo]\\s+)?|para\\s+(?:à\\s+)?)?';
// Sinonimos do termo de pagamento à B3. "Emolumentos da/à B3" e
// "Remuneração da/à B3" sao intercambiaveis nos manuais.
const TERMO_PAGAMENTO_B3 = '(?:remunera[çc][ãa]o|emolumentos?)';

// \s* (não \s+) para tolerar PDFs onde pdf-parse devolve texto sem espaços
// entre palavras (visto em manuais com fonte custom, ex.: Sanepar, Betim PPP).
const ANCORAS_TOC = [
  [/obriga[çc][õo]es\s*pr[ée]vi(?:as|a)\s*(?:à\s*)?assinatura/i, 'obrigacoes_previas'],
  [new RegExp('cap[íi]tulo\\s*(?:\\d{1,2}|[IVX]+)\\b[^.\\n]{0,80}' + TERMO_PAGAMENTO_B3 + '[\\s]*(?:da|d\')?[\\s]*b3', 'i'), 'capitulo_remuneracao'],
  [new RegExp('homologa[çc][ãa]o\\s*da\\s*licita[çc][ãa]o\\s*e\\s*' + TERMO_PAGAMENTO_B3, 'i'), 'homologacao'],
  [new RegExp(TERMO_PAGAMENTO_B3 + '\\s+' + CONECTOR_B3 + 'b3', 'i'), 'remuneracao_b3'],
  [/reembolso\s*(?:à\s*)?b3/i, 'reembolso_b3'],
];

// ───────────────────────────────────────────────────────────────────────────
// Extração de valor monetário próximo a contexto B3
// ───────────────────────────────────────────────────────────────────────────

// Padrão canônico: "importância de R$ 396.000,00 (trezentos e ...)".
// \s* permite texto comprimido ("naimportânciadeR$684.035,88").
const RE_VALOR_CANONICO = /import[âa]ncia\s*de\s*R\$\s*([\d.,]+)(?:\s*\(([^)]{5,250})\))?/gi;

// Variante "remuneração|emolumentos [da|à|devida] B3 ... R$" — comum em
// manuais 2018-2020. Janela de 300 chars (era 200) cobre os textos novos.
const RE_VALOR_REMUN = new RegExp(
  TERMO_PAGAMENTO_B3 + '\\s+' + CONECTOR_B3 + 'B3[^.]{0,300}?R\\$\\s*([\\d.,]+)',
  'gi'
);
const RE_VALOR_REEMBOLSO = /reembolso\s*(?:à\s*)?B3[^.]{0,200}?R\$\s*([\d.,]+)/gi;
const RE_VALOR_TAXA_ADESAO = /taxa\s*de\s*ades[ãa]o[^.]{0,200}?R\$\s*([\d.,]+)/gi;
// Padrão "montante (total) referente (à sua) remuneração|emolumentos ... R$"
// — específico para evitar falso-positivo em "montante de indenização"
// (Apólice/Carta de Fiança que aparece em editais ANEEL).
const RE_VALOR_MONTANTE = new RegExp(
  'montante\\s+(?:total\\s+)?referente\\s+(?:à\\s+sua\\s+)?(?:' + TERMO_PAGAMENTO_B3 + ')?[^.]{0,200}?R\\$\\s*([\\d.,]+)',
  'gi'
);

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
      // Estratégia 1 (preferida): número de página IMEDIATAMENTE APÓS o match.
      // Funciona tanto para TOC bem-formatado (CAPÍTULO X .... NN no fim da linha)
      // quanto para TOC numa linha só (manuais onde pdf-parse junta tudo).
      const after = textoSumario.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const numInline = after.match(/(?:\.{2,}|\s)\s*(\d{1,3})(?=\s|$|[A-ZÁÊÇÕ])/);

      // Estratégia 2 (fallback): número de página no FIM da linha do match
      const lineStart = textoSumario.lastIndexOf('\n', m.index) + 1;
      const lineEnd = textoSumario.indexOf('\n', m.index + m[0].length);
      const linha = textoSumario.slice(lineStart, lineEnd === -1 ? textoSumario.length : lineEnd);
      const numFim = linha.match(/\b(\d{1,3})\s*$/);

      let pag = null;
      if (numInline) pag = parseInt(numInline[1], 10);
      else if (numFim) pag = parseInt(numFim[1], 10);
      if (pag == null) continue;
      if (pag < 5 || pag > 500 || pag > totalPaginas) continue;
      if (!melhor || prio < melhor.prio) {
        melhor = { prio, pagina: pag, ancora: nome };
      }
    }
  }
  return melhor;
}

/**
 * Fallback: quando o TOC não rendeu âncora, varre as páginas inteiras
 * procurando o cabeçalho da seção "REMUNERAÇÃO DA B3" no CORPO. Usado
 * em manuais sem TOC, com TOC malformatado pelo pdf-parse, ou cujo
 * sumário não lista o capítulo de remuneração.
 *
 * @param {string[]} paginas array de texto por página
 * @returns {{pagina:number, ancora:string} | null}
 */
function localizarAncoraNoCorpo(paginas) {
  if (!Array.isArray(paginas) || paginas.length === 0) return null;

  // Header forte: "CAPÍTULO N REMUNERAÇÃO|EMOLUMENTOS DA B3"
  const RE_HEADER_FORTE = new RegExp(
    'cap[íi]tulo\\s*(?:\\d{1,2}|[IVX]+)\\s*[–\\-—]?\\s*' + TERMO_PAGAMENTO_B3 + '\\s+' + CONECTOR_B3 + 'b3',
    'i'
  );
  // Header médio: linha "REMUNERAÇÃO|EMOLUMENTOS DA B3" + valor (R$) na mesma página
  const RE_HEADER_MEDIO = new RegExp(TERMO_PAGAMENTO_B3 + '\\s+' + CONECTOR_B3 + 'b3', 'i');
  const RE_TEM_VALOR = /R\$\s*[\d.,]+/;

  // Pular as primeiras 3 páginas (capa/sumário) para evitar âncoras espúrias
  const inicio = Math.min(3, paginas.length - 1);

  // Prioridade 1: header forte
  for (let i = inicio; i < paginas.length; i++) {
    if (RE_HEADER_FORTE.test(paginas[i] || '')) {
      return { pagina: i + 1, ancora: 'corpo_capitulo_remuneracao' };
    }
  }
  // Prioridade 2: header médio + valor na mesma página
  for (let i = inicio; i < paginas.length; i++) {
    const t = paginas[i] || '';
    if (RE_HEADER_MEDIO.test(t) && RE_TEM_VALOR.test(t)) {
      return { pagina: i + 1, ancora: 'corpo_remuneracao_com_valor' };
    }
  }
  return null;
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
    { rx: RE_VALOR_MONTANTE, fonte: 'montante' },
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
  localizarAncoraNoCorpo,
  extrairRemuneracaoB3,
  extrairValorGlobal,
  paginaDoMatch,
  loteDoContexto,
};
