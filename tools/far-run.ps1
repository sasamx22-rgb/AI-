<#
.SYNOPSIS
  One-shot FAR job: fill the workbook from a source financial-statement workbook, add accounts,
  tie out totals and run the check report, all in ONE Excel session. ASCII-only script; the
  Korean text lives in the job file (UTF-8).

.DESCRIPTION
  far-run.ps1 -Job job.txt -File outputs\x.xlsx [-Template templates\FAR_master_KGAAP_v1.xlsx]
              [-OutDir outputs\_verify\x] [-DryRun] [-Force]

  -Template : copy the master over -File first (re-runs are then deterministic).
  -DryRun   : compute everything and write reports, but do not save the workbook.
  -Force    : save even if ERROR lines exist (default: not saved when errors exist).
  Reports in -OutDir: mapping-log.txt, unmapped.txt, tie-out-auto.txt, far-check.txt.

  Job file (UTF-8, pipe separated, '#' comments, blank fields allowed). Accounts are addressed by LABEL,
  never by row number, so added rows and shifted rows do not matter. Labels are normalized on both
  sides (spaces, leading "1)" / "(1)" / "1." / roman numerals and parentheses are ignored).

    INCLUDE|path                       reuse another job/dictionary file (relative to this file)
    SOURCE|C:\path\fs.xlsx             source financial statements (opened read-only)
    SRC|key|sheet|curCol|priorCol[|labelCols[|deep]]   sheet = name or 1-based index, e.g. SRC|BS|1|D|F|A:C
                                       "deep" = use the right-most text cell of the label columns as the label
                                       (default: the first one); useful when a heading in B hides the account in C
    COMPANY|name
    PERIOD|curMonths|priorMonths|curEndDate|priorEndDate
    ADD|afterLabel|newLabel|gongsi|afterGroup|afterOcc      insert an account row below afterLabel
    MAP|key|srcLabel|farLabel|sign|farGroup|srcOcc|farOcc[|curCol|priorCol]
                                       sign: blank, + or - (- flips, e.g. contra accounts shown positive)
                                       srcOcc/farOcc = Nth same-named row (UNMAPPED lines print the srcOcc to use)
                                       curCol/priorCol = read this line from other source columns (e.g. total columns E|G)
                                       several MAP lines to one FAR row are summed
                                       examples:  MAP|BS|sales|sales||||2        (2nd source row named sales)
                                                  MAP|BS|allowance|inv allowance|-   (shown positive, enter negative)
                                                  MAP|IS|cogs|cogs||||||E|G        (value only in total columns)
    SKIP|key|srcLabel|srcOcc           source row deliberately not mapped (subtotals, zero rows)
    TIE|key|srcLabel|farLabel|farGroup|curCol|priorCol|srcOcc|farOcc   compare a source total to FAR (J/K)
    ADJ|farLabel|farGroup|dr|cr|farOcc adjusting entry amounts (columns H/I)
    ACELL|rowLabel|col|value|occ       input cell in the analytics block below the body, found by the row's
                                       label text (e.g. prior-prior-year opening balances in column H)

  ADD notes: the "already exists" check looks for newLabel under afterGroup; a skipped ADD is printed as a
  WARNING in the summary. A failed run never overwrites an existing -File when -Template is used.

  farGroup = the major heading the account sits under (e.g. the SG&A heading), to tell apart same-named
  accounts (e.g. salaries in SG&A vs manufacturing cost). The dictionary (ADD/MAP/SKIP lines) can be kept
  per client and INCLUDEd next period; new accounts then show up under UNMAPPED.
#>
param(
  [Parameter(Mandatory = $true)][string]$Job,
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Template = '',
  [string]$OutDir = '',
  [switch]$DryRun,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'far-lib.ps1')

