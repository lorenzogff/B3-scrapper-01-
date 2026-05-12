/**
 * src/lib/categorizer.js
 * Classifica PDFs por nome de arquivo para decidir o que baixar.
 */

const REGRAS = [
  // [regex, categoria, prioridade]  (menor = mais prioritário)
  [/manual.*procediment.*b3/i, 'manual_b3', 1],
  [/manual.*b3/i, 'manual_b3', 1],
  [/procedimentos?\s*b3/i, 'manual_b3', 1],
  [/anexo.*manual/i, 'manual_b3', 1],

  [/^edital[\s._-].*\.pdf$/i, 'edital', 2],
  [/edital[\s._-].*concorr/i, 'edital', 2],
  [/edital[\s._-].*concess/i, 'edital', 2],
  [/^edital\.pdf$/i, 'edital', 2],

  [/minuta.*contrato/i, 'anexo_contrato', 3],
  [/contrato.*concess/i, 'anexo_contrato', 3],
  [/anexo.*obriga[çc][õo]es/i, 'anexo_contrato', 3],
  [/anexo.*assinatura/i, 'anexo_contrato', 3],

  [/errata|adendo|retifica/i, 'errata', 4],
  [/esclarecimento/i, 'errata', 5],

  // Descartados por padrão
  [/evtea|estudo.*viabilidade/i, 'estudo_viabilidade', 90],
  [/planilha|spreadsheet|levantament/i, 'planilha', 91],
  [/^anexo.*\d+.*projet/i, 'projeto_geometrico', 92],
  [/mapa|cartograf|geo/i, 'mapa', 93],
  [/consulta.*p[úu]blica|audi[êe]ncia/i, 'consulta_publica', 94],
  [/^faq|perguntas.*frequentes/i, 'faq', 95],
];

function categorizar(nome) {
  for (const [rx, cat, prio] of REGRAS) {
    if (rx.test(nome)) return { categoria: cat, prioridade: prio };
  }
  return { categoria: 'outros', prioridade: 99 };
}

function deveBaixar(categoria, categoriasPermitidas, baixarTudo) {
  if (baixarTudo) return true;
  return categoriasPermitidas.includes(categoria);
}

module.exports = { categorizar, deveBaixar, REGRAS };
