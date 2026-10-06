<#
.SYNOPSIS
  Regression test for the FAR tools: far-run.ps1 -Prune and the save gate, run on a made-up financial statement.
  ASCII-only script; the Korean data lives in tests\far-regression\*.txt (UTF-8).

.DESCRIPTION
  tests\far-regression.ps1 [-SkipExcel] [-KeepWork]

  Part A (no Excel needed): Get-FarPrunePlan, Get-FormulaRowRefs and Get-FarFormulaScan from tools\far-lib.ps1.
  Part B (needs desktop Excel, about 2-3 minutes): builds a source workbook from fixture.txt in a temp folder, then
    Case 1  runs far-run.ps1 -Prune on templates\FAR_master_KGAAP_v1.xlsx and checks
              - exit code 0, "GATE: PASS", the output workbook was saved
              - every TIE line OK (none DIFF) and the grand totals tied (assets, liabilities, equity, revenue, COGS, gross
                profit, SG&A, operating income, net income); far-check shows no FALSE checks
              - -Prune deleted rows, and only zero rows: every account that has an amount in the current OR the prior
                period is still in the saved FAR with the source amounts (also the one-sided zero accounts), while the
                zero accounts listed in expect.txt (DELETE) are gone
    Case 2  (negative control) the same job on a source whose total assets are wrong: the gate must say FAIL, the exit
            code must be 1 and no output workbook may be created.
  -SkipExcel : run Part A only.   -KeepWork : keep the temp folder (generated source, outputs, reports).
  Real client data is never used: only the made-up numbers in fixture.txt. Exit code: 0 = all passed, 1 = a check
  failed, 2 = Excel is not available.
