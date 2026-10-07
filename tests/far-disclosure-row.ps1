<#
.SYNOPSIS
  Test for Add-DisclosureRow (tools\far-lib.ps1): inserting a line into a disclosure sheet of the SUMIF-style K-IFRS master.
  Needs desktop Excel and templates\FAR_master_v1.xlsx. ASCII-only; Korean labels are built from char codes.
  Usage: powershell -ExecutionPolicy Bypass -File tests\far-disclosure-row.ps1      (exit 0 = all passed)
#>
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path (Join-Path $repo 'tools') 'far-lib.ps1')
function U([int[]]$c) { -join ($c | ForEach-Object { [char]$_ }) }
$ppe = U 0xC720, 0xD615, 0xC790, 0xC0B0                         # tangible assets line (middle of a group)
$newA = U 0xC0AC, 0xC6A9, 0xAD8C, 0xC790, 0xC0B0                 # right-of-use asset (new line)
$lastCur = U 0xB2F9, 0xAE30, 0xBC95, 0xC778, 0xC138, 0xC790, 0xC0B0   # last line of the current-assets group
$newB = U 0xC2E0, 0xADDC, 0xD56D, 0xBAA9                         # another new line
$tpl = Join-Path (Join-Path $repo 'templates') 'FAR_master_v1.xlsx'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('far-disc-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.xlsx')
Copy-Item -LiteralPath $tpl -Destination $tmp -Force
$fail = 0
function Check([string]$name, [bool]$ok, [string]$info) {
  if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name  $info"; $script:fail++ }
}
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3
$wb = $null
try {
  $wb = $xl.Workbooks.Open($tmp, 0, $false)
  $ws = $wb.Worksheets.Item(2)
  $before15 = [string]$ws.Range('D15').Formula
  $r1 = Add-DisclosureRow $ws $ppe $newA 1
  Check 'middle line: inserted' ($r1.Row -eq 20) "row=$($r1.Row) err=$($r1.Err)"
  Check 'middle line: label in A' ([string]$ws.Cells.Item(20, 1).Value2 -eq $newA) ''
  Check 'middle line: SUMIF points at its own row' (([string]$ws.Cells.Item(20, 3).Formula).Contains('A20')) ([string]$ws.Cells.Item(20, 3).Formula)
  Check 'middle line: note column cleared' ([string]$ws.Cells.Item(20, 2).Text -eq '') ''
  Check 'middle line: subtotal range grew' ([string]$ws.Range('D15').Formula -ne $before15) ([string]$ws.Range('D15').Formula)
  $r2 = Add-DisclosureRow $ws $lastCur $newB 1
  Check 'last line of a group: inserted' ($r2.Row -eq 15) "row=$($r2.Row) err=$($r2.Err)"
  Check 'last line of a group: SUM widened to the new row' (([string]$ws.Range('D8').Formula).Contains('C15') -and ([string]$ws.Range('F8').Formula).Contains('E15')) ([string]$ws.Range('D8').Formula + ' / ' + [string]$ws.Range('F8').Formula)
  $r3 = Add-DisclosureRow $ws $ppe $newA 1
  Check 'second insert of the same name is skipped' ($r3.Skipped -and ($r3.Row -eq 0)) ''
  $r4 = Add-DisclosureRow $ws 'no-such-line' 'x' 1
  Check 'unknown anchor is an error' ($r4.Err -ne '' -and ($r4.Row -eq 0)) ''
  $xl.CalculateFull()
  $chk = @($ws.UsedRange.Value2 | Where-Object { $_ -is [bool] })
  Check 'balance check cells still TRUE' (($chk.Count -gt 0) -and (@($chk | Where-Object { -not $_ }).Count -eq 0)) "bools=$($chk.Count)"
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  $xl.Quit(); [System.GC]::Collect()
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
if ($fail -gt 0) { Write-Host "$fail check(s) failed"; exit 1 }
Write-Host 'all passed'; exit 0
