# 📊 B3 Scraper

> Mineração automatizada de editais públicos da B3 — extração de **valor global do contrato** e **remuneração da B3** dos leilões de concessão e PPP.

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## ✨ Funcionalidades

- 🔍 **Descoberta automática**: combina duas fontes oficiais da B3 (sistema legado + página bvmf) para listar leilões de qualquer ano.
- 📥 **Download inteligente**: baixa apenas os PDFs relevantes (Manual de Procedimentos B3, Edital, Anexos contratuais), descartando estudos de viabilidade, planilhas e mapas.
- ⚡ **Extração regex-first**: lê apenas o sumário (7 primeiras páginas) + 3 páginas-alvo de cada PDF. **Zero chamadas de LLM**.
- 🎯 **Multi-lote**: identifica remuneração por lote quando o edital divide.
- 💾 **Cache + resume**: deduplicação SHA-1, checkpoint resumable, retry exponencial.
- 📋 **Saída**: planilha XLSX ordenada por data com nome, data, valor global e remuneração B3.

## 🚀 Quick start

```bash
git clone https://github.com/<seu-user>/b3-scraper.git
cd b3-scraper
node scripts/bootstrap.js          # instala tudo
npm run full                        # pipeline completo (2024-2025)
```

Resultado em `output/consolidado_b3_2024_2025.xlsx`.

## 📦 Pré-requisitos

- **Node.js 18+** ([download](https://nodejs.org/))
- **5 GB de disco** (cache de PDFs ~2-4 GB)
- **Acesso à internet** sem bloqueio aos domínios da B3 e órgãos licitantes
- ⚠️ Não roda no claude.ai (sandbox bloqueia b3.com.br). Use **Claude Code local** ou seu próprio terminal.

## 📂 Estrutura

```
b3-scraper/
├── src/
│   ├── cli.js                  # entrada CLI (yargs)
│   ├── data/
│   │   └── seed_verificados.json  # 5 valores já confirmados
│   └── lib/
│       ├── config.js           # configuração (env + flags)
│       ├── logger.js           # log com cores
│       ├── utils.js            # parseBR, brl, hash, sleep
│       ├── regex.js            # 🎯 regex de extração (isolado)
│       ├── categorizer.js      # classifica PDFs por nome
│       ├── pdf.js              # leitura sumário-first
│       ├── http.js             # Playwright + Axios + retry
│       ├── discover.js         # Fase 1: descoberta
│       ├── download.js         # Fase 2: download
│       ├── extract.js          # Fase 3: extração
│       └── report.js           # Fase 4: XLSX
├── scripts/
│   ├── bootstrap.js            # setup completo
│   └── clean.js                # limpar cache
├── tests/
│   └── run.js                  # testes (sem rede)
├── .github/workflows/
│   └── ci.yml                  # CI: lint + testes
├── docs/
│   ├── METHODOLOGY.md          # estratégia regex-first
│   └── TROUBLESHOOTING.md      # problemas comuns
├── package.json
├── .env.example
└── README.md
```

## 🎮 Comandos

```bash
# Pipeline completo (recomendado)
npm run full -- --anos 2024 2025

# Ou cada fase isoladamente
npm run discover -- --anos 2024 2025         # Fase 1
npm run download -- --dry-run                # Fase 2 (sem baixar)
npm run download                              # Fase 2 (real)
npm run extract                               # Fase 3 (regex)
npm run report                                # Fase 4 (XLSX)

# Testes (sem rede)
npm test

# Limpar cache
npm run clean
```

## 🔧 Configuração

Via flags ou `.env`:

```bash
# Flags
node src/cli.js full --anos 2024 2025 --batch-size 5 --concorrencia 3

# Ou .env (copie .env.example)
B3_ANOS=2024,2025
B3_CONCURRENCY=3
B3_BATCH_SIZE=5
```

## 📊 Saída esperada

`output/consolidado_b3_<inicio>_<fim>.xlsx` com 9 colunas:

| Coluna | Conteúdo |
|---|---|
| Nome do projeto | Título do edital |
| Data | Data do leilão |
| Valor global do contrato de concessão ou PPP | Capex + Opex |
| Valor de remuneração da B3 | Extraído via regex |
| Lote | `1`, `2`, ... ou `geral` |
| Status | `auto` / `seed_verificado` / `manual_revisar` / `sem_pdf` |
| Página PDF | Página onde o valor foi encontrado |
| Âncora | Qual âncora do sumário casou |
| Fonte / Observação | Nome do PDF processado |

## 🧠 Como funciona (estratégia regex-first)

```
1. Lê APENAS as primeiras 7 páginas do PDF (sumário)
2. Procura âncora: "Obrigações Prévias", "CAPÍTULO 6 — REMUNERAÇÃO", etc.
3. Extrai número da página alvo do sumário
4. Lê APENAS 3 páginas em torno do alvo
5. Aplica regex "importância de R$ X.XXX,XX" no snippet
6. Identifica lote no contexto (300 chars antes do match)
```

Por que isso é eficiente:

- 200+ páginas → 5-10 páginas processadas (95% redução)
- Zero tokens de LLM por projeto (regex é local)
- Resolve ~85% dos editais automaticamente; resto vai para `manual_revisar` com snippet salvo para revisão humana

Detalhes em [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## 🐛 Problemas comuns

Ver [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md). Resumão:

| Sintoma | Solução |
|---|---|
| `host_not_allowed` em curl/Playwright | Você está no claude.ai — não funciona aí, rode localmente |
| `npm install` falha | Verifique proxy corporativo (`.env.example`) |
| Chromium não baixa | Antivírus bloqueando; tente `--with-deps` |
| Dry-run retorna 0 projetos | Firewall bloqueando b3.com.br |
| Todos vão pra `manual_revisar` | Regex pode precisar ajuste; ver `src/lib/regex.js` |

## 🧪 Testes

```bash
npm test
```

Testes não usam rede — validam apenas regex, parsers e categorização. 12 testes, todos passam offline.

## 📜 Licença

MIT. Use à vontade. PRs bem-vindos.

## ⚠️ Disclaimer

Este projeto extrai dados de editais públicos. Respeite o `robots.txt` da B3 e dos órgãos licitantes. O scraper já inclui delays entre requisições; não rode em paralelo massivo. Os valores extraídos são para análise — sempre confira o edital original antes de usar em decisões críticas.
