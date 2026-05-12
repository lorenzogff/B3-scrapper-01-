# 🚀 Guia de Deploy: GitHub + Claude Code

## 1. Subir o repositório para o GitHub

### Opção A — Pelo navegador (mais fácil)

1. Baixe `b3-scraper.zip` e descompacte localmente.
2. Acesse https://github.com/new e crie um repositório (ex: `b3-scraper`). **Não** marque "Initialize with README".
3. No GitHub, clique em "uploading an existing file" e arraste **todos os arquivos** da pasta `b3-scraper-repo/` (não a pasta, os arquivos dentro dela).
4. Commit message: `Initial commit`
5. Pronto.

### Opção B — Pelo terminal (Git CLI)

```bash
# Na pasta b3-scraper-repo descompactada
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/b3-scraper.git
git push -u origin main
```

## 2. Conectar ao Claude Code

Você disse que já iniciou o Claude Code com a conta GitHub — ótimo. No prompt do Claude Code:

```
Clone https://github.com/SEU_USUARIO/b3-scraper.git e execute 
o pipeline completo seguindo as instruções em CLAUDE.md. 
Respeite o limite de 50.000 tokens. Confie no regex.
```

O Claude Code:

1. Clona o repo
2. Lê `CLAUDE.md` (que tem as instruções específicas para ele)
3. Roda `node scripts/bootstrap.js`
4. Executa as 4 fases sequencialmente
5. Te entrega o relatório final no formato definido

## 3. Estrutura do que ele vai fazer

```
git clone ...                       (10 segundos)
node scripts/bootstrap.js           (~3 min — instala deps + chromium)
npm run discover -- --anos 2024 2025  (~3 min — lista projetos B3)
npm run download -- --anos 2024 2025  (20-40 min — baixa PDFs relevantes)
npm run extract -- --anos 2024 2025   (10-20 min — regex extrai valores)
npm run report -- --anos 2024 2025    (<1 min — gera XLSX)
```

Total: ~45-60 min.

## 4. Resultado esperado

`output/consolidado_b3_2024_2025.xlsx` — planilha aba única, ordenada por data, com:

| Coluna | Conteúdo |
|---|---|
| Nome do projeto | Título completo do edital |
| Data | Data do leilão |
| Valor global do contrato de concessão ou PPP | Capex + Opex |
| Valor de remuneração da B3 | Extraído via regex |
| Lote | `1`, `2`, ... ou `geral` |
| Status | `auto` / `seed_verificado` / `manual_revisar` / `sem_pdf` |
| Página PDF | Página onde o valor foi encontrado |
| Âncora | Padrão de TOC que casou |
| Fonte / Observação | PDF processado |

## 5. Orçamento de tokens

O `CLAUDE.md` no root do repo já tem todas as restrições:

- ✅ Confie no regex (~85% dos casos resolvem sem LLM)
- ❌ Não leia PDFs, snippets, manifesto inteiro
- ❌ Não revise projeto por projeto
- ✅ Reporte só agregados

Orçamento estimado: ~30-40k tokens em execução normal, ~50k se houver retries.

## 6. Atualizar regex sem rebaixar PDFs

Se a taxa de `auto` ficar abaixo de 75%, você pode:

1. Abrir `cache/snippets/<id_problema>.txt` (escolha 3-5 amostras)
2. Identificar variantes de redação que o regex não pegou
3. Adicionar padrão em `src/lib/regex.js`
4. Rodar só `npm run extract` (não precisa rebaixar)
5. `git commit` e `git push`

O Claude Code pode fazer isso, desde que você diga explicitamente: "examine cache/snippets/X.txt e proponha um novo regex".

## 7. CI no GitHub

O repo já tem `.github/workflows/ci.yml` configurado. A cada push ele roda:

- `npm install` (instala deps)
- `npm run lint` (valida sintaxe de todos os JS)
- `npm test` (12 testes unitários sem rede)

Você vê o status na aba "Actions" do GitHub.

## 8. Como sei que está funcionando?

Os 12 testes unitários cobrem:

- ✅ Parsing de valores BR (`R$ 1.234,56` → `1234.56`)
- ✅ Formatação BR (`1234.56` → `R$ 1.234,56`)
- ✅ Ordenação por data
- ✅ Sanitização de nomes
- ✅ Regex canônico (caso PARNA Chapada, valor confirmado R$ 396.000)
- ✅ Regex canônico (caso GO Wifi-7, valor confirmado R$ 543.891,32)
- ✅ Identificação de multi-lote (Lote 1 vs Lote 2 com valores distintos)
- ✅ Extração de valor global do contrato
- ✅ Localização de âncora no sumário
- ✅ Categorização de PDFs (manual_b3, edital, evtea descartado)

Todos passam. Se você fizer um PR mudando o regex e algum quebrar, o CI bloqueia o merge.

## 9. Troubleshooting rápido

| Problema | Solução |
|---|---|
| Bootstrap falha em "playwright install" | Antivírus; veja `docs/TROUBLESHOOTING.md` |
| Discover retorna 0 | Firewall bloqueia B3; libere ou rode em outra rede |
| Download lento | `npm run download -- --concorrencia 5` |
| `manual_revisar > 25%` | Inspecione snippets, adicione regex |
| Caiu no meio | `npm run download -- --retomar` |

Documentação completa em `docs/TROUBLESHOOTING.md`.
