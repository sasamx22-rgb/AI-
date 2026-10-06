<#
.SYNOPSIS
  FAR (planning analytical review) workbook helper for the executor agent.
  Works through the locally installed Excel only (COM). ASCII-only on purpose.
  For a whole job (add accounts + fill + tie-out + check in ONE Excel session) use far-run.ps1.

.DESCRIPTION
  Actions (the FAR sheet is always the LAST sheet of the workbook):

  Fill        -File book.xlsx -Data data.txt [-SourceUnit won|thousand|million] [-Company NAME] [-CurMonths 8]
              [-PriorMonths 12] [-CurEnd 2026-08-31] [-PriorEnd 2025-12-31]
              data.txt (UTF-8): ROW|current|prior|Dr|Cr  (blank = skip). Only input cells are written;
              cells that hold formulas are skipped and reported.
              -SourceUnit is the unit of the current/prior amounts in data.txt (the Korean unit words or a plain
              multiplier such as 1000 also work); when omitted, won is assumed and a notice is printed. Those two
              columns are multiplied to won; the Dr/Cr columns are NOT scaled - write them in won. The FAR master is
              in won. This individual tool cannot read the source header: take the unit from the source yourself.
  AddAccount  -File book.xlsx -AfterRow N -Name "account name" [-Gongsi "disclosure account"]
  Check       -File book.xlsx [-OutFile report.txt]    (read-only)
  Variance    -File book.xlsx [-OutFile report.txt]    (read-only) rows with NEW/GONE/SIGN/BIG change vs prior year and
              whether each has a comment in column S; exit code 1 when a flagged row has no comment

  Fill and AddAccount modify -File in place: always run them on a copy in outputs/.
  If Excel cannot open the file, stop and report it; do not work around it.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Fill', 'AddAccount', 'Check', 'Variance')][string]$Action,
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Data = '',
  [string]$Company = '',
  [string]$CurMonths = '',
  [string]$PriorMonths = '',
  [string]$CurEnd = '',
  [string]$PriorEnd = '',
  [string]$SourceUnit = '',
  [int]$AfterRow = 0,
  [string]$Name = '',
  [string]$Gongsi = '',
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'far-lib.ps1')

$out = New-Object System.Collections.Generic.List[string]
$full = (Resolve-Path -LiteralPath $File).Path
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3; $xl.ScreenUpdating = $false
try {
  $wb = $xl.Workbooks.Open($full, 0, (($Action -eq 'Check') -or ($Action -eq 'Variance')))
  $far = $wb.Worksheets.Item($wb.Worksheets.Count)
  switch ($Action) {
    'Fill' {
      $xl.Calculation = -4135
      if ($Company) { $far.Range('G5').Value2 = $Company; $out.Add('company set') }
      if ($CurMonths) { $far.Range('P5').Value2 = [double]$CurMonths }
      if ($PriorMonths) { $far.Range('P6').Value2 = [double]$PriorMonths }
      # dates go in through .Formula as a serial-number string (Value2 = Double fails with an InvalidCast on this PC)
      if ($CurEnd) { $far.Range('G12').Formula = [string][int][datetime]::Parse($CurEnd).ToOADate() }
      if ($PriorEnd) { $far.Range('K12').Formula = [string][int][datetime]::Parse($PriorEnd).ToOADate() }
      $cols = @{ 1 = 7; 2 = 11; 3 = 8; 4 = 9 }
      $unitMult = 1.0
      if ($Data) {
        if ($SourceUnit -eq '') { $unitMult = 1.0; $out.Add('UNIT assumed won (x1): -SourceUnit not given. Check the amount scale against the source; Dr/Cr are never scaled') }
        else {
          $unitMult = Parse-UnitMultiplier $SourceUnit
          if ($null -eq $unitMult) { throw "-SourceUnit not understood: '$SourceUnit' (won / thousand / million / Korean unit word / multiplier)" }
          $out.Add("unit: current/prior amounts multiplied by $unitMult (SourceUnit '$SourceUnit'); Dr/Cr not scaled")
        }
      }
      $written = 0; $skipped = 0
      if ($Data) {
        $ln = 0
        foreach ($line in (Get-Content -LiteralPath $Data -Encoding UTF8)) {
          $ln++
          if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
          try {
            $p = $line.Split('|'); $row = [int]$p[0].Trim()
            foreach ($k in 1..4) {
              if ($p.Count -le $k) { continue }
              $t = $p[$k].Trim().Replace(',', ''); if ($t -eq '') { continue }
              $cell = $far.Cells.Item($row, $cols[$k])
              if ($cell.HasFormula) { $out.Add(("SKIP formula cell {0}{1}" -f (ColL $cols[$k]), $row)); $skipped++; continue }
              $amt = [double]$t; if ($k -le 2) { $amt = $amt * $unitMult }
              $cell.Value2 = $amt; $written++
            }
          } catch { $out.Add("ERROR data line ${ln}: $($_.Exception.Message) :: $line") }
        }
      }
      $xl.Calculation = -4105; $xl.CalculateFull()
      $out.Add("written=$written skipped=$skipped")
      $wb.Save()
    }
    'AddAccount' {
      if ($AfterRow -le 0 -or $Name -eq '') { throw 'AddAccount needs -AfterRow and -Name' }
      $xl.Calculation = -4135
      foreach ($m in (Add-FarAccount $wb $far $AfterRow $Name $Gongsi)) { $out.Add($m) }
      $xl.Calculation = -4105; $xl.CalculateFull()
      $wb.Save()
    }
    'Check' {
      foreach ($m in (Get-FarCheckLines $wb $far)) { $out.Add($m) }
    }
    'Variance' {
      $vr = Get-FarVariance $far
      foreach ($m in $vr.Lines) { $out.Add($m) }
      $varMissing = $vr.Missing
    }
  }
  $wb.Close($false)
}
finally {
  $xl.Quit()
  [System.GC]::Collect()
}
if ($OutFile -and (($Action -eq 'Check') -or ($Action -eq 'Variance'))) {
  [System.IO.File]::WriteAllText($OutFile, ($out -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "OK: $($out.Count) lines -> $OutFile"
} else { $out }
if (($Action -eq 'Variance') -and ($varMissing -gt 0)) { exit 1 }