#>
param(
  [switch]$SkipExcel,
  [switch]$KeepWork
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot
$data = Join-Path $PSScriptRoot 'far-regression'
. (Join-Path (Join-Path $repo 'tools') 'far-lib.ps1')

$script:results = New-Object System.Collections.Generic.List[object]
function Assert-That([string]$name, [bool]$cond, [string]$detail = '') {
  $script:results.Add(@{ Name = $name; Ok = $cond; Detail = $detail })
  if ($cond) { Write-Host "  PASS  $name" } else { Write-Host "  FAIL  $name  $detail" }
}
function Join-Ints($a) { return (@($a) -join ',') }

# ---------------------------------------------------------------------------------------------------------------
# Part A: pure functions (no Excel)
# ---------------------------------------------------------------------------------------------------------------
Write-Host 'Part A: prune planning and formula scan (no Excel)'

# Get-FarPrunePlan: zero rows go, unless used by an analysis formula, carrying an amount/comment, or last of a group
$rows = @(
  @{ Row = 10; Label = 'zero'; Amount = $false; Comment = $false },
  @{ Row = 11; Label = 'zero but used by an analysis formula'; Amount = $false; Comment = $false },
  @{ Row = 12; Label = 'has an amount'; Amount = $true; Comment = $false },
  @{ Row = 13; Label = 'zero but has a comment'; Amount = $false; Comment = $true },
  @{ Row = 20; Label = 'group A'; Amount = $false; Comment = $false },
  @{ Row = 21; Label = 'group B'; Amount = $false; Comment = $false },
  @{ Row = 22; Label = 'group C'; Amount = $false; Comment = $false },
  @{ Row = 30; Label = 'group2 zero'; Amount = $false; Comment = $false },
  @{ Row = 31; Label = 'group2 amount'; Amount = $true; Comment = $false }
)
$plan = Get-FarPrunePlan $rows @{ 11 = 1 } @(@{ Lo = 20; Hi = 22 }, @{ Lo = 30; Hi = 31 })
Assert-That 'prune plan: deletes only unprotected zero rows (highest row first)' ((Join-Ints $plan.Delete) -eq '30,22,21,10') (Join-Ints $plan.Delete)
Assert-That 'prune plan: amount, comment, formula-referenced rows stay' ((@($plan.Delete) -notcontains 11) -and (@($plan.Delete) -notcontains 12) -and (@($plan.Delete) -notcontains 13))
Assert-That 'prune plan: the first row of an all-zero group stays' (@($plan.Delete) -notcontains 20)
Assert-That 'prune plan: every kept zero row is reported with a reason' ($plan.Kept.Count -eq 2) ("kept lines: " + $plan.Kept.Count)

# Get-FormulaRowRefs
$refs = Get-FormulaRowRefs '=G19+H19-I19' 'FAR'
Assert-That 'row refs: three cell references on row 19' (($refs.Count -eq 3) -and ($refs[0].Lo -eq 19) -and ($refs[0].Sheet -eq 'FAR')) ("count " + $refs.Count)
$refs = Get-FormulaRowRefs '=SUM(J125:J132)' 'FAR'
Assert-That 'row refs: a range gives Lo/Hi' (($refs.Count -eq 1) -and ($refs[0].Lo -eq 125) -and ($refs[0].Hi -eq 132))
$refs = Get-FormulaRowRefs '=FAR!J16/2' 'DISC'
Assert-That 'row refs: a sheet-qualified reference keeps its sheet' (($refs.Count -eq 1) -and ($refs[0].Sheet -eq 'FAR') -and ($refs[0].Lo -eq 16))

# Get-FarFormulaScan
$cells = @(
  @{ Sheet = 'FAR'; SheetIndex = 5; Row = 15; Col = 10; F = '=SUM(J16:J18)' },          # group sum
  @{ Sheet = 'FAR'; SheetIndex = 5; Row = 16; Col = 10; F = '=G16+H16-I16' },            # a row's own formula
  @{ Sheet = 'FAR'; SheetIndex = 5; Row = 60; Col = 10; F = '=J17/J19' },                # analysis formula -> protects 17 and 19
  @{ Sheet = 'DISC'; SheetIndex = 2; Row = 7; Col = 3; F = '=FAR!J16' },                 # disclosure link (current)
  @{ Sheet = 'DISC'; SheetIndex = 2; Row = 7; Col = 4; F = '=FAR!K16' }                  # disclosure link (prior): same sheet row
)
$scan = Get-FarFormulaScan $cells 'FAR' @(16, 17, 18, 19)
Assert-That 'formula scan: a row used by an analysis formula is protected' ($scan.Protect.ContainsKey(17) -and $scan.Protect.ContainsKey(19))
Assert-That 'formula scan: own formula, group SUM and disclosure link do not protect a row' (-not $scan.Protect.ContainsKey(16) -and -not $scan.Protect.ContainsKey(18))
Assert-That 'formula scan: the group SUM range is reported' (($scan.Groups.Count -eq 1) -and ($scan.Groups[0].Lo -eq 16) -and ($scan.Groups[0].Hi -eq 18))
Assert-That 'formula scan: the disclosure row linked to FAR row 16 is recorded once' ($scan.Links.ContainsKey(16) -and ($scan.Links[16].Count -eq 1))

# ---------------------------------------------------------------------------------------------------------------
# Part B: far-run.ps1 -Prune on a made-up statement (needs Excel)
# ---------------------------------------------------------------------------------------------------------------
function Read-DataLines([string]$path) {
  $out = New-Object System.Collections.Generic.List[string[]]
  foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $out.Add(@($line.Split('|') | ForEach-Object { $_.Trim() }))
  }
  return $out
}
function ToD([string]$s) { if ([string]::IsNullOrWhiteSpace($s)) { return $null }; return [double]::Parse($s, [System.Globalization.CultureInfo]::InvariantCulture) }

