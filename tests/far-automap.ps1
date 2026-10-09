<#
.SYNOPSIS
  Test for AUTOMAP in tools\far-run.ps1 (needs desktop Excel and templates\FAR_master_KGAAP_v1.xlsx). ASCII-only; Korean labels come from char codes.
  Builds a tiny source workbook, runs far-run -DryRun with an AUTOMAP line and checks the mapping log, automap.txt and unmapped.txt.
  Usage: powershell -ExecutionPolicy Bypass -File tests\far-automap.ps1      (exit 0 = all passed)
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
function U([int[]]$c) { -join ($c | ForEach-Object { [char]$_ }) }
$cash = U 0xD604, 0xAE08, 0xBC0F, 0xD604, 0xAE08, 0xC131, 0xC790, 0xC0B0     # cash and cash equivalents (unique in the master)
$recv = U 0xBBF8, 0xC218, 0xC218, 0xC775                                     # accrued income (unique in the master)
$dupl = U 0xC0C1, 0xD488                                                      # merchandise: appears twice in the source
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('far-automap-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$fail = 0
function Check([string]$name, [bool]$ok, [string]$info) { if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name  $info"; $script:fail++ } }
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $src = Join-Path $work 'src.xlsx'
  $wb = $xl.Workbooks.Add(); $ws = $wb.Worksheets.Item(1)
  $rows = @(@($cash, 100, 90), @($recv, 200, 180), @($dupl, 30, 20), @($dupl, 40, 25), @('zz-unknown-account', 50, 40), @(($recv + 'x'), 5, 5))
  $r = 1; foreach ($x in $rows) { $ws.Cells.Item($r, 1).Value2 = $x[0]; $ws.Cells.Item($r, 2).Value2 = [double]$x[1]; $ws.Cells.Item($r, 3).Value2 = [double]$x[2]; $r++ }
  $wb.SaveAs($src, 51); $wb.Close($false)
  $job = Join-Path $work 'job.txt'
  $lines = @('COMPANY|test', 'PERIOD|12|12|2025-12-31|2024-12-31', "SOURCE|$src", 'SRC|BS|1|B|C|A:A', 'AUTOMAP', ("SKIP|BS|" + $recv + 'x'))
  [System.IO.File]::WriteAllLines($job, $lines, (New-Object System.Text.UTF8Encoding($true)))
  $out = Join-Path $work 'verify'
  $psExe = (Get-Process -Id $PID).Path
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $runOut = & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Join-Path $repo 'tools') 'far-run.ps1') -Job $job -File (Join-Path $work 'out.xlsx') -Template (Join-Path (Join-Path $repo 'templates') 'FAR_master_KGAAP_v1.xlsx') -OutDir $out -DryRun 2>&1 } finally { $ErrorActionPreference = $prev }
  if (-not (Test-Path -LiteralPath (Join-Path $out "mapping-log.txt"))) { Write-Host (($runOut | Select-Object -First 15) -join "`n") }
  $log = @(Get-Content -LiteralPath (Join-Path $out 'mapping-log.txt') -Encoding UTF8)
  $auto = @(Get-Content -LiteralPath (Join-Path $out 'automap.txt') -Encoding UTF8 -ErrorAction SilentlyContinue)
  $unm = @(Get-Content -LiteralPath (Join-Path $out 'unmapped.txt') -Encoding UTF8)
  Check 'unique name (cash) mapped automatically' (@($log | Where-Object { $_ -like "AUTO BS R1 '$cash' -> FAR R*cur=100 prior=90" }).Count -eq 1) ($log -join ' / ')
  Check 'unique name (receivables) mapped automatically' (@($log | Where-Object { $_ -like "AUTO BS R2 '$recv' -> FAR R*cur=200 prior=180" }).Count -eq 1) ($log -join ' / ')
  Check 'automap.txt lists exactly the two auto rows' (@($auto | Where-Object { $_ -notlike '#*' }).Count -eq 2) ($auto -join ' / ')
  Check 'duplicate source label is NOT auto-mapped (stays unmapped)' (@($unm | Where-Object { $_ -like "*'$dupl'*" }).Count -eq 2) ($unm -join ' / ')
  Check 'unknown account stays unmapped' (@($unm | Where-Object { $_ -like "*zz-unknown-account*" }).Count -eq 1) ($unm -join ' / ')
  $st = @(Get-Content -LiteralPath (Join-Path $out 'sheet1-text.txt') -Encoding UTF8 -ErrorAction SilentlyContinue)
  Check 'sheet1-text.txt is written for the reviewer (usage-notes sheet text)' ($st.Count -gt 0 -and ($st[0] -match '^1![A-Z]+[0-9]+: ')) ($st | Select-Object -First 2) -join ' / '
  Check 'SKIP rows are not touched by AUTOMAP' (@($log | Where-Object { $_ -like "AUTO*$recv`x*" }).Count -eq 0) ''
}
finally { try { $xl.Quit() } catch {}; [System.GC]::Collect(); if ($env:FAR_TEST_KEEP) { Write-Host "kept: $work" } else { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue } }
if ($fail -gt 0) { Write-Host "$fail check(s) failed"; exit 1 }
Write-Host 'all passed'; exit 0
