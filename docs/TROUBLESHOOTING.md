# 🐛 Troubleshooting

## Erros de instalação

### `npm install` falha com EACCES / EPERM (Windows)

Execute o PowerShell como **Administrador** e rode novamente. Se persistir:

```powershell
npm cache clean --force
Remove-Item -Recurse -Force node_modules
npm install
```

### `npm install` falha em rede corporativa (timeout / ETIMEDOUT)

Configure o proxy:

```powershell
npm config set proxy http://proxy.empresa.com:8080
npm config set https-proxy http://proxy.empresa.com:8080
```

Peça os dados ao seu time de TI.

### `npx playwright install chromium` falha no download

O Chromium é baixado de `playwright.azureedge.net`. Antivírus corporativo pode bloquear.

**Tentativa 1** — força re-download:

```powershell
npx playwright install chromium --force
```

**Tentativa 2** — instala com dependências de sistema:

```powershell
npx playwright install --with-deps chromium
```

**Tentativa 3** — peça liberação ao TI dos domínios:
- `playwright.azureedge.net`
- `playwrightaccessibility.dev`

## Erros de execução

### `discover` retorna 0 projetos

Significa que a B3 está inacessível ou mudou estrutura.

**Teste manual:**

```powershell
curl https://sistemasweb.b3.com.br/Leiloes/ConsultarLeilao/Index
```

- Se voltar HTML normal → problema no parser; reporte como issue.
- Se voltar erro → firewall bloqueando b3.com.br. Peça liberação.

### `download` com `--dry-run` lista projetos mas `download` real falha

Provavelmente alguns sites de órgãos licitantes (ANTT, secretarias estaduais) estão lentos ou bloqueados.

```powershell
# Tente com menos paralelismo (default 3 → 1)
npm run download -- --concorrencia 1
```

### Todos os projetos saem como `manual_revisar`

O regex não está casando. Inspecione um snippet:

```powershell
type cache\snippets\BVMF_001_2024.txt
```

Se o valor de remuneração estiver visível mas o regex não pegou, é provavelmente uma variante de redação. Adicione padrão em `src/lib/regex.js`:

```javascript
// Em RE_VALOR_REMUN, adicione variante:
const RE_VALOR_REMUN_VARIANTE = /seu_padrao_aqui[^.]{0,200}?R\$\s*([\d.,]+)/gi;
```

E inclua na lista `padroes` de `extrairRemuneracaoB3`.

### `PDFs corrompidos` ou `pdf-parse falhou`

Alguns sites devolvem HTML de erro com extensão `.pdf` (caso raro).

```powershell
# Apague o PDF problemático e re-tente
Remove-Item cache\pdfs\<id>\arquivo.pdf
npm run download -- --retomar
```

### Caiu a internet no meio

Use `--retomar`:

```powershell
npm run download -- --retomar
npm run extract                 # extração não usa rede
```

## Erros do Playwright

### `Error: browserType.launch: Executable doesn't exist`

Chromium não foi baixado. Rode:

```powershell
npx playwright install chromium
```

### `Error: Timeout 60000ms exceeded` em alguns projetos

Site do órgão licitante está lento. Aumente timeout:

```powershell
# Via env var
$env:B3_NAV_TIMEOUT = "120000"
npm run download
```

## Limpando cache

```powershell
# Limpa cache mantendo node_modules
npm run clean

# Limpa tudo (precisa rodar bootstrap de novo)
npm run clean
Remove-Item -Recurse -Force node_modules
npm install
```

## Debug detalhado

Ative variáveis de ambiente para ver o que está acontecendo:

```powershell
$env:DEBUG = "1"
$env:PWDEBUG = "1"    # debug do Playwright
npm run discover
```

## Onde pedir ajuda

Se nada acima resolveu, abra uma issue no GitHub com:

1. Comando exato executado
2. Saída completa (use `npm run <cmd> 2>&1 | Tee-Object log.txt`)
3. Versão do Node (`node --version`) e SO
4. Conteúdo de `cache/projetos.json` (se a Fase 1 funcionou)