function New-SourceWorkbook([string]$path, $fixtureLines, $deltas) {
  # sheets in order of first appearance; TEXT rows carry only a label, ROW rows label + current + prior (columns A, B, C)
  $order = New-Object System.Collections.Generic.List[string]; $byName = @{}
  foreach ($p in $fixtureLines) {
    if (-not $byName.ContainsKey($p[1])) { $byName[$p[1]] = New-Object System.Collections.Generic.List[object]; $order.Add($p[1]) }
    $byName[$p[1]].Add($p)
  }
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3
  $wb = $null
  try {
    $wb = $xl.Workbooks.Add()
    while ($wb.Worksheets.Count -gt $order.Count) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() | Out-Null }
    while ($wb.Worksheets.Count -lt $order.Count) { $wb.Worksheets.Add([System.Reflection.Missing]::Value, $wb.Worksheets.Item($wb.Worksheets.Count)) | Out-Null }
    for ($i = 0; $i -lt $order.Count; $i++) {
      $name = $order[$i]; $ws = $wb.Worksheets.Item($i + 1); $ws.Name = $name; $r = 1
      foreach ($p in $byName[$name]) {
        if ($p[0] -eq 'TEXT') { $ws.Cells.Item($r, 1).Value2 = $p[2] }
        else {
          $cur = ToD $p[3]; $pri = ToD $p[4]
          $key = $name + '|' + $p[2]
          if ($deltas.ContainsKey($key)) { $cur = $cur + $deltas[$key] }
          $ws.Cells.Item($r, 1).Value2 = $p[2]
          if ($null -ne $cur) { $ws.Cells.Item($r, 2).Value2 = [double]$cur }
          if ($null -ne $pri) { $ws.Cells.Item($r, 3).Value2 = [double]$pri }
        }
        $r++
      }
    }
    $wb.SaveAs($path, 51)
    $wb.Close($false); $wb = $null
  }
  finally {
    if ($wb) { try { $wb.Close($false) } catch {} }
    $xl.Quit(); [System.GC]::Collect()
  }
}

function Invoke-FarRun([string]$jobFile, [string]$outFile, [string]$outDir) {
  $psExe = (Get-Process -Id $PID).Path
  $tpl = Join-Path (Join-Path $repo 'templates') 'FAR_master_KGAAP_v1.xlsx'
  $farRun = Join-Path (Join-Path $repo 'tools') 'far-run.ps1'
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'      # stderr of the child must not abort this script
  try { $text = & $psExe -NoProfile -ExecutionPolicy Bypass -File $farRun -Job $jobFile -File $outFile -Template $tpl -OutDir $outDir -Prune 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $prevEap }
  return @{ Code = $code; Text = (@($text) -join "`n") }
}
function Read-Report([string]$dir, [string]$name) {
  $p = Join-Path $dir $name
  if (-not (Test-Path -LiteralPath $p)) { return @() }
  return @(Get-Content -LiteralPath $p -Encoding UTF8)
}

