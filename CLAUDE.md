# CLAUDE.md — Instruções para Claude Code

Você está em um repositório de mineração de editais B3. **Os scripts já estão escritos** — sua função é orquestrar a execução, não reescrever código.

## 🚨 Restrição de tokens: 50.000 máximo

- ✅ **Confie no regex.** `src/lib/regex.js` resolve ~85% dos casos sem LLM.
- ❌ **NÃO leia PDFs com sua ferramenta de leitura.** Eles podem ter 200+ páginas. Os scripts já fazem leitura otimizada.
- ❌ **NÃO leia `node_modules/`.** Nunca.
- ❌ **NÃO leia `cache/snippets/*.txt`** a não ser que o usuário peça.
- ❌ **NÃO leia `cache/download_manifest.json` inteiro.** Use `jq` para contagens.
- ❌ **NÃO inspecione cada um dos ~140 projetos.** Olhe agregados.
- ❌ **NÃO reescreva regex ou scripts.** Se algo falha estrutural, reporte ao usuário.
- ✅ **Use `head`, `tail`, `wc`, `jq`** ao inspecionar arquivos. Nunca `cat` em arquivo > 100 linhas.

## 🪜 Sequência de execução

Rode na ordem. Após cada comando, valide com a verificação indicada. Se falhar, **pare e reporte** — não tente consertar.

### Etapa 1 — Setup

```bash
node scripts/bootstrap.js
```

**Valida:** mostra "Setup concluído" ao final. Caso contrário, pare.

### Etapa 2 — Dry-run (descoberta + listagem sem baixar)

```bash
npm run discover -- --anos 2024 2025
```

**Valida:** `cache/projetos.json` existe e tem `>= 100` projetos. Verifique:

```bash
jq 'length' cache/projetos.json
```

- `>= 100`: ✅ siga
- `20-99`: ⚠️ siga reportando
- `< 20`: 🛑 pare

### Etapa 3 — Download

```bash
npm run download -- --anos 2024 2025
```

**Valida:** o resumo no terminal mostra "Bem-sucedidos: N". Verifique cache:

```bash
ls cache/pdfs | wc -l
du -sh cache/pdfs
```

Esperado: ~70% do total descoberto com pasta criada. Cache 1-4 GB.

### Etapa 4 — Extração (regex, sem LLM)

```bash
npm run extract -- --anos 2024 2025
```

**Valida:** resumo mostra taxa auto ≥ 75%. Caso contrário, reporte ao usuário — **não ajuste regex sozinho**.

### Etapa 5 — Planilha final

```bash
npm run report -- --anos 2024 2025
```

**Valida:**

```bash
ls -lh output/
```

Deve existir `consolidado_b3_2024_2025.xlsx` com tamanho > 10 KB.

## 📋 Relatório final ao usuário

Após Etapa 5, mostre **apenas isto** (não logs, não conteúdo PDF, não detalhes por projeto):

```
✅ Execução concluída em NN min

📁 Arquivo: <caminho absoluto>
📊 Total: NN projetos
   ├── auto:             NN (NN%)
   ├── seed_verificado:  NN
   ├── manual_revisar:   NN
   └── sem_pdf:          NN

💾 Cache: NN GB em NN PDFs

🔍 Top 5 manual_revisar:
   1. <ID>
   2. <ID>
   ...

⚙️ Tokens consumidos: ~XX.XXX
```

## 🆘 Se algo der errado

| Situação | Ação |
|---|---|
| Bootstrap falha | Reporte; pode ser proxy/firewall |
| Discover retorna 0 projetos | Reporte; b3.com.br bloqueado |
| Download falha em > 30% | Tente `npm run download -- --concorrencia 1` 1x; se persistir, reporte |
| Extract tem `manual_revisar` > 50% | Pare e reporte; NÃO mexa em `src/lib/regex.js` |
| Erro inesperado | Capture últimas 30 linhas, mostre ao usuário, pare |

## 🎯 Atalho: pipeline completo

Se o usuário pedir "rode tudo":

```bash
node scripts/bootstrap.js
npm run full -- --anos 2024 2025
```

`full` executa as 4 fases em sequência. Resumo final aparece automaticamente.
