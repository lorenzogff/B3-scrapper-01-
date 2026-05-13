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

if ([string]::IsNullOrWhiteSpace($Uf)) {
  Write-Host "Uso: .\scripts\filter-uf.ps1 <UF> [-ExportCsv]" -ForegroundColor Red
  Write-Host "Exemplo: .\scripts\filter-uf.ps1 RJ" -ForegroundColor Red
  exit 1
}
$ufUpper = $Uf.ToUpper()
if (-not $municipios.ContainsKey($ufUpper)) {
  Write-Host ("UF '{0}' nao mapeada. Disponiveis: {1}" -f $ufUpper, ($municipios.Keys -join ', ')) -ForegroundColor Red
  exit 1
}

# Constroi regex final defensivamente — nunca gera alternativa vazia,
# que matchaaria qualquer string (bug ja visto quando $ufUpper veio vazio).
$lista = $municipios[$ufUpper]
$alternativas = @("\b$ufUpper\b", "/$ufUpper\b")
foreach ($m in $lista) {
  if (-not [string]::IsNullOrWhiteSpace($m)) {
    $alternativas += "\b$m\b"
  }
}
$regex = "(?i)(" + ($alternativas -join '|') + ")"

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
  # Junta com cache/resultados/<id>.json para incluir valores extraidos.
  # Quando o regex achou multi-lote, gera uma linha por lote.
  $resDir = Join-Path -Path $PSScriptRoot -ChildPath '..\cache\resultados'
  $linhas = @()
  foreach ($p in $filtrados) {
    $baseRow = [ordered]@{
      ano            = $p.ano
      data           = $p.data
      num_edital     = $p.num_edital
      status_b3      = $p.status_b3
      nome_projeto   = $p.titulo
      id_leilao      = $p.id_leilao
      url_detalhe    = $p.url_detalhe
      status_extract = ''
      lote           = ''
      valor_remun_b3 = ''
      valor_global   = ''
      pagina_pdf     = ''
      fonte_observ   = ''
    }

    $idSafe = ($p.id -replace '[^A-Za-z0-9._-]', '_')
    $resFile = Join-Path -Path $resDir -ChildPath ($idSafe + '.json')
    if (Test-Path $resFile) {
      $r = Get-Content $resFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $baseRow.status_extract = $r.status
      $baseRow.valor_global = if ($r.valor_global) { $r.valor_global } else { '' }
      $baseRow.fonte_observ = if ($r.fonte_observacao) { $r.fonte_observacao } elseif ($r.pdf_processado) { $r.pdf_processado } else { '' }

      if ($r.valores -and $r.valores.Count -gt 0) {
        $multi = $r.valores.Count -gt 1
        foreach ($v in $r.valores) {
          $row = [ordered]@{}
          $baseRow.Keys | ForEach-Object { $row[$_] = $baseRow[$_] }
          $loteStr = if ($v.lote) { $v.lote } else { 'geral' }
          if ($multi -and $loteStr -ne 'geral') {
            $row.nome_projeto = "$($p.titulo) - Lote $loteStr"
          }
          $row.lote = $loteStr
          $row.valor_remun_b3 = $v.valor
          $row.pagina_pdf = if ($v.pagina_pdf) { $v.pagina_pdf } else { $r.pagina_alvo }
          $linhas += [PSCustomObject]$row
        }
      } else {
        $linhas += [PSCustomObject]$baseRow
      }
    } else {
      $baseRow.status_extract = 'sem_resultado'
      $linhas += [PSCustomObject]$baseRow
    }
  }

  $outPath = Join-Path -Path $PSScriptRoot -ChildPath ("..\cache\projetos_" + $ufUpper.ToLower() + ".csv")
  $linhas | Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
  Write-Host ""
  Write-Host ("CSV exportado em: {0} ({1} linhas)" -f $outPath, $linhas.Count) -ForegroundColor Green
  Write-Host "Abra no Excel e use 'Salvar como > .xlsx' para virar planilha." -ForegroundColor Green
}
