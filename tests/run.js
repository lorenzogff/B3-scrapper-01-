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
const { parseListing, filtrarPorAno } = require(path.join(ROOT, 'src/lib/sources/bvmf-listing'));
const { parseDetalhe } = require(path.join(ROOT, 'src/lib/sources/bvmf-detalhe'));

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
  assert.strictEqual(r.ancora, 'capitulo_6');
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

test('bvmf-detalhe extrai url_manual e url_site_projeto', () => {
  if (!detalheHtml) throw new Error('fixture ausente');
  const d = parseDetalhe(detalheHtml,
    'https://bvmf.bmfbovespa.com.br/consulta-leiloes/ResumoLeiloesEspeciaisDetalhe.aspx');
  assert.strictEqual(d.id_leilao, 10914);
  assert.match(d.url_manual, /lum-download\.asp\?CodLeil=10914&CodLeilSubt=2/);
  assert.ok(d.url_site_projeto.startsWith('http'));
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
