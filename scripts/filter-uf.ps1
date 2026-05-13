# scripts/filter-uf.ps1
# Conta e lista projetos por UF (estado) e seus municipios principais.
# Funciona em cima de cache/projetos.json (gerado pelo discover).
#
# Uso:
#   .\scripts\filter-uf.ps1 RJ
#   .\scripts\filter-uf.ps1 SP -ExportCsv
#
# Saida:
#   - Stdout: contagem total + lista cronologica + breakdown por ano
#   - Opcional: cache/projetos_<uf>.csv

param(
  [Parameter(Mandatory=$true)][string]$Uf,
  [switch]$ExportCsv
)

# Municipios principais por UF (com >= 50k hab ou historico de leilao B3).
# Cobre estado + municipios que aparecem nos editais. Acentos opcionais
# via classe de caracteres no regex.
$municipios = @{
  'RJ' = @(
    'RIO DE JANEIRO','NITER[OÓ]I','S[AÃ]O GON[CÇ]ALO','DUQUE DE CAXIAS',
    'NOVA IGUA[CÇ]U','BELFORD ROXO','CAMPOS DOS GOYTACAZES','S[AÃ]O JO[AÃ]O DE MERITI',
    'PETR[OÓ]POLIS','VOLTA REDONDA','MAG[EÉ]','MACA[EÉ]','ITABORA[IÍ]',
    'MESQUITA','NOVA FRIBURGO','BARRA MANSA','ANGRA DOS REIS','TERES[OÓ]POLIS',
    'NIL[OÓ]POLIS','RESENDE','MARIC[AÁ]','QUEIMADOS','RIO DAS OSTRAS',
    'CABO FRIO','ITAPERUNA','ARARUAMA','ITAGUA[IÍ]','SAQUAREMA',
    'B[UÚ]ZIOS','ARMA[CÇ][AÃ]O DOS B[UÚ]ZIOS','PARACAMBI','PARATY',
    'S[AÃ]O PEDRO DA ALDEIA','TR[EÊ]S RIOS','VALEN[CÇ]A','PIRA[IÍ]'
  )
  'SP' = @(
    'S[AÃ]O PAULO','GUARULHOS','CAMPINAS','S[AÃ]O BERNARDO','SANTO ANDR[EÉ]',
    'OSASCO','S[AÃ]O JOS[EÉ] DOS CAMPOS','RIBEIR[AÃ]O PRETO','SOROCABA','MAU[AÁ]',
    'S[AÃ]O JOS[EÉ] DO RIO PRETO','MOG[IÍ] DAS CRUZES','SANTOS','DIADEMA','JUNDIA[IÍ]',
    'CARAPICU[IÍ]BA','PIRACICABA','BAURU','S[AÃ]O VICENTE','ITAQUAQUECETUBA',
    'FRANCA','GUARUJ[AÁ]','TABOAO DA SERRA','PRAIA GRANDE','LIMEIRA',
    'SUMAR[EÉ]','SUZANO','TAUBAT[EÉ]','EMBU DAS ARTES','S[AÃ]O CAETANO',
    'COTIA','INDAIATUBA','S[AÃ]O JOS[EÉ] DOS CAMPOS','BARUERI','MARILIA',
    'PINDAMONHANGABA','BOTUCATU','BRAGAN[CÇ]A PAULISTA','S[AÃ]O CARLOS'
  )
  'MG' = @(
    'BELO HORIZONTE','UBERL[AÂ]NDIA','CONTAGEM','JUIZ DE FORA','BETIM',
    'MONTES CLAROS','RIBEIR[AÃ]O DAS NEVES','UBERABA','GOVERNADOR VALADARES','IPATINGA',
    'SETE LAGOAS','DIVIN[OÓ]POLIS','SANTA LUZIA','IBIRIT[EÉ]','POÇOS DE CALDAS',
    'PATOS DE MINAS','TE[OÓ]FILO OTONI','SABAR[AÁ]','BARBACENA','VARGINHA',
    'CONSELHEIRO LAFAIETE','VESPASIANO','ARAGUARI','ITABIRA','UB[AÁ]'
  )
}

$ufUpper = $Uf.ToUpper()
if (-not $municipios.ContainsKey($ufUpper)) {
  Write-Host "UF '$ufUpper' nao mapeada. Disponiveis: $($municipios.Keys -join ', ')" -ForegroundColor Red
  exit 1
}

# Constroi regex: aceita "UF" como palavra isolada, "/UF", "- UF -", "ESTADO DO X", municipios
$lista = $municipios[$ufUpper]
$padraoUf = "\b$ufUpper\b|/$ufUpper\b|\-\s*$ufUpper\s*\-"
$padraoMun = ($lista | ForEach-Object { "\b$_\b" }) -join '|'
$regex = "(?i)($padraoUf|$padraoMun)"

$projectsPath = Join-Path $PSScriptRoot '..' 'cache' 'projetos.json'
if (-not (Test-Path $projectsPath)) {
  Write-Host "cache\projetos.json nao encontrado. Rode antes: npm run discover" -ForegroundColor Red
  exit 1
}

$projetos = Get-Content $projectsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$filtrados = $projetos | Where-Object { $_.titulo -match $regex -or $_.titulo_original -match $regex }

Write-Host ""
Write-Host "=== $($filtrados.Count) projetos vinculados a $ufUpper (de $($projetos.Count) totais) ===" -ForegroundColor Cyan
Write-Host ""

# Breakdown por ano
Write-Host "Por ano:" -ForegroundColor Yellow
$filtrados | Group-Object ano | Sort-Object { [int]$_.Name } | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

# Breakdown por status_b3 (ATIVO/DESERTO/SUSPENSO/CANCELADO/REVOGADO)
Write-Host ""
Write-Host "Por status:" -ForegroundColor Yellow
$filtrados | Group-Object status_b3 | Sort-Object Count -Descending | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

# Lista cronologica
Write-Host ""
Write-Host "Lista cronologica:" -ForegroundColor Yellow
$filtrados | Sort-Object { [int]$_.ano }, data | ForEach-Object {
  $status = if ($_.status_b3 -ne 'ATIVO') { " [$($_.status_b3)]" } else { '' }
  "  [$($_.ano)]$status $($_.titulo)"
}

# CSV opcional
if ($ExportCsv) {
  $outPath = Join-Path $PSScriptRoot '..' "cache" "projetos_$($ufUpper.ToLower()).csv"
  $filtrados | Select-Object ano, data, num_edital, status_b3, titulo, id_leilao, url_detalhe |
    Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
  Write-Host ""
  Write-Host "CSV exportado em: $outPath" -ForegroundColor Green
}