function Read-Job([string]$path, $list, $seen) {
  $full = (Resolve-Path -LiteralPath $path).Path
  if ($seen.ContainsKey($full)) { return }
  $seen[$full] = 1
  $dir = Split-Path -Parent $full
  $ln = 0
  foreach ($line in (Get-Content -LiteralPath $full -Encoding UTF8)) {
    $ln++
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $p = $line.Split('|') | ForEach-Object { $_.Trim() }
    if ($p[0].ToUpper() -eq 'INCLUDE') {
      $inc = $p[1]; if (-not [System.IO.Path]::IsPathRooted($inc)) { $inc = Join-Path $dir $inc }
      Read-Job $inc $list $seen
    } else { $list.Add(@{ Cmd = $p[0].ToUpper(); P = $p; Src = "$([System.IO.Path]::GetFileName($full)):$ln" }) }
  }
}
function Fld($p, [int]$i) { if ($p.Count -gt $i) { return [string]$p[$i] } else { return '' } }
function ToNum($x) {
  if ($null -eq $x) { return $null }
  if ($x -is [double]) { return [double]$x }
  if ($x -is [int]) { return [double]$x }
  if ($x -is [string]) { $t = $x.Replace(',', '').Trim(); $d = 0.0; if ([double]::TryParse($t, [ref]$d)) { return $d } }
  return $null
}

