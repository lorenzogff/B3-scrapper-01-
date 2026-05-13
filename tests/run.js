#!/usr/bin/env node
/**
 * tests/run.js
 * Testes unitários offline (sem rede). Valida regex e parsers.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

const fs = require('fs');
const { parseBR, brl, dataOrdenacao, sanitize } = require(path.join(ROOT, 'src/lib/utils'));
const {
  extrairRemuneracaoB3,
  extrairValorGlobal,
  localizarAncoraNoSumario,
} = require(path.join(ROOT, 'src/lib/regex'));
const { categorizar } = require(path.join(ROOT, 'src/lib/categorizer'));
const { parseListing, filtrarPorAno, filtrarAtivos } = require(path.join(ROOT, 'src/lib/sources/bvmf-listing'));
const { parseDetalhe } = require(path.join(ROOT, 'src/lib/sources/bvmf-detalhe'));
const { montarLinhas } = require(path.join(ROOT, 'src/lib/report'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── utils ────────────────────────────────────────────────────────────────

test('parseBR converte valores BR', () => {
  assert.strictEqual(parseBR('1.234,56'), 1234.56);
  assert.strictEqual(parseBR('396.000,00'), 396000.00);
  assert.strictEqual(parseBR('543.891,32'), 543891.32);
  assert.strictEqual(parseBR('100'), 100);
});

test('brl formata Number', () => {
  assert.strictEqual(brl(1234.56), 'R$ 1.234,56');
  assert.strictEqual(brl(0), 'R$ 0,00');
  assert.strictEqual(brl(null), '');
});

test('dataOrdenacao ordena corretamente', () => {
  const a = dataOrdenacao('28/03/2024 10:00');
  const b = dataOrdenacao('27/09/2024 10:00');
  assert.ok(a < b);
});

test('sanitize remove especiais', () => {
  assert.strictEqual(sanitize('Edital 4/2025!'), 'Edital_4_2025_');
});

// ─── regex (caso real do PARNA Chapada) ───────────────────────────────────

const SNIPPET_PARNA = `
--- p.21 ---
CAPÍTULO 6 – REMUNERAÇÃO DA B3
HOMOLOGAÇÃO DA LICITAÇÃO E REMUNERAÇÃO DA B3

Publicada a homologação da LICITAÇÃO, será emitido boleto para pagamento da
remuneração devida à B3, de responsabilidade da PARTICIPANTE CREDENCIADA
representante da LICITANTE vencedora, que deverá ser pago em até 15 (quinze)
dias, mas impreterivelmente antes da assinatura do Contrato, na importância
de R$ 396.000,00 (trezentos e noventa e seis mil reais).

A remuneração da B3 será atualizada pela variação positiva do IPCA.
`;

test('extrairRemuneracaoB3 captura padrão canônico (PARNA Chapada)', () => {
  const r = extrairRemuneracaoB3(SNIPPET_PARNA);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].valor, 396000);
  assert.strictEqual(r[0].lote, 'geral');
  assert.strictEqual(r[0].fonte_regex, 'canonico');
});

const SNIPPET_GO_WIFI = `
--- p.23 ---
Nos termos do item 19.2.6 do Edital, após a homologação e adjudicação do objeto
da Licitação, a B3 cobrará o montante referente à sua remuneração, na
importância de R$ 543.891,32 (quinhentos e quarenta e três mil oitocentos e
noventa e um reais e trinta e dois centavos).
`;

test('extrairRemuneracaoB3 captura PPP GO Wifi-7', () => {
  const r = extrairRemuneracaoB3(SNIPPET_GO_WIFI);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].valor, 543891.32);
});

const SNIPPET_MULTI_LOTE = `
--- p.25 ---
Para o Lote 1, a importância de R$ 250.000,00 (duzentos e cinquenta mil reais)
será devida à B3.

--- p.26 ---
Para o Lote 2, a importância de R$ 380.000,00 (trezentos e oitenta mil reais)
será devida à B3.
`;

test('extrairRemuneracaoB3 identifica multi-lote', () => {
  const r = extrairRemuneracaoB3(SNIPPET_MULTI_LOTE);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map(x => x.lote).sort(), ['1', '2']);
});

test('extrairValorGlobal capta valor global', () => {
  const s = 'O valor global do contrato é estimado em R$ 9.200.000.000,00 (nove bilhões).';
  const v = extrairValorGlobal(s);
  assert.strictEqual(v, 9200000000);
});

// ─── âncoras TOC ──────────────────────────────────────────────────────────

const SUMARIO_TIPICO = `
[[P1]]
SUMÁRIO

CAPÍTULO 1 PARTICIPANTES CREDENCIADAS ...................................... 6
CAPÍTULO 2 ENTREGA DOS ENVELOPES ........................................... 7
CAPÍTULO 3 ENVELOPE 1 ..................................................... 9
CAPÍTULO 4 SESSÃO PÚBLICA ................................................ 17
CAPÍTULO 5 HABILITAÇÃO ................................................... 20
CAPÍTULO 6 REMUNERAÇÃO DA B3 ............................................. 23
ANEXO A CONTRATO ......................................................... 24
`;

test('localizarAncoraNoSumario acha capítulo 6', () => {
  const r = localizarAncoraNoSumario(SUMARIO_TIPICO, 50);
  assert.ok(r);
  assert.strictEqual(r.pagina, 23);
  assert.strictEqual(r.ancora, 'capitulo_remuneracao');
});

// ─── categorizer ──────────────────────────────────────────────────────────

test('categorizar identifica manual_b3', () => {
  assert.strictEqual(categorizar('Manual_de_Procedimentos_B3.pdf').categoria, 'manual_b3');
  assert.strictEqual(categorizar('Anexo_VI_Manual_B3.pdf').categoria, 'manual_b3');
});

test('categorizar identifica edital', () => {
  const c = categorizar('edital_001_2025.pdf');
  assert.strictEqual(c.categoria, 'edital');
});

test('categorizar identifica estudo (descartado)', () => {
  assert.strictEqual(categorizar('EVTEA_estudo_viabilidade.pdf').categoria, 'estudo_viabilidade');
});

// ─── sources: bvmf-listing (fixtures offline) ─────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures');
const listingHtml = (() => {
  try { return fs.readFileSync(path.join(FIXTURES, 'bvmf-listing.html'), 'utf8'); }
  catch { return null; }
})();
const detalheHtml = (() => {
  try { return fs.readFileSync(path.join(FIXTURES, 'bvmf-detalhe.html'), 'utf8'); }
  catch { return null; }
})();

test('bvmf-listing extrai >=200 projetos do fixture', () => {
  if (!listingHtml) throw new Error('fixture tests/fixtures/bvmf-listing.html ausente');
  const p = parseListing(listingHtml);
  assert.ok(p.length >= 200, `esperado >=200, veio ${p.length}`);
});

test('bvmf-listing filtra 2024-2025 corretamente', () => {
  if (!listingHtml) throw new Error('fixture ausente');
  const p = parseListing(listingHtml);
  const sub = filtrarPorAno(p, [2024, 2025]);
  assert.ok(sub.length > 0, 'subset 2024-2025 vazio');
  for (const x of sub) assert.ok([2024, 2025].includes(x.ano));
});

test('bvmf-listing acha BNDES - 001/2026 (IdLeilao=10914)', () => {
  if (!listingHtml) throw new Error('fixture ausente');
  const p = parseListing(listingHtml);
  const cagepa = p.find((x) => x.id_leilao === 10914);
  assert.ok(cagepa, 'IdLeilao=10914 nao encontrado');
  assert.match(cagepa.url_detalhe, /IdLeilao=10914/);
});

// ─── regex: novas variantes (diag-revisar 2026-05) ────────────────────────

const { localizarAncoraNoCorpo } = require(path.join(ROOT, 'src/lib/regex'));

test('canonico tolera texto sem espacos (manuais comprimidos)', () => {
  // BVMF_10788 (Sanepar): "naimportânciadeR$684.035,88"
  const s = 'aB3cobraráomontantetotalreferenteàsuaremuneração,naimportânciadeR$684.035,88(seiscentos)';
  const r = extrairRemuneracaoB3(s);
  assert.ok(r.length >= 1, 'esperava 1+ achado');
  assert.strictEqual(r[0].valor, 684035.88);
});

test('variante montante de R$ proxima de B3', () => {
  // BVMF_10804 (ANTT BR-040): "pagamento de remuneração à B3 no montante de R$ 968.548,84"
  const s = 'REMUNERAÇÃO DA B3 Após a homologação certame, a Proponente Vencedora deverá realizar o pagamento de remuneração à B3 no montante de R$ 968.548,84 (novecentos e sessenta e oito mil, quinhentos e quarenta e oito reais e oitenta e quatro centavos), data-base dezembro/2023';
  const r = extrairRemuneracaoB3(s);
  assert.ok(r.length >= 1, 'esperava 1+ achado');
  assert.strictEqual(r[0].valor, 968548.84);
});

test('localizarAncoraNoSumario acha pagina inline (TOC numa linha so)', () => {
  // BVMF_10811 (Palmas TO): TOC sem newlines, paginas inline apos os dots
  const toc = 'SUMÁRIO INTRODUÇÃO....3 CAPÍTULO 1 PARTICIPANTE CREDENCIADAS....5 CAPÍTULO 2 ENVELOPES....7 CAPÍTULO 3 GARANTIA....9 CAPÍTULO 4 SESSÃO....15 CAPÍTULO 5 HABILITAÇÃO....20 CAPÍTULO 6 REMUNERAÇÃO DA B3....27 ANEXO A....30';
  const r = localizarAncoraNoSumario(toc, 32);
  assert.ok(r, 'esperava ancora');
  assert.strictEqual(r.pagina, 27);
});

test('localizarAncoraNoCorpo: header capitulo + remuneracao no corpo', () => {
  // BVMF_10788 (Sanepar): TOC malformatado, header no corpo
  const paginas = [
    'capa', 'sumario truncado', 'introducao', 'p4', 'p5',
    'p6', 'p7 capitulo 1', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14',
    'p15', 'p16', 'p17', 'p18', 'p19', 'p20',
    'CAPÍTULO 6 REMUNERAÇÃO DA B3 HOMOLOGAÇÃO Nos termos do item 27.2.6 do EDITAL, a B3 cobrará o montante total referente à sua remuneração, na importância de R$ 684.035,88'
  ];
  const r = localizarAncoraNoCorpo(paginas);
  assert.ok(r, 'esperava ancora no corpo');
  assert.strictEqual(r.pagina, 21);
  assert.strictEqual(r.ancora, 'corpo_capitulo_remuneracao');
});

test('localizarAncoraNoCorpo: fallback header medio com valor', () => {
  const paginas = ['capa', 'sumario', 'intro', 'p4', 'p5',
    'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15',
    'p16',
    'REMUNERAÇÃO DA B3 a B3 cobrará na importância de R$ 578.060,45'];
  const r = localizarAncoraNoCorpo(paginas);
  assert.ok(r);
  assert.strictEqual(r.pagina, 17);
  assert.strictEqual(r.ancora, 'corpo_remuneracao_com_valor');
});

test('localizarAncoraNoCorpo nao casa quando nao tem secao', () => {
  const paginas = ['capa', 'sumario', 'introducao apenas', 'sem nada'];
  const r = localizarAncoraNoCorpo(paginas);
  assert.strictEqual(r, null);
});

test('bvmf-detalhe extrai url_manual e url_site_projeto', () => {
  if (!detalheHtml) throw new Error('fixture ausente');
  const d = parseDetalhe(detalheHtml,
    'https://bvmf.bmfbovespa.com.br/consulta-leiloes/ResumoLeiloesEspeciaisDetalhe.aspx');
  assert.strictEqual(d.id_leilao, 10914);
  assert.match(d.url_manual, /lum-download\.asp\?CodLeil=10914&CodLeilSubt=2/);
  assert.ok(d.url_site_projeto.startsWith('http'));
});

// ─── status filter: DESERTO/SUSPENSO/CANCELADO/REVOGADO ────────────────────

test('bvmf-listing extrai status_b3 do prefixo do titulo', () => {
  if (!listingHtml) throw new Error('fixture ausente');
  const p = parseListing(listingHtml);
  const statusValues = new Set(p.map((x) => x.status_b3));
  assert.ok(statusValues.has('ATIVO'), 'esperado pelo menos um ATIVO');
  assert.ok(statusValues.has('DESERTO') || statusValues.has('SUSPENSO') || statusValues.has('CANCELADO'),
    'esperado pelo menos um nao-ativo no fixture');
});

test('bvmf-listing limpa prefixo de status do titulo', () => {
  if (!listingHtml) throw new Error('fixture ausente');
  const p = parseListing(listingHtml);
  const cancelado = p.find((x) => x.status_b3 === 'CANCELADO');
  if (cancelado) {
    assert.ok(!/^CANCELADO\s*-/i.test(cancelado.titulo), 'titulo deveria nao comecar com CANCELADO');
    assert.match(cancelado.titulo_original, /^CANCELADO\s*-/i);
  }
});

test('filtrarAtivos remove desertos/suspensos/cancelados/revogados', () => {
  if (!listingHtml) throw new Error('fixture ausente');
  const todos = parseListing(listingHtml);
  const ativos = filtrarAtivos(todos);
  assert.ok(ativos.length < todos.length, 'esperava remover algo');
  for (const a of ativos) assert.strictEqual(a.status_b3, 'ATIVO');
  console.log(`    -> filtrou ${todos.length - ativos.length} inativos de ${todos.length} (sobraram ${ativos.length})`);
});

// ─── report: multi-lote ─────────────────────────────────────────────────────

test('report mantem nome original quando lote unico', () => {
  const resultados = [{
    titulo: 'PARNA Chapada', data: '15/05/2024', ano: 2024,
    valor_global: null, valores: [{ valor: 396000, lote: 'geral', pagina_pdf: 23 }],
    status: 'auto',
  }];
  const linhas = montarLinhas(resultados);
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0]['Nome do projeto'], 'PARNA Chapada');
});

test('report expande multi-lote em linhas com sufixo " - Lote N"', () => {
  const resultados = [{
    titulo: 'PPP Rodovia X', data: '10/06/2024', ano: 2024,
    valor_global: null,
    valores: [
      { valor: 250000, lote: '1', pagina_pdf: 25 },
      { valor: 380000, lote: '2', pagina_pdf: 26 },
      { valor: 420000, lote: '3', pagina_pdf: 27 },
    ],
    status: 'auto',
  }];
  const linhas = montarLinhas(resultados);
  assert.strictEqual(linhas.length, 3);
  assert.strictEqual(linhas[0]['Nome do projeto'], 'PPP Rodovia X - Lote 1');
  assert.strictEqual(linhas[1]['Nome do projeto'], 'PPP Rodovia X - Lote 2');
  assert.strictEqual(linhas[2]['Nome do projeto'], 'PPP Rodovia X - Lote 3');
  assert.strictEqual(linhas[0]['Valor de remuneração da B3'], 'R$ 250.000,00');
  assert.strictEqual(linhas[2]['Lote'], '3');
});

test('report nao adiciona sufixo se lotes sao "geral"', () => {
  const resultados = [{
    titulo: 'Projeto Y', data: '01/01/2024', ano: 2024,
    valor_global: null,
    valores: [
      { valor: 100000, lote: 'geral', pagina_pdf: 10 },
      { valor: 200000, lote: 'geral', pagina_pdf: 11 },
    ],
    status: 'auto',
  }];
  const linhas = montarLinhas(resultados);
  assert.strictEqual(linhas.length, 2);
  assert.strictEqual(linhas[0]['Nome do projeto'], 'Projeto Y');
  assert.strictEqual(linhas[1]['Nome do projeto'], 'Projeto Y');
});

// ─── novas variantes de remuneração B3 (diag-financeiro 2018-2026) ──────────

test('variante "remuneracao da B3 devida pela X é R$" (BVMF_10113, 10565, 10568, 10586)', () => {
  const s = 'REMUNERAÇÃO DA B3 Após a homologação, a B3 cobra o montante referente à sua remuneração. A remuneração da B3 devida pela PROPONENTE VENCEDORA é R$ 566.134,39 (quinhentos e sessenta e seis mil, cento e trinta e quatro Reais e trinta e nova centavos). Após';
  const r = extrairRemuneracaoB3(s);
  assert.ok(r.length >= 1, 'esperava 1+ achado');
  assert.strictEqual(r[0].valor, 566134.39);
});

test('variante "remuneracao da B3 ... de cada BLOCO é de R$" (BVMF_10571 multi-bloco)', () => {
  const s = 'REMUNERAÇÃO DA B3 Conforme item 16.5, inciso (ix), do EDITAL, após a homologação, a B3 cobra o montante referente à sua remuneração. A remuneração da B3 devida pela LICITANTE VENCEDORA de cada BLOCO é de R$ 137.479,41 (cento e trinta e sete mil)';
  const r = extrairRemuneracaoB3(s);
  assert.ok(r.length >= 1, 'esperava 1+ achado');
  assert.strictEqual(r[0].valor, 137479.41);
});

test('variante "consistira nos seguintes valores R$" (BVMF_10564)', () => {
  const s = '19 REMUNERAÇÃO DA B3 A remuneração da B3 consistirá nos seguintes valores: R$ 1.082.783,45 (um milhão, oitenta e dois mil, setecentos e oitenta e três reais e quarenta e cinco centavos)';
  const r = extrairRemuneracaoB3(s);
  assert.ok(r.length >= 1, 'esperava 1+ achado');
  assert.strictEqual(r[0].valor, 1082783.45);
});

test('nao captura "montante de indenizacao" de garantia (BVMF_10523, 10559, 10574)', () => {
  // Falso-positivo a evitar: garantia de seguro tem "montante de indenizacao" sem B3
  const s = 'A Apólice de Seguro-garantia deverá prever o montante de indenização de R$ 14.238.980,00 (catorze milhões, duzentos e trinta e oito mil, novecentos e oitenta reais).';
  const r = extrairRemuneracaoB3(s);
  assert.strictEqual(r.length, 0, 'nao deveria capturar montante de garantia');
});

test('nao captura "Carta de Fianca no montante de R$" (BVMF_10523, 10574 garantia)', () => {
  const s = 'autorizado pelo Banco Central do Brasil a expedir Cartas de Fiança, e que o valor da presente Carta de Fiança, no montante de R$ 16.991.996,20 (dezesseis milhões), encontra-se dentro';
  const r = extrairRemuneracaoB3(s);
  assert.strictEqual(r.length, 0, 'nao deveria capturar montante de garantia');
});

test('localizarAncoraNoCorpo casa "REMUNERAÇÃO DA B3" sem CAPÍTULO N (BVMF_10113, 10564)', () => {
  // BVMF_10113: TOC tem "REMUNERAÇÃO DA B3 20" sem capítulo; conteúdo na p20.
  const paginas = ['capa', 'sumario', 'intro', 'p4', 'p5',
    'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14',
    'p15', 'p16', 'p17', 'p18',
    'REMUNERAÇÃO DA B3 Após a homologação, a B3 cobra o montante referente à sua remuneração. A remuneração da B3 devida pela PROPONENTE VENCEDORA é R$ 566.134,39'];
  const r = localizarAncoraNoCorpo(paginas);
  assert.ok(r, 'esperava ancora no corpo');
  assert.strictEqual(r.pagina, 19);
});

// ─── runner ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
console.log('\n▶ Rodando testes...\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${t.name}\n    ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass} passou, ${fail} falhou (${tests.length} total)`);
process.exit(fail > 0 ? 1 : 0);
