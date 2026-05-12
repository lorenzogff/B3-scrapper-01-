# 📐 Metodologia — Estratégia Regex-First

## Por que regex-first?

A alternativa seria mandar PDFs inteiros para um LLM. Comparação:

| Métrica | LLM (PDF inteiro) | Regex-first (este projeto) |
|---|---:|---:|
| Tokens por PDF | ~100.000 | 0 (zero) |
| Custo (Claude Haiku, 140 projetos) | ~$15 USD | $0 |
| Tempo por PDF | 8-20 segundos | 0.5-2 segundos |
| Determinismo | Não (LLM varia) | 100% reproduzível |
| Auditoria | Difícil | Trivial (snippet salvo) |

## Pipeline em 4 fases

```
┌─────────────────────────────────────────────────────────────┐
│ Fase 1: DESCOBERTA   (Playwright + Cheerio)                 │
│   sistemasweb.b3 + bvmf.bmfbovespa → projetos.json          │
│                                                              │
│ Fase 2: DOWNLOAD     (Axios + cache + dedup)                │
│   Categoriza PDFs por nome, baixa só relevantes             │
│   → cache/pdfs/<id>/<categoria>__<nome>.pdf                 │
│                                                              │
│ Fase 3: EXTRAÇÃO     (pdf-parse + regex)                    │
│   Para cada PDF baixado:                                    │
│     1. Lê SÓ as 7 primeiras páginas (sumário)              │
│     2. Procura âncora "REMUNERAÇÃO B3" no sumário          │
│     3. Pega número da página alvo                           │
│     4. Lê SÓ 3 páginas em torno do alvo                    │
│     5. Aplica regex "importância de R$ X.XXX,XX"           │
│                                                              │
│ Fase 4: RELATÓRIO    (XLSX)                                 │
│   Consolida em planilha ordenada por data                   │
└─────────────────────────────────────────────────────────────┘
```

## Por que o sumário-first funciona

Editais e Manuais de Procedimentos B3 seguem um padrão estável:

- 7 primeiras páginas: capa + sumário com referências de página
- Sumário tem linhas como: `CAPÍTULO 6 REMUNERAÇÃO DA B3 .......... 23`
- O parser pega `23` e vai direto para essa página

Resultado: em vez de ler 200 páginas (~100k tokens se fosse para LLM), lemos:
- 7 páginas (sumário) + 3 páginas (alvo) = **10 páginas**

## Regex de extração

Em `src/lib/regex.js`, organizadas por prioridade:

### Padrão canônico (resolve ~85% dos casos)

```regex
import[âa]ncia\s+de\s+R\$\s*([\d.,]+)(?:\s*\(([^)]{5,250})\))?
```

Casa exatamente o padrão usado nos Manuais B3:

> "...na **importância de R$ 396.000,00** (trezentos e noventa e seis mil reais)."

### Variantes (fallback)

```regex
remunera(ção|cao)\s+(devida\s+)?(à\s+)?B3[^.]{0,200}?R\$\s*([\d.,]+)
reembolso\s+(à\s+)?B3[^.]{0,200}?R\$\s*([\d.,]+)
taxa\s+de\s+adesão[^.]{0,200}?R\$\s*([\d.,]+)
```

Estas só ativam se o canônico não casar, e exigem a string "B3" no contexto próximo.

### Identificação de lote

```regex
\blote\s+(\d+|[IVX]+|[A-Z])\b
```

Aplicado nos 300 caracteres antes do valor. Permite separar leilões multi-lote em linhas distintas.

## Filtros de qualidade

Para evitar falsos positivos, valores extraídos passam por:

1. **Range**: `1000 ≤ valor ≤ 50.000.000` (descarta valores absurdos)
2. **Contexto B3**: variantes (não-canônico) exigem palavra "B3" próxima
3. **Dedup local**: mesmo valor encontrado a < 50 chars de distância é tratado como duplicata
4. **Página identificada**: cada valor sai com o nº da página onde foi achado (auditoria)

## Status dos resultados

| Status | Significado |
|---|---|
| `auto` | Regex extraiu com sucesso |
| `seed_verificado` | Veio do `seed_verificados.json` (já apurado manualmente) |
| `manual_revisar` | Não casou regex; snippet salvo em `cache/snippets/<id>.txt` |
| `sem_pdf` | PDFs não puderam ser baixados |
| `erro` | Falha estrutural (PDF corrompido, etc.) |

## O que fazer com `manual_revisar`

Abra o snippet salvo:

```bash
cat cache/snippets/BVMF_001_2024.txt
```

Se o valor estiver visível mas o regex não pegou, adicione uma variante em `src/lib/regex.js` e rode `npm run extract` de novo (com cache de download intacto, é rápido).

## Atualizando regex sem rebaixar PDFs

```bash
# Edite src/lib/regex.js
npm run extract        # roda Fase 3 de novo (Fase 2 fica em cache)
npm run report         # gera nova planilha
```

Os PDFs em `cache/pdfs/` não são tocados. Só os arquivos em `cache/resultados/` e a planilha em `output/`.