$jobs = New-Object System.Collections.Generic.List[object]; Read-Job $Job $jobs @{}
if (-not [System.IO.Path]::IsPathRooted($File)) { $File = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $File)) }
# With -Template the work happens in a temp copy; the real -File is replaced only after a successful save,
# so a failed run never leaves an existing deliverable overwritten by an empty master.
$workFile = ''
if ($Template) {
  $workFile = $File + '.work.xlsx'
  Copy-Item -LiteralPath $Template -Destination $workFile -Force
  $fullFile = (Resolve-Path -LiteralPath $workFile).Path
} else { $fullFile = (Resolve-Path -LiteralPath $File).Path }
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $fullFile) '_verify' }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$log = New-Object System.Collections.Generic.List[string]     # mapping log
$unm = New-Object System.Collections.Generic.List[string]
$tie = New-Object System.Collections.Generic.List[string]
$errors = New-Object System.Collections.Generic.List[string]
function Err([string]$m) { $script:errors.Add($m); $script:log.Add("ERROR $m") }

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3; $xl.ScreenUpdating = $false
$srcWb = $null; $wb = $null; $checkLines = $null; $saved = $false
try {
  $wb = $xl.Workbooks.Open($fullFile, 0, $false)
  $far = $wb.Worksheets.Item($wb.Worksheets.Count)
  $xl.Calculation = -4135

  # --- sources -------------------------------------------------------------
  $srcPath = ''; foreach ($j in $jobs) { if ($j.Cmd -eq 'SOURCE') { $srcPath = $j.P[1] } }
  $srcs = @{}
  if ($srcPath) {
    $srcWb = $xl.Workbooks.Open((Resolve-Path -LiteralPath $srcPath).Path, 0, $true)
    foreach ($j in $jobs) {
      if ($j.Cmd -ne 'SRC') { continue }
      $p = $j.P; $key = $p[1]; $sh = $p[2]
      if ($sh -match '^\d+$') { $ws = $srcWb.Worksheets.Item([int]$sh) } else { $ws = $srcWb.Worksheets.Item($sh) }
      $lc = Fld $p 5; if ($lc -eq '') { $lc = 'A:C' }
      $deep = ((Fld $p 6).ToLower() -eq 'deep')        # SRC 7th field "deep": use the right-most text cell as the label
      $lcs = $lc.Split(':'); $lc1 = ColN $lcs[0]; $lc2 = ColN $lcs[$lcs.Count - 1]
      $cc = ColN $p[3]; $pc = ColN $p[4]
      $ur = $ws.UsedRange; $v = $ur.Value2; $r0 = $ur.Row; $c0 = $ur.Column
      $rows = New-Object System.Collections.Generic.List[object]
      if ($v -is [object[,]]) {
        $nr = $ur.Rows.Count; $nc = $ur.Columns.Count
        for ($i = 1; $i -le $nr; $i++) {
          $r = $r0 + $i - 1; $raw = ''
          for ($c = $lc1; $c -le $lc2; $c++) { $ci = $c - $c0 + 1; if (($ci -ge 1) -and ($ci -le $nc)) { $x = $v[$i, $ci]; if (($x -is [string]) -and ($x.Trim() -ne '')) { $raw = $x; if (-not $deep) { break } } } }
          $cv = $null; $pv = $null
          $ci = $cc - $c0 + 1; if (($ci -ge 1) -and ($ci -le $nc)) { $cv = ToNum $v[$i, $ci] }
          $pi2 = $pc - $c0 + 1; if (($pi2 -ge 1) -and ($pi2 -le $nc)) { $pv = ToNum $v[$i, $pi2] }
          $rows.Add(@{ Row = $r; Raw = $raw; Norm = (Norm $raw); Cur = $cv; Prior = $pv; Used = $false; Sheet = $sh })
        }
      }
      $srcs[$key] = @{ Rows = $rows; Sheet = $sh; Ws = $ws; R0 = $r0; C0 = $c0; V = $v; CurCol = $cc; PriorCol = $pc }
    }
  }
  function Find-SrcRow($s, [string]$label, [int]$occ) {
    $L = Norm $label; if ($occ -lt 1) { $occ = 1 }; $n = 0
    foreach ($r in $s.Rows) { if (($r.Norm -ne '') -and ($r.Norm -eq $L)) { $n++; if ($n -eq $occ) { return $r } } }
    return $null
  }
  function Src-Num($s, $row, [string]$colL) {
    $ci = (ColN $colL) - $s.C0 + 1; $ri = $row.Row - $s.R0 + 1
    if (($s.V -isnot [object[,]]) -or ($ci -lt 1) -or ($ri -lt 1)) { return $null }
    return ToNum $s.V[$ri, $ci]
  }

  # --- header: company / period -------------------------------------------
  foreach ($j in $jobs) {
    if ($j.Cmd -eq 'COMPANY') {
      $far.Range('G5').Value2 = $j.P[1]
      # fill the "[company name]" placeholder on the other sheets too (placeholder text built from char codes)
      $ph = '[' + [string][char]0xD68C + [string][char]0xC0AC + [string][char]0xBA85 + ']'
      for ($si = 1; $si -lt $wb.Worksheets.Count; $si++) { $wb.Worksheets.Item($si).UsedRange.Replace($ph, $j.P[1], 2) | Out-Null }
    }
    if ($j.Cmd -eq 'PERIOD') {
      $p = $j.P
      if ((Fld $p 1) -ne '') { $far.Range('P5').Value2 = [double]$p[1] }
      if ((Fld $p 2) -ne '') { $far.Range('P6').Value2 = [double]$p[2] }
      # dates go in through .Formula as a serial-number string: assigning a Double to Value2 here fails with an InvalidCast on this PC
      if ((Fld $p 3) -ne '') { $far.Range('G12').Formula = [string][int][datetime]::Parse($p[3]).ToOADate() }
      if ((Fld $p 4) -ne '') { $far.Range('K12').Formula = [string][int][datetime]::Parse($p[4]).ToOADate() }
    }
  }

  # --- add accounts ----------------------------------------------------------
  $idx = Build-FarIndex $far
  foreach ($j in $jobs) {
    if ($j.Cmd -ne 'ADD') { continue }
    $p = $j.P; $after = Fld $p 1; $new = Fld $p 2; $gong = Fld $p 3; $grp = Fld $p 4; $occ = 1; if ((Fld $p 5) -ne '') { $occ = [int]$p[5] }
    if ((Find-FarRow $idx $new $grp 1 $false) -gt 0) { $log.Add("ADD skipped (already exists): $new"); continue }
    $ar = Find-FarRow $idx $after $grp $occ $false
    if ($ar -eq 0) { Err "ADD: anchor not found '$after' (group '$grp') [$($j.Src)]"; continue }
    foreach ($m in (Add-FarAccount $wb $far $ar $new $gong)) { $log.Add("ADD $new : $m") }
    $idx = Build-FarIndex $far
  }

  # --- map values ------------------------------------------------------------
  $pending = @{}    # FAR row -> @{Cur;Prior;Labels}
  $nMap = 0
  foreach ($j in $jobs) {
    $p = $j.P
    if ($j.Cmd -eq 'SKIP') {
      $s = $srcs[$p[1]]; if ($null -eq $s) { Err "SKIP: unknown SRC key '$($p[1])' [$($j.Src)]"; continue }
      $o = 1; if ((Fld $p 3) -ne '') { $o = [int]$p[3] }
      $r = Find-SrcRow $s $p[2] $o; if ($null -eq $r) { $log.Add("SKIP: source row not found '$($p[2])' (ignored) [$($j.Src)]"); continue }
      $r.Used = $true
    }
    if ($j.Cmd -eq 'MAP') {
      $s = $srcs[$p[1]]; if ($null -eq $s) { Err "MAP: unknown SRC key '$($p[1])' [$($j.Src)]"; continue }
      $sgn = Fld $p 4
      if (($sgn -ne '') -and ($sgn -ne '+') -and ($sgn -ne '-')) { Err "MAP: sign field must be blank, + or - (got '$sgn'; field order is key|src|far|sign|farGroup|srcOcc|farOcc|curCol|priorCol) [$($j.Src)]"; continue }
      if ((((Fld $p 6) -ne '') -and ((Fld $p 6) -notmatch '^\d+$')) -or (((Fld $p 7) -ne '') -and ((Fld $p 7) -notmatch '^\d+$'))) { Err "MAP: srcOcc/farOcc must be numbers (got '$(Fld $p 6)','$(Fld $p 7)') [$($j.Src)]"; continue }
      $so = 1; if ((Fld $p 6) -ne '') { $so = [int]$p[6] }; $fo = 1; if ((Fld $p 7) -ne '') { $fo = [int]$p[7] }
      $sr = Find-SrcRow $s $p[2] $so
      if ($null -eq $sr) { Err "MAP: source row not found '$($p[2])' #$so in $($p[1]) [$($j.Src)]"; continue }
      $fl = Fld $p 3; if ($fl -eq '') { $fl = $p[2] }
      $fr = Find-FarRow $idx $fl (Fld $p 5) $fo $false
      if ($fr -eq 0) { Err "MAP: FAR account not found '$fl' (group '$(Fld $p 5)') for source '$($p[2])' [$($j.Src)]"; continue }
      $sg = 1.0; if ((Fld $p 4) -eq '-') { $sg = -1.0 }
      $rc = $sr.Cur; $rp = $sr.Prior
      if ((Fld $p 8) -ne '') { $rc = Src-Num $s $sr $p[8] }       # optional per-line column override (e.g. total columns)
      if ((Fld $p 9) -ne '') { $rp = Src-Num $s $sr $p[9] }
      $cv = 0.0; if ($null -ne $rc) { $cv = $rc * $sg }
      $pv = 0.0; if ($null -ne $rp) { $pv = $rp * $sg }
      if (-not $pending.ContainsKey($fr)) { $pending[$fr] = @{ Cur = 0.0; Prior = 0.0; N = 0 } }
      $pending[$fr].Cur += $cv; $pending[$fr].Prior += $pv; $pending[$fr].N++
      $sr.Used = $true; $nMap++
      $log.Add(("{0} R{1} '{2}' -> FAR R{3} '{4}' | cur={5} prior={6}{7}" -f $p[1], $sr.Row, $sr.Raw.Trim(), $fr, $fl, $cv, $pv, $(if ($sg -lt 0) { ' (sign -)' } else { '' })))
    }
  }
  $nWrite = 0
  foreach ($fr in ($pending.Keys | Sort-Object)) {
    $cg = $far.Cells.Item($fr, 7); $ck = $far.Cells.Item($fr, 11)
    if ($cg.HasFormula -or $ck.HasFormula) { Err "FAR R$fr is a formula row, cannot write"; continue }
    $cg.Value2 = [double]$pending[$fr].Cur; $ck.Value2 = [double]$pending[$fr].Prior; $nWrite++
    if ($pending[$fr].N -gt 1) { $log.Add("FAR R$fr : $($pending[$fr].N) source rows summed") }
  }
  foreach ($j in $jobs) {
    if ($j.Cmd -ne 'ADJ') { continue }
    $p = $j.P; $o = 1; if ((Fld $p 5) -ne '') { $o = [int]$p[5] }
    $fr = Find-FarRow $idx $p[1] (Fld $p 2) $o $false
    if ($fr -eq 0) { Err "ADJ: FAR account not found '$($p[1])' [$($j.Src)]"; continue }
    if ((Fld $p 3) -ne '') { $far.Cells.Item($fr, 8).Value2 = [double]$p[3] }
    if ((Fld $p 4) -ne '') { $far.Cells.Item($fr, 9).Value2 = [double]$p[4] }
    $log.Add("ADJ FAR R$fr '$($p[1])' Dr=$(Fld $p 3) Cr=$(Fld $p 4)")
  }
  # ACELL|rowLabel|col|value|occ : write an input cell in the analytics block below the body (e.g. opening balances)
  foreach ($j in $jobs) {
    if ($j.Cmd -ne 'ACELL') { continue }
    $p = $j.P; $o = 1; if ((Fld $p 4) -ne '') { $o = [int]$p[4] }
    $L = Norm $p[1]; $n = 0; $hit = 0
    $av = $far.Range($far.Cells.Item($idx.BodyEnd + 1, 1), $far.Cells.Item($idx.LastRow, 8)).Value2
    for ($i = 1; ($i -le ($idx.LastRow - $idx.BodyEnd)) -and ($hit -eq 0); $i++) {
      for ($c = 1; $c -le 8; $c++) { if ((Norm ([string]$av[$i, $c])) -eq $L) { $n++; if ($n -eq $o) { $hit = $idx.BodyEnd + $i }; break } }
    }
    if ($hit -eq 0) { Err "ACELL: analytics row not found '$($p[1])' #$o [$($j.Src)]"; continue }
    $cell = $far.Cells.Item($hit, (ColN $p[2]))
    if ($cell.HasFormula) { Err "ACELL: $($p[2])$hit is a formula cell [$($j.Src)]"; continue }
    $cell.Value2 = [double]((Fld $p 3).Replace(',', ''))
    $log.Add("ACELL R$hit $($p[2]) = $(Fld $p 3)  ('$($p[1])')")
  }
  $xl.Calculation = -4105; $xl.CalculateFull()

  # --- unmapped source rows ----------------------------------------------------
  $nUnm = 0
  foreach ($key in $srcs.Keys) {
    $cnt = @{}
    foreach ($r in $srcs[$key].Rows) {
      $thisOcc = 0
      if ($r.Norm -ne '') { $cnt[$r.Norm] = 1 + [int]$cnt[$r.Norm]; $thisOcc = $cnt[$r.Norm] }
      if ($r.Used) { continue }
      $c = 0.0; if ($null -ne $r.Cur) { $c = $r.Cur }; $pp = 0.0; if ($null -ne $r.Prior) { $pp = $r.Prior }
      if ((($null -eq $r.Cur) -and ($null -eq $r.Prior)) -or (([math]::Abs($c) + [math]::Abs($pp)) -eq 0)) { continue }
      $cand = @(); foreach ($fr in $idx.Rows) { if (($r.Norm -ne '') -and ($fr.F -eq $r.Norm)) { $cand += ("R{0}({1})" -f $fr.Row, $fr.GrpD) } }
      $unm.Add(("UNMAPPED {0} R{1} '{2}' (srcOcc={6}) cur={3} prior={4} | FAR candidates: {5}" -f $key, $r.Row, $r.Raw.Trim(), $c, $pp, $(if ($cand.Count) { $cand -join ', ' } else { 'none' }), $thisOcc))
      $nUnm++
    }
  }

  # --- tie-out -----------------------------------------------------------------
  $nOk = 0; $nDiff = 0
  $tie.Add('result | source label | source cur | FAR cur(J) | diff | source prior | FAR prior(K) | diff')
  foreach ($j in $jobs) {
    if ($j.Cmd -ne 'TIE') { continue }
    $p = $j.P; $s = $srcs[$p[1]]; if ($null -eq $s) { Err "TIE: unknown SRC key '$($p[1])' [$($j.Src)]"; continue }
    $so = 1; if ((Fld $p 7) -ne '') { $so = [int]$p[7] }; $fo = 1; if ((Fld $p 8) -ne '') { $fo = [int]$p[8] }
    $sr = Find-SrcRow $s $p[2] $so
    if ($null -eq $sr) { Err "TIE: source row not found '$($p[2])' [$($j.Src)]"; continue }
    $fl = Fld $p 3; if ($fl -eq '') { $fl = $p[2] }
    $fr = Find-FarRow $idx $fl (Fld $p 4) $fo $true
    if ($fr -eq 0) { Err "TIE: FAR row not found '$fl' [$($j.Src)]"; continue }
    $sc = Src-Num $s $sr (Fld $p 5); $sp = Src-Num $s $sr (Fld $p 6)
    if ($null -eq $sc) { $sc = 0.0 }; if ($null -eq $sp) { $sp = 0.0 }
    $fc = [double]$far.Cells.Item($fr, 10).Value2; $fp = [double]$far.Cells.Item($fr, 11).Value2
    $dc = $fc - $sc; $dp = $fp - $sp
    $ok = ([math]::Abs($dc) -lt 0.5) -and ([math]::Abs($dp) -lt 0.5)
    if ($ok) { $nOk++ } else { $nDiff++ }
    $tie.Add(("{0} | {1} | {2} | {3} | {4} | {5} | {6} | {7}" -f $(if ($ok) { 'OK  ' } else { 'DIFF' }), $p[2], $sc, $fc, $dc, $sp, $fp, $dp))
  }

  $checkLines = Get-FarCheckLines $wb $far
  if ((-not $DryRun) -and (($errors.Count -eq 0) -or $Force)) { $wb.Save(); $saved = $true }
  $wb.Close($false); $wb = $null
  if ($srcWb) { $srcWb.Close($false); $srcWb = $null }
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($srcWb) { try { $srcWb.Close($false) } catch {} }
  $xl.Quit(); [System.GC]::Collect()
}

