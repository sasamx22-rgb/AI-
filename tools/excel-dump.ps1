<#
.SYNOPSIS
  Read-only dump of worksheets using the locally installed Excel.

.DESCRIPTION
  Opens the workbook read-only with macros force-disabled and no link updates, and writes non-empty
  cells row by row to a UTF-8 text file. Nothing is written back; no copy of the workbook is made.
  Write OutFile outside the repository when the workbook holds real client data.
  If Excel cannot open the file, stop and report it; do not work around it.

  -Sheet   name, 1-based index, or ALL (every sheet in one Excel launch; each section shows
           "=== sheet N name [HIDDEN]" and its used range). Default ALL.
  -Range   A1 range (single sheet only). Default: used range.
  -Formulas  also show formula text and result:  F=<formula> -> value
  -Compact   label-friendly format for financial statements: text cells are joined into one label
             (no column letters), numbers keep their column letter, rows with nothing are skipped:
                 R11 | 1) cash | D=5195169217 | F=1940795956
  -List    only list sheets (index, name, hidden state, used range) and exit.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\excel-dump.ps1 -File "C:\path\fs.xlsx" -Compact -OutFile "$env:TEMP\fs.txt"
  powershell -ExecutionPolicy Bypass -File tools\excel-dump.ps1 -File "C:\path\book.xlsx" -Sheet FAR -Range A1:W80 -Formulas -OutFile "$env:TEMP\far.txt"
#>
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Sheet = 'ALL',
  [string]$Range = '',
  [switch]$Formulas,
  [switch]$Compact,
  [switch]$List,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-ColLetter([int]$n) {
  $s = ''
  while ($n -gt 0) { $m = ($n - 1) % 26; $s = [char](65 + $m) + $s; $n = [math]::Floor(($n - 1) / 26) }
  return $s
}

function Dump-Sheet($ws, [string]$rangeText, $lines) {
  if ($rangeText) { $rng = $ws.Range($rangeText) } else { $rng = $ws.UsedRange }
  $r0 = $rng.Row; $c0 = $rng.Column
  $nr = $rng.Rows.Count; $nc = $rng.Columns.Count
  if ($nr -eq 1 -and $nc -eq 1) {
    $vals = New-Object 'object[,]' 1, 1; $vals[0, 0] = $rng.Value2
    $fmls = New-Object 'object[,]' 1, 1; $fmls[0, 0] = $rng.Formula
  } else {
    $vals = $rng.Value2
    $fmls = $rng.Formula
  }
  $lb = $vals.GetLowerBound(0); $lbc = $vals.GetLowerBound(1)
  for ($i = 0; $i -lt $nr; $i++) {
    $parts = @(); $labels = @()
    for ($j = 0; $j -lt $nc; $j++) {
      $v = $vals[($lb + $i), ($lbc + $j)]
      $f = $fmls[($lb + $i), ($lbc + $j)]
      $isF = ($f -is [string]) -and $f.StartsWith('=')
      if ($null -eq $v -and -not $isF) { continue }
      if (($v -is [string]) -and $v.Trim() -eq '' -and -not $isF) { continue }
      $col = Get-ColLetter ($c0 + $j)
      if ($Compact -and ($v -is [string]) -and -not $isF) { $labels += $v.Trim(); continue }
      if ($Formulas -and $isF) { $parts += "$col=$f -> $v" } else { $parts += "$col=$v" }
    }
    if ($Compact) {
      if (($labels.Count + $parts.Count) -gt 0) { $lines.Add("R$($r0 + $i) | " + ((@($labels -join ' ') + $parts | Where-Object { $_ -ne '' }) -join ' | ')) }
    } elseif ($parts.Count -gt 0) { $lines.Add("R$($r0 + $i) | " + ($parts -join ' | ')) }
  }
}

$full = (Resolve-Path -LiteralPath $File).Path
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.AutomationSecurity = 3
$lines = New-Object System.Collections.Generic.List[string]
try {
  $wb = $xl.Workbooks.Open($full, 0, $true)
  if ($List) {
    foreach ($ws in $wb.Worksheets) {
      $hid = ''; if ($ws.Visible -ne -1) { $hid = ' [HIDDEN]' }
      $lines.Add("sheet $($ws.Index) $($ws.Name)$hid  used=$($ws.UsedRange.Address($false, $false))")
    }
  } else {
    $targets = @()
    if ($Sheet -eq 'ALL') { foreach ($ws in $wb.Worksheets) { $targets += $ws } }
    elseif ($Sheet -match '^\d+$') { $targets += $wb.Worksheets.Item([int]$Sheet) }
    else { $targets += $wb.Worksheets.Item($Sheet) }
    foreach ($ws in $targets) {
      $hid = ''; if ($ws.Visible -ne -1) { $hid = ' [HIDDEN]' }
      $lines.Add("=== sheet $($ws.Index) $($ws.Name)$hid  range: $(if ($Range) { $Range } else { $ws.UsedRange.Address($false, $false) })")
      Dump-Sheet $ws $(if ($targets.Count -eq 1) { $Range } else { '' }) $lines
    }
  }
  $wb.Close($false)
}
finally {
  $xl.Quit()
  [System.GC]::Collect()
}

[System.IO.File]::WriteAllText($OutFile, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
Write-Output "OK: $($lines.Count) lines -> $OutFile"
