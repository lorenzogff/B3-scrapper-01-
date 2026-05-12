/**
 * src/lib/report.js
 * Fase 4 — Consolidação em planilha Excel.
 */

const XLSX = require('xlsx');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('./logger');
const { brl, dataOrdenacao } = require('./utils');

function montarLinhas(resultados) {
  const linhas = [];
  for (const r of resultados) {
    const base = {
      'Nome do projeto': r.titulo || '',
      'Data': r.data || '',
      'Valor global do contrato de concessão ou PPP':
        r.valor_global != null ? brl(r.valor_global) : '',
      'Valor de remuneração da B3': '',
      'Lote': '',
      'Status': r.status || '',
      'Página PDF': '',
      'Âncora': r.ancora || '',
      'Fonte / Observação': r.fonte_observacao || r.pdf_processado || r.erro || '',
    };

    if (!r.valores || r.valores.length === 0) {
      linhas.push(base);
    } else {
      for (const v of r.valores) {
        linhas.push({
          ...base,
          'Valor de remuneração da B3': brl(v.valor),
          'Lote': v.lote || 'geral',
          'Página PDF': v.pagina_pdf || r.pagina_alvo || '',
        });
      }
    }
  }
  linhas.sort((a, b) => dataOrdenacao(a.Data) - dataOrdenacao(b.Data));
  return linhas;
}

async function gerar(resultados, cfg) {
  logger.info('Fase 4 — Gerando planilha consolidada');
  await fs.ensureDir(cfg.outputDir);
  const linhas = montarLinhas(resultados);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws['!cols'] = [
    { wch: 60 }, { wch: 20 }, { wch: 32 }, { wch: 22 },
    { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 60 },
  ];
  if (linhas.length > 0) ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, 'Remuneração B3');

  const ini = cfg.anos[0];
  const fim = cfg.anos[cfg.anos.length - 1];
  const nome = `consolidado_b3_${ini}_${fim}.xlsx`;
  const out = path.join(cfg.outputDir, nome);
  XLSX.writeFile(wb, out);
  logger.ok(`Planilha gerada: ${path.relative(cfg.root, out)} (${linhas.length} linhas)`);

  return out;
}

function resumo(resultados) {
  const contagem = {
    auto: 0,
    seed_verificado: 0,
    manual_revisar: 0,
    sem_pdf: 0,
    erro: 0,
  };
  for (const r of resultados) {
    contagem[r.status] = (contagem[r.status] || 0) + 1;
  }
  const total = resultados.length;
  const ok = contagem.auto + contagem.seed_verificado;
  return { contagem, total, taxa_auto: total ? (ok / total) : 0 };
}

module.exports = { gerar, resumo, montarLinhas };