$enc = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'mapping-log.txt'), ($log -join "`r`n"), $enc)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'unmapped.txt'), ($unm -join "`r`n"), $enc)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'tie-out-auto.txt'), ($tie -join "`r`n"), $enc)
if ($checkLines) { [System.IO.File]::WriteAllText((Join-Path $OutDir 'far-check.txt'), ($checkLines -join "`r`n"), $enc) }

"mapped source rows: $nMap  written FAR rows: $nWrite  unmapped: $nUnm  errors: $($errors.Count)  tie OK/DIFF: $nOk/$nDiff"
foreach ($e in ($errors | Select-Object -First 20)) { "ERROR $e" }
foreach ($u in ($unm | Select-Object -First 20)) { $u }
foreach ($t in $tie) { if ($t -like 'DIFF*') { $t } }
if ($checkLines) { $checkLines | Select-Object -First 6 }
if ($workFile) {
  if ($saved) { Move-Item -LiteralPath $workFile -Destination $File -Force } else { Remove-Item -LiteralPath $workFile -Force -ErrorAction SilentlyContinue }
}
foreach ($l in $log) { if ($l -like 'ADD skipped*') { "WARNING $l" } }
if ($saved) { "SAVED: $File" } else { "NOT SAVED (dry run or errors; an existing -File was left untouched)" }
"reports: $OutDir"
