﻿# scripts/filter-uf.ps1
# Conta e lista projetos por UF (estado) e municipios principais.
# Le cache/projetos.json (gerado pelo discover).
#
# Uso:
#   .\scripts\filter-uf.ps1 RJ
#   .\scripts\filter-uf.ps1 SP -ExportCsv

param(
  [Parameter(Mandatory=$true)][string]$Uf,
  [switch]$ExportCsv
)

# Helper para letras acentuadas via classe de caracteres unicode.
# A=A|A-acento, E=E|E-acento, etc. PowerShell 5.1 le este arquivo como
# UTF-8 (BOM presente no inicio).
$A = '[A' + [char]0x00C0 + [char]0x00C1 + [char]0x00C2 + [char]0x00C3 + ']'
$E = '[E' + [char]0x00C8 + [char]0x00C9 + [char]0x00CA + ']'
$I = '[I' + [char]0x00CC + [char]0x00CD + [char]0x00CE + ']'
$O = '[O' + [char]0x00D2 + [char]0x00D3 + [char]0x00D4 + [char]0x00D5 + ']'
$U = '[U' + [char]0x00D9 + [char]0x00DA + [char]0x00DB + ']'
$C = '[C' + [char]0x00C7 + ']'

# Municipios principais por UF.
$municipios = @{
  'RJ' = @(
    'RIO DE JANEIRO', "NITER${O}I", "S${A}O GON${C}ALO", 'DUQUE DE CAXIAS',
    "NOVA IGUA${C}U", 'BELFORD ROXO', 'CAMPOS DOS GOYTACAZES', "S${A}O JO${A}O DE MERITI",
    "PETR${O}POLIS", 'VOLTA REDONDA', "MAG${E}", "MACA${E}", "ITABORA${I}",
    'MESQUITA', 'NOVA FRIBURGO', 'BARRA MANSA', 'ANGRA DOS REIS', "TERES${O}POLIS",
    "NIL${O}POLIS", 'RESENDE', "MARIC${A}", 'QUEIMADOS', 'RIO DAS OSTRAS',
    'CABO FRIO', 'ITAPERUNA', 'ARARUAMA', "ITAGUA${I}", 'SAQUAREMA',
    "B${U}ZIOS", "ARMA${C}${A}O DOS B${U}ZIOS", 'PARACAMBI', 'PARATY',
    "S${A}O PEDRO DA ALDEIA", "TR${E}S RIOS", "VALEN${C}A", "PIRA${I}"
  )
  'SP' = @(
    "S${A}O PAULO", 'GUARULHOS', 'CAMPINAS', "S${A}O BERNARDO", "SANTO ANDR${E}",
    'OSASCO', "S${A}O JOS${E} DOS CAMPOS", "RIBEIR${A}O PRETO", 'SOROCABA', "MAU${A}",
    "S${A}O JOS${E} DO RIO PRETO", "MOG${I} DAS CRUZES", 'SANTOS', 'DIADEMA', "JUNDIA${I}",
    "CARAPICU${I}BA", 'PIRACICABA', 'BAURU', "S${A}O VICENTE", 'ITAQUAQUECETUBA',
    'FRANCA', "GUARUJ${A}", 'TABOAO DA SERRA', 'PRAIA GRANDE', 'LIMEIRA',
    "SUMAR${E}", 'SUZANO', "TAUBAT${E}", 'EMBU DAS ARTES', "S${A}O CAETANO",
    'COTIA', 'INDAIATUBA', 'BARUERI', 'MARILIA', 'PINDAMONHANGABA',
    'BOTUCATU', "BRAGAN${C}A PAULISTA", "S${A}O CARLOS"
  )
  'MG' = @(
    'BELO HORIZONTE', "UBERL${A}NDIA", 'CONTAGEM', 'JUIZ DE FORA', 'BETIM',
    'MONTES CLAROS', "RIBEIR${A}O DAS NEVES", 'UBERABA', 'GOVERNADOR VALADARES', 'IPATINGA',
    'SETE LAGOAS', "DIVIN${O}POLIS", 'SANTA LUZIA', "IBIRIT${E}", "PO${C}OS DE CALDAS",
    'PATOS DE MINAS', "TE${O}FILO OTONI", "SABAR${A}", 'BARBACENA', 'VARGINHA',
    'CONSELHEIRO LAFAIETE', 'VESPASIANO', 'ARAGUARI', 'ITABIRA'
  )
}

$ufUpper = $Uf.ToUpper()
if (-not $municipios.ContainsKey($ufUpper)) {
  Write-Host ("UF '{0}' nao mapeada. Disponiveis: {1}" -f $ufUpper, ($municipios.Keys -join ', ')) -ForegroundColor Red
  exit 1
}

# Constroi regex final
$lista = $municipios[$ufUpper]
$padraoUf = "\b$ufUpper\b|/$ufUpper\b"
$padraoMun = ($lista | ForEach-Object { "\b$_\b" }) -join '|'
$regex = "(?i)($padraoUf|$padraoMun)"

# Caminho do projetos.json (compativel com PS 5.1)
$projectsPath = Join-Path -Path $PSScriptRoot -ChildPath '..\cache\projetos.json'
if (-not (Test-Path $projectsPath)) {
  Write-Host "cache\projetos.json nao encontrado. Rode antes: npm run discover" -ForegroundColor Red
  exit 1
}

$projetos = Get-Content $projectsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$filtrados = $projetos | Where-Object {
  ($_.titulo -match $regex) -or ($_.titulo_original -match $regex)
}

Write-Host ""
Write-Host ("=== {0} projetos vinculados a {1} (de {2} totais) ===" -f $filtrados.Count, $ufUpper, $projetos.Count) -ForegroundColor Cyan
Write-Host ""

Write-Host "Por ano:" -ForegroundColor Yellow
$filtrados | Group-Object ano | Sort-Object { [int]$_.Name } | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

Write-Host ""
Write-Host "Por status:" -ForegroundColor Yellow
$filtrados | Group-Object status_b3 | Sort-Object Count -Descending | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

Write-Host ""
Write-Host "Lista cronologica:" -ForegroundColor Yellow
$filtrados | Sort-Object { [int]$_.ano }, data | ForEach-Object {
  $status = if ($_.status_b3 -ne 'ATIVO') { " [$($_.status_b3)]" } else { '' }
  "  [$($_.ano)]$status $($_.titulo)"
}

if ($ExportCsv) {
  $outPath = Join-Path -Path $PSScriptRoot -ChildPath ("..\cache\projetos_" + $ufUpper.ToLower() + ".csv")
  $filtrados | Select-Object ano, data, num_edital, status_b3, titulo, id_leilao, url_detalhe |
    Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
  Write-Host ""
  Write-Host "CSV exportado em: $outPath" -ForegroundColor Green
}