if ($SkipExcel) {
  Write-Host 'Part B skipped (-SkipExcel)'
} else {
  try { $probe = New-Object -ComObject Excel.Application; $probe.Quit(); [System.GC]::Collect() }
  catch { Write-Host 'Excel is not available on this PC: Part B needs desktop Excel (run with -SkipExcel for Part A only).'; exit 2 }

  $work = Join-Path ([System.IO.Path]::GetTempPath()) ('far-regression-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $utf8bom = New-Object System.Text.UTF8Encoding($true)
  try {
    $fixture = @(Read-DataLines (Join-Path $data 'fixture.txt'))
    $expect = @(Read-DataLines (Join-Path $data 'expect.txt'))
    $jobTemplate = [System.IO.File]::ReadAllText((Join-Path $data 'job.txt'), [System.Text.Encoding]::UTF8)
    $deleteList = @($expect | Where-Object { $_[0] -eq 'DELETE' })
    $negList = @($expect | Where-Object { $_[0] -eq 'NEGATIVE' })
    $nTie = @($jobTemplate -split "`r?`n" | Where-Object { $_.StartsWith('TIE|') }).Count

    function New-JobFile([string]$name, [string]$srcPath) {
      $p = Join-Path $work $name
      [System.IO.File]::WriteAllText($p, $jobTemplate.Replace('{SOURCE}', $srcPath), $utf8bom)
      return $p
    }

    # ---- Case 1: the good source -------------------------------------------------------------------------
    Write-Host 'Part B / case 1: -Prune on the made-up statement (Excel, about 1 minute)'
    $src1 = Join-Path $work 'source-ok.xlsx'
    New-SourceWorkbook $src1 $fixture @{}
    $job1 = New-JobFile 'job-ok.txt' $src1
    $out1 = Join-Path $work 'far-ok.xlsx'; $dir1 = Join-Path $work 'verify-ok'
    $run1 = Invoke-FarRun $job1 $out1 $dir1
    $gate1 = Read-Report $dir1 'gate.txt'
    Assert-That 'case 1: exit code 0' ($run1.Code -eq 0) ("exit code " + $run1.Code + "`n" + $run1.Text)
    Assert-That 'case 1: gate.txt says GATE: PASS' (($gate1.Count -gt 0) -and ($gate1[0] -eq 'GATE: PASS')) (($gate1 | Select-Object -First 8) -join ' / ')
    Assert-That 'case 1: output workbook saved' ((Test-Path -LiteralPath $out1) -and ($run1.Text -match 'SAVED:'))
    Assert-That 'case 1: no unmapped source rows' ((@(Read-Report $dir1 'unmapped.txt' | Where-Object { $_ -ne '' }).Count) -eq 0)

    $tie1 = Read-Report $dir1 'tie-out-auto.txt'
    $nOk = @($tie1 | Where-Object { $_ -match '^OK\s*\|' }).Count
    $nDiff = @($tie1 | Where-Object { $_ -match '^DIFF' }).Count
    Assert-That 'case 1: every TIE line matches (totals agree with the source)' (($nDiff -eq 0) -and ($nOk -eq $nTie) -and ($nTie -ge 9)) "OK=$nOk DIFF=$nDiff TIE lines in job=$nTie"
    $chk1 = Read-Report $dir1 'far-check.txt'
    Assert-That 'case 1: far-check has no FALSE checks and no error cells' ((@($chk1 | Where-Object { $_ -match '^FALSE checks:\s+0\b' }).Count -eq 1) -and (@($chk1 | Where-Object { $_ -match '^error (REF|NAME|VALUE|NA|ERR):' }).Count -eq 0)) (($chk1 | Where-Object { $_ -match '^FALSE|^error' }) -join ' / ')

    # prune: nothing but zero rows may be gone. Read the saved FAR and compare it with the source amounts.
    $nPruned = -1
    foreach ($g in $gate1) { if ($g -match 'pruned zero account rows:\s*(\d+)') { $nPruned = [int]$Matches[1] } }
    Assert-That 'case 1: -Prune deleted at least the zero rows listed in expect.txt' ($nPruned -ge $deleteList.Count) "pruned=$nPruned expected>=$($deleteList.Count)"

    $amount = @{}      # sheet|Norm(label) -> @(cur, prior)
    foreach ($p in $fixture) { if ($p[0] -eq 'ROW') { $amount[$p[1] + '|' + (Norm $p[2])] = @((ToD $p[3]), (ToD $p[4])) } }
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3
    $wbo = $null
    try {
      $wbo = $xl.Workbooks.Open($out1, 0, $true)
      $far = $wbo.Worksheets.Item($wbo.Worksheets.Count)
      $idx = Build-FarIndex $far
      $missing = New-Object System.Collections.Generic.List[string]
      $wrong = New-Object System.Collections.Generic.List[string]
      $nChecked = 0; $nOneSided = 0
      foreach ($p in @(Read-DataLines (Join-Path $data 'job.txt') | Where-Object { $_[0] -eq 'MAP' })) {
        $am = $amount[$p[1] + '|' + (Norm $p[2])]
        if ($null -eq $am) { $wrong.Add("fixture row not found for MAP $($p[2])"); continue }
        $c = [double]$am[0]; $q = [double]$am[1]
        if (($c -eq 0) -and ($q -eq 0)) { continue }                      # both zero: may be deleted, no claim here
        $farLabel = $p[2]; if (($p.Count -gt 3) -and ($p[3] -ne '')) { $farLabel = $p[3] }
        $grp = ''; if ($p.Count -gt 5) { $grp = $p[5] }
        $row = Find-FarRow $idx $farLabel $grp 1 $false
        if ($row -eq 0) { $missing.Add("$farLabel (cur=$c prior=$q)"); continue }
        $nChecked++; if (($c -eq 0) -or ($q -eq 0)) { $nOneSided++ }
        $fj = [double]$far.Cells.Item($row, 10).Value2; $fk = [double]$far.Cells.Item($row, 11).Value2
        if (([math]::Abs($fj - $c) -ge 0.5) -or ([math]::Abs($fk - $q) -ge 0.5)) { $wrong.Add("$farLabel FAR J/K=$fj/$fk source=$c/$q") }
      }
      Assert-That 'case 1: every account with an amount in either period is still in the FAR' ($missing.Count -eq 0) ($missing -join '; ')
      Assert-That 'case 1: those accounts carry the source amounts (including the one-sided zero accounts)' (($wrong.Count -eq 0) -and ($nChecked -gt 0) -and ($nOneSided -ge 4)) ("checked=$nChecked one-sided=$nOneSided " + ($wrong -join '; '))
      $still = New-Object System.Collections.Generic.List[string]
      foreach ($d in $deleteList) {
        $grp = ''; if ($d.Count -gt 2) { $grp = $d[2] }
        if ((Find-FarRow $idx $d[1] $grp 1 $false) -ne 0) { $still.Add($d[1]) }
      }
      Assert-That 'case 1: the zero accounts listed in expect.txt are deleted' ($still.Count -eq 0) ('still present: ' + ($still -join ', '))
    }
    finally {
      if ($wbo) { try { $wbo.Close($false) } catch {} }
      $xl.Quit(); [System.GC]::Collect()
    }

    # ---- Case 2: negative control ------------------------------------------------------------------------
    Write-Host 'Part B / case 2: wrong source total must be stopped by the gate (Excel, about 1 minute)'
    $deltas = @{}
    foreach ($n in $negList) { $deltas[$n[1] + '|' + $n[2]] = (ToD $n[3]) }
    $src2 = Join-Path $work 'source-bad.xlsx'
    New-SourceWorkbook $src2 $fixture $deltas
    $job2 = New-JobFile 'job-bad.txt' $src2
    $out2 = Join-Path $work 'far-bad.xlsx'; $dir2 = Join-Path $work 'verify-bad'
    $run2 = Invoke-FarRun $job2 $out2 $dir2
    $gate2 = Read-Report $dir2 'gate.txt'
    Assert-That 'case 2: exit code 1' ($run2.Code -eq 1) ("exit code " + $run2.Code)
    Assert-That 'case 2: gate.txt says GATE: FAIL with a tie-out DIFF' (($gate2.Count -gt 0) -and ($gate2[0] -eq 'GATE: FAIL') -and (@($gate2 | Where-Object { $_ -match 'tie-out DIFF' }).Count -eq 1)) (($gate2 | Select-Object -First 6) -join ' / ')
    Assert-That 'case 2: nothing was saved' ((-not (Test-Path -LiteralPath $out2)) -and ($run2.Text -match 'NOT SAVED'))
  }
  finally {
    if ($KeepWork) { Write-Host "work folder kept: $work" }
    else { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

# ---------------------------------------------------------------------------------------------------------------
$failed = @($script:results | Where-Object { -not $_.Ok })
Write-Host ''
Write-Host ("{0} checks, {1} failed" -f $script:results.Count, $failed.Count)
if ($failed.Count -gt 0) { exit 1 }
exit 0
