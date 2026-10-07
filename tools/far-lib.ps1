# Shared helpers for far-tool.ps1 and far-run.ps1 (dot-source this file). ASCII-only on purpose.
# The FAR sheet is always the LAST sheet of the workbook. Columns: C=disclosure acct, D/E/F=labels,
# G=current input, H=Dr, I=Cr, J=adjusted current, K=prior, L/M=variance, P/Q/R=significance, S=comment.

function ColL([int]$n) { $s = ''; while ($n -gt 0) { $m = ($n - 1) % 26; $s = [string][char](65 + $m) + $s; $n = [math]::Floor(($n - 1) / 26) }; $s }
function ColN([string]$l) { $n = 0; foreach ($ch in $l.ToUpper().ToCharArray()) { $n = $n * 26 + ([int]$ch - 64) }; $n }

# patterns built from char codes (keeps this file ASCII-only): roman numerals U+2160-U+216F, fullwidth parens U+FF08/U+FF09
$script:RomanPat = '^[' + [string][char]0x2160 + '-' + [string][char]0x216F + ']+\.'
$script:ParenPat = '[\(\)' + [string][char]0xFF08 + [string][char]0xFF09 + ']'

# Normalize an account label: drop whitespace, leading numbering ("1)", "(1)", "1.", roman numerals), parentheses.
function Norm([string]$s) {
  if ($null -eq $s) { return '' }
  $t = [regex]::Replace($s, '\s', '')
  $t = [regex]::Replace($t, '^[0-9]+[\)\.]', '')
  $t = [regex]::Replace($t, $script:RomanPat, '')
  $t = [regex]::Replace($t, $script:ParenPat, '')
  return $t
}

# Widen SUM(X a:X b) ranges whose end row == endRow so that row endRow+1 is included.
function Extend-Sums($ws, [int]$lastRow, [int]$endRow, [int]$maxCol) {
  if ($lastRow -lt 2) { return 0 }
  $rng = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($lastRow, $maxCol))
  $f = $rng.Formula; $ext = 0
  for ($i = 1; $i -le $lastRow; $i++) { for ($j = 1; $j -le $maxCol; $j++) {
    $x = $f[$i, $j]
    if (($x -isnot [string]) -or ($x.IndexOf('SUM(') -lt 0)) { continue }
    $g = [regex]::Replace($x, 'SUM\((\$?[A-Z]{1,2})(\$?)(\d+):(\$?[A-Z]{1,2})(\$?)(\d+)\)', [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $a = [int]$m.Groups[3].Value; $b = [int]$m.Groups[6].Value
        if (($b -eq $endRow) -and ($a -le $endRow) -and ($m.Groups[1].Value -eq $m.Groups[4].Value)) {
          return 'SUM(' + $m.Groups[1].Value + $m.Groups[2].Value + $m.Groups[3].Value + ':' + $m.Groups[4].Value + $m.Groups[5].Value + ($endRow + 1) + ')'
        }
        return $m.Value })
    if ($g -ne $x) { $ws.Cells.Item($i, $j).Formula = $g; $ext++ }
  } }
  return $ext
}

# Insert a copy of leaf row $n right below it; extend group SUMs here and in linked disclosure sheets.
function Add-FarAccount($wb, $far, [int]$n, [string]$Name, [string]$Gongsi) {
  $msg = New-Object System.Collections.Generic.List[string]
  $far.Rows.Item($n + 1).Insert() | Out-Null
  $far.Rows.Item($n).Copy($far.Rows.Item($n + 1)) | Out-Null
  foreach ($c in 7, 8, 9, 11) { $cell = $far.Cells.Item($n + 1, $c); if (-not $cell.HasFormula) { $cell.ClearContents() | Out-Null } }
  foreach ($c in 17, 18, 19) { $cell = $far.Cells.Item($n + 1, $c); if (-not $cell.HasFormula) { $cell.ClearContents() | Out-Null } }
  $labelCol = 0
  foreach ($c in 6, 5, 4) { if ([string]$far.Cells.Item($n, $c).Text -ne '') { $labelCol = $c; break } }
  if ($labelCol -eq 0) { throw "row $n has no label in D:F - is it a leaf account row?" }
  $far.Cells.Item($n + 1, $labelCol).Value2 = $Name
  if ($Gongsi -ne '') { $far.Cells.Item($n + 1, 3).Value2 = $Gongsi }
  elseif ([string]$far.Cells.Item($n, 3).Text -eq [string]$far.Cells.Item($n, $labelCol).Text) { $far.Cells.Item($n + 1, 3).Value2 = $Name }
  else { $far.Cells.Item($n + 1, 3).ClearContents() | Out-Null; $msg.Add('WARNING: column C (disclosure account) left blank - give a disclosure account') }
  $e1 = Extend-Sums $far ($n - 1) $n 14
  $msg.Add("FAR: inserted row $($n + 1) = $Name (extended $e1 SUM range(s))")
  $pat = '^=FAR!\$?[A-Z]{1,2}\$?' + $n + '$'
  $linked = 0
  for ($si = 1; $si -lt $wb.Worksheets.Count; $si++) {
    $ws = $wb.Worksheets.Item($si); $ur = $ws.UsedRange
    if (($ur.Rows.Count -lt 2) -and ($ur.Columns.Count -lt 2)) { continue }
    $f = $ur.Formula; $found = 0
    $nr = $ur.Rows.Count; $nc = [math]::Min(12, $ur.Columns.Count)
    for ($i = 1; ($i -le $nr) -and ($found -eq 0); $i++) { for ($j = 1; $j -le $nc; $j++) {
      $x = $f[$i, $j]; if (($x -is [string]) -and ($x -match $pat)) { $found = $ur.Row + $i - 1; break } } }
    if ($found -gt 0) {
      $ws.Rows.Item($found + 1).Insert() | Out-Null
      $ws.Rows.Item($found).Copy($ws.Rows.Item($found + 1)) | Out-Null
      for ($c = 1; $c -le 2; $c++) { $cell = $ws.Cells.Item($found + 1, $c); if ((-not $cell.HasFormula) -and ([string]$cell.Text -ne '')) { $cell.Value2 = $Name } }
      $e2 = Extend-Sums $ws ($found - 1) $found 12
      $msg.Add("sheet $si : inserted disclosure row $($found + 1) (extended $e2 SUM range(s))")
      $linked++
    }
  }
  if ($linked -eq 0) { $msg.Add('no disclosure sheet links to that row (SUMIF-based master: column C routes it)') }
  return $msg
}

# Insert a line into a disclosure sheet of a SUMIF-style master (the line takes its amount from FAR column C by the text in
# its own column A). Copies line $After (matched on column A, $Occ-th match) one row down, writes $New in column A, clears the
# note column and typed-in constants, and widens SUM ranges that ended on $After. Masters whose subtotals are single-cell
# formulas (not SUM ranges) cannot take the new line automatically: that is reported as a WARNING.
# Returns @{ Row; Msg; Err; Skipped }  (Row = 0 when nothing was inserted).
function Add-DisclosureRow($ws, [string]$After, [string]$New, [int]$Occ) {
  $msg = New-Object System.Collections.Generic.List[string]
  $res = @{ Row = 0; Msg = $msg; Err = ''; Skipped = $false }
  if ($Occ -lt 1) { $Occ = 1 }
  $ur = $ws.UsedRange; $r0 = $ur.Row; $nr = $ur.Rows.Count; $c0 = $ur.Column; $nc = $ur.Columns.Count
  if ($nr -lt 2) { $res.Err = 'sheet has no lines'; return $res }
  $colA = $ws.Range($ws.Cells.Item($r0, 1), $ws.Cells.Item($r0 + $nr - 1, 1)).Value2
  $tAfter = Norm-Loose $After; $tNew = Norm-Loose $New; $found = 0; $seen = 0
  for ($i = 1; $i -le $nr; $i++) {
    $t = Norm-Loose ([string]$colA[$i, 1])
    if ($t -eq '') { continue }
    if ($t -eq $tNew) { $res.Skipped = $true; $msg.Add("already exists (row $($r0 + $i - 1)): $New"); return $res }
    if (($t -eq $tAfter) -and ($found -eq 0)) { $seen++; if ($seen -eq $Occ) { $found = $r0 + $i - 1 } }
  }
  if ($found -eq 0) { $res.Err = "anchor line not found in column A: '$After' (occurrence $Occ)"; return $res }
  $n = $found
  $ws.Rows.Item($n + 1).Insert() | Out-Null
  $ws.Rows.Item($n).Copy($ws.Rows.Item($n + 1)) | Out-Null
  $maxCol = [math]::Min(20, $c0 + $nc - 1)
  for ($c = 2; $c -le $maxCol; $c++) { $cell = $ws.Cells.Item($n + 1, $c); if (-not $cell.HasFormula) { $cell.ClearContents() | Out-Null } }
  $ws.Cells.Item($n + 1, 1).Value2 = $New
  $last = $r0 + $nr
  $e = Extend-Sums $ws $last $n $maxCol
  $f = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($last, $maxCol)).Formula
  $inSum = 0
  for ($i = 1; $i -le $last; $i++) { for ($j = 1; $j -le $maxCol; $j++) {
    $x = $f[$i, $j]; if (($x -isnot [string]) -or ($x.IndexOf('SUM(') -lt 0)) { continue }
    foreach ($m in [regex]::Matches($x, 'SUM\(\$?([A-Z]{1,2})\$?(\d+):\$?([A-Z]{1,2})\$?(\d+)\)')) {
      if (($m.Groups[1].Value -eq $m.Groups[3].Value) -and ([int]$m.Groups[2].Value -le ($n + 1)) -and ([int]$m.Groups[4].Value -ge ($n + 1))) { $inSum++ }
    }
  } }
  $msg.Add("inserted row $($n + 1) = $New (below row $n; extended $e SUM range(s); $inSum SUM range(s) now contain it)")
  if ($inSum -eq 0) { $msg.Add('WARNING: the new line is inside no SUM range - this sheet totals with single-cell formulas; add the line to its subtotal by hand') }
  $res.Row = $n + 1
  return $res
}

# Index of FAR body rows: @{Row; D; E; F; GrpD; GrpE} with normalized labels. Body ends at the last boolean check row in J.
function Build-FarIndex($far) {
  $ur = $far.UsedRange; $lastRow = $ur.Row + $ur.Rows.Count - 1
  $jf = $far.Range($far.Cells.Item(13, 10), $far.Cells.Item($lastRow, 10)).Formula
  $bodyEnd = 13
  for ($i = 1; $i -le ($lastRow - 12); $i++) { $x = $jf[$i, 1]; if (($x -is [string]) -and ($x -match '^=J\d+=J\d+$')) { $bodyEnd = 12 + $i } }
  $v = $far.Range($far.Cells.Item(13, 4), $far.Cells.Item($bodyEnd, 6)).Value2
  $rows = New-Object System.Collections.Generic.List[object]
  $gD = ''; $gE = ''
  for ($i = 1; $i -le ($bodyEnd - 12); $i++) {
    $d = Norm ([string]$v[$i, 1]); $e = Norm ([string]$v[$i, 2]); $f = Norm ([string]$v[$i, 3])
    if ($d -ne '') { $gD = $d; $gE = '' }
    if ($e -ne '') { $gE = $e }
    $rows.Add(@{ Row = 12 + $i; D = $d; E = $e; F = $f; GrpD = $gD; GrpE = $gE })
  }
  return @{ Rows = $rows; BodyEnd = $bodyEnd; LastRow = $lastRow }
}

# Find a FAR row by label (+ optional group, nth occurrence). $any=false => leaf account rows (label in F) only.
function Find-FarRow($idx, [string]$label, [string]$group, [int]$occ, [bool]$any) {
  $L = Norm $label; $G = Norm $group; if ($occ -lt 1) { $occ = 1 }; $n = 0
  foreach ($r in $idx.Rows) {
    $hit = $false
    if ($any) { $hit = (($r.D -eq $L) -or ($r.E -eq $L) -or ($r.F -eq $L)) } else { $hit = (($r.F -ne '') -and ($r.F -eq $L)) }
    if (-not $hit) { continue }
    if (($G -ne '') -and ($r.GrpD -ne $G) -and ($r.GrpE -ne $G)) { continue }
    $n++; if ($n -eq $occ) { return [int]$r.Row }
  }
  return 0
}

# Check report: FALSE checks, errors, period inputs, materiality, placeholders, headline rows, comments, analytics block.
function Get-FarCheckLines($wb, $far) {
  $out = New-Object System.Collections.Generic.List[string]
  $wb.Application.CalculateFull()
  $out.Add(("period months: current=[{0}] prior=[{1}]  alert=[{2}]" -f $far.Range('P5').Value2, $far.Range('P6').Value2, $far.Range('Q5').Text))
  $out.Add(("company=[{0}]  current end=[{1}]  prior end=[{2}]" -f $far.Range('G5').Text, $far.Range('G12').Text, $far.Range('K12').Text))
  $out.Add(("materiality K8=[{0}] L8=[{1}]" -f $far.Range('K8').Text, $far.Range('L8').Text))
  $bad = New-Object System.Collections.Generic.List[string]; $errs = @{}; $ph = @{}; $phAddr = New-Object System.Collections.Generic.List[string]
  foreach ($ws in $wb.Worksheets) {
    $ur = $ws.UsedRange; $v = $ur.Value2; if ($v -isnot [object[,]]) { continue }
    $a1 = $v.GetLowerBound(0); $a2 = $v.GetLowerBound(1)
    for ($i = 0; $i -lt $v.GetLength(0); $i++) { for ($j = 0; $j -lt $v.GetLength(1); $j++) {
      $x = $v[($a1 + $i), ($a2 + $j)]
      $addr = "{0}!{1}{2}" -f $ws.Index, (ColL ($ur.Column + $j)), ($ur.Row + $i)
      if (($x -is [bool]) -and (-not $x)) { $bad.Add("FALSE $addr") }
      if (($x -is [string]) -and ($x -match '^\[[^\]]+\]$')) { $ph[$ws.Index] = 1 + [int]$ph[$ws.Index]; $phAddr.Add("$addr='$x'") }
      if ($x -is [int] -and $x -lt -2146826000) {
        $k = switch ($x) { -2146826281 { 'DIV0' } -2146826265 { 'REF' } -2146826259 { 'NAME' } -2146826246 { 'NA' } -2146826273 { 'VALUE' } default { 'ERR' } }
        if (-not $errs.ContainsKey($k)) { $errs[$k] = New-Object System.Collections.Generic.List[string] }
        $errs[$k].Add($addr)
      }
    } }
  }
  $out.Add(("FALSE checks: {0}  {1}" -f $bad.Count, (($bad | Select-Object -First 15) -join ', ')))
  foreach ($k in $errs.Keys) { $out.Add(("error {0}: {1}  e.g. {2}" -f $k, $errs[$k].Count, (($errs[$k] | Select-Object -First 8) -join ', '))) }
  foreach ($k in $ph.Keys) { $out.Add(("bracket placeholders (e.g. [name]) remaining on sheet {0}: {1}" -f $k, $ph[$k])) }
  if ($phAddr.Count -gt 0) { $out.Add('  placeholder cells: ' + (($phAddr | Select-Object -First 10) -join ', ')) }
  $idx = Build-FarIndex $far; $mfgEnd = $idx.BodyEnd; $lastRow = $idx.LastRow
  $out.Add('--- headline rows (label | G current | J adjusted | K prior | L variance)')
  $blk = $far.Range($far.Cells.Item(13, 1), $far.Cells.Item($mfgEnd, 19)); $bv = $blk.Value2
  for ($i = 1; $i -le ($mfgEnd - 12); $i++) {
    $lab = [string]$bv[$i, 4]; if ($lab -eq '') { continue }
    $r = 12 + $i
    $out.Add(("R{0} {1} | {2} | {3} | {4} | {5}" -f $r, $lab, $far.Cells.Item($r, 7).Text, $far.Cells.Item($r, 10).Text, $far.Cells.Item($r, 11).Text, $far.Cells.Item($r, 12).Text))
  }
  $out.Add('--- body comments (S column) and significance flags (P/Q/R)')
  for ($i = 1; $i -le ($mfgEnd - 12); $i++) {
    $s = [string]$bv[$i, 19]; $p = [string]$bv[$i, 16]; $q = [string]$bv[$i, 17]; $rr = [string]$bv[$i, 18]
    if (($s.Trim() -ne '') -or ($q.Trim() -ne '')) { $out.Add(("R{0} {1} | P={2} Q={3} R={4} | S={5}" -f (12 + $i), [string]$bv[$i, 6], $p, $q, $rr, $s.Trim())) }
  }
  $out.Add('--- analytics block (all non-empty cells)')
  $av = $far.Range($far.Cells.Item($mfgEnd + 1, 1), $far.Cells.Item($lastRow, 23)).Value2
  for ($i = 1; $i -le ($lastRow - $mfgEnd); $i++) {
    $parts = @()
    for ($j = 1; $j -le 23; $j++) {
      $x = $av[$i, $j]; if ($null -eq $x) { continue }
      $t = [string]$far.Cells.Item($mfgEnd + $i, $j).Text
      if ($t.Trim() -ne '') { $parts += ("{0}={1}" -f (ColL $j), $t.Trim()) }
    }
    if ($parts.Count -gt 0) { $out.Add(("R{0} | {1}" -f ($mfgEnd + $i), ($parts -join ' | '))) }
  }
  return $out
}

# --- unit helpers (Korean unit words are built from char codes to keep this file ASCII-only) ---------------
$script:UK_DAN = [string][char]0xB2E8 + [string][char]0xC704                                  # "unit" marker word
$script:UK_WON = [string][char]0xC6D0
$script:UK_CHEON = [string][char]0xCC9C + $script:UK_WON                                       # thousand won
$script:UK_BAEKMAN = [string][char]0xBC31 + [string][char]0xB9CC + $script:UK_WON              # million won
$script:UK_EOK = [string][char]0xC5B5 + $script:UK_WON                                         # 100 million won
$script:UnitWordPat = '(' + $script:UK_EOK + '|' + $script:UK_BAEKMAN + '|' + $script:UK_CHEON + '|' + $script:UK_WON + ')'
$script:UnitHeaderPat = $script:UK_DAN + '[:' + [string][char]0xFF1A + '\(\[]*' + $script:UnitWordPat

# Multiplier that converts SOURCE amounts to won, from a UNIT token: won / thousand-won / million-won (Korean or
# English words) or a plain number such as 1000. Returns $null when the token is not understood.
function Parse-UnitMultiplier([string]$t) {
  if ([string]::IsNullOrWhiteSpace($t)) { return $null }
  $s = ([regex]::Replace($t, '[\s\(\)\[\]:,]', '')).ToLower()
  if ($s -match '^\d+(\.\d+)?$') { $d = [double]$s; if ($d -gt 0) { return $d } else { return $null } }
  if ($s -eq $script:UK_EOK) { return 100000000.0 }
  if ($s -eq $script:UK_BAEKMAN -or $s -eq 'million' -or $s -eq 'millions') { return 1000000.0 }
  if ($s -eq $script:UK_CHEON -or $s -eq 'thousand' -or $s -eq 'thousands') { return 1000.0 }
  if ($s -eq $script:UK_WON -or $s -eq 'won' -or $s -eq 'krw') { return 1.0 }
  return $null
}

# Unit stated in a source header cell such as "(unit: <won word>)": returns a multiplier or $null if the text
# is not a unit header. Only cells that carry the "unit" marker word are considered.
function Find-UnitInText([string]$t) {
  if ([string]::IsNullOrWhiteSpace($t) -or ($t.Length -gt 60)) { return $null }
  $s = [regex]::Replace($t, '\s', '')
  $m = [regex]::Match($s, $script:UnitHeaderPat)
  if (-not $m.Success) { return $null }
  return (Parse-UnitMultiplier $m.Groups[1].Value)
}

# SAVE GATE: decides whether a FAR run may be saved. Pure function (no Excel access) so it can be tested alone.
# $jobs/$srcs are the job lines and the loaded source sheets of far-run.ps1; $checkLines is Get-FarCheckLines output.
# Returns @{ Gate = failures (block the save); Warn = warnings (reported only) }.
function Get-FarSaveGate($jobs, $srcs, [bool]$hasSource, [int]$nUnm, [int]$nOk, [int]$nDiff, $checkLines, [string]$unitNote, [string]$reqFile) {
  $gate = New-Object System.Collections.Generic.List[string]
  $warn = New-Object System.Collections.Generic.List[string]
  if ($nUnm -gt 0) { $gate.Add("unmapped source rows with amounts: $nUnm (see unmapped.txt)") }
  if ($nDiff -gt 0) { $gate.Add("tie-out DIFF lines: $nDiff (see tie-out-auto.txt)") }
  if ($hasSource -and (($nOk + $nDiff) -eq 0)) { $gate.Add('no TIE line was evaluated: add TIE lines for the source totals') }
  if ($hasSource) {
    if (-not (Test-Path -LiteralPath $reqFile)) { $gate.Add('required-totals list not found: tools\far-required-totals.txt') }
    else {
      $tied = @{}
      foreach ($j in $jobs) { if ($j.Cmd -eq 'TIE') { $lbl = ''; if ($j.P.Count -gt 2) { $lbl = [string]$j.P[2] }; $tied[(Norm-Loose $lbl)] = 1 } }
      foreach ($line in (Get-Content -LiteralPath $reqFile -Encoding UTF8)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        $alts = @($line.Split('/') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
        $present = ''; $hasTie = $false
        foreach ($a in $alts) {
          $na = Norm-Loose $a
          if ($tied.ContainsKey($na)) { $hasTie = $true }
          foreach ($key in $srcs.Keys) {
            foreach ($r in $srcs[$key].Rows) { if (((Norm-Loose $r.Raw) -eq $na) -and ($r.Any -or ($null -ne $r.Cur) -or ($null -ne $r.Prior))) { if ($present -eq '') { $present = "$a (source $key R$($r.Row))" }; break } }
          }
        }
        if (($present -ne '') -and (-not $hasTie)) { $gate.Add("required total exists in the source but has no TIE line: $present") }
      }
    }
  }
  $nFalse = 0; $nErrCell = 0; $nDiv0 = 0
  foreach ($cl in $checkLines) {
    if ($cl -match '^FALSE checks:\s+(\d+)') { $nFalse = [int]$Matches[1] }
    elseif ($cl -match '^error DIV0:\s+(\d+)') { $nDiv0 += [int]$Matches[1] }
    elseif ($cl -match '^error \w+:\s+(\d+)') { $nErrCell += [int]$Matches[1] }
  }
  if ($nFalse -gt 0) { $gate.Add("far-check FALSE checks: $nFalse (see far-check.txt)") }
  if ($nErrCell -gt 0) { $gate.Add("far-check error cells (#REF!/#NAME?/#VALUE!/#N/A): $nErrCell (see far-check.txt)") }
  if ($nDiv0 -gt 0) { $warn.Add("far-check #DIV/0! cells: $nDiv0 - confirm each is a legitimate zero denominator (e.g. missing opening balances)") }
  if (($unitNote -like 'UNIT declared by the job only*') -or ($unitNote -like 'UNIT assumed won*')) { $warn.Add($unitNote) }
  return @{ Gate = $gate; Warn = $warn }
}

# UNIT resolution. The FAR master is in won. The unit of the SOURCE amounts is taken from the unit header found in
# the first rows of each source sheet ("(unit: ...)"); with no header it is assumed to be won. An optional UNIT job line
# may state the unit explicitly (for a source known to be in thousands that carries no header); it must not conflict
# with a header. Source sheets that state different units, or one sheet that states two, are an error.
# Pure function (no Excel access). Returns @{ Mult; Tok; Note; Errors }.
function Resolve-FarUnit($jobs, $srcs, [bool]$hasSource) {
  $errs = New-Object System.Collections.Generic.List[string]
  $declMult = $null; $tok = ''
  $seen = @{}
  foreach ($j in $jobs) {
    if ($j.Cmd -ne 'UNIT') { continue }
    $t = ''; if ($j.P.Count -gt 1) { $t = [string]$j.P[1] }
    $mm = Parse-UnitMultiplier $t
    if ($null -eq $mm) { $errs.Add("UNIT: not understood '$t' (use won / thousand / million, the Korean unit words, or a number) [$($j.Src)]"); continue }
    $seen[[string]$mm] = $t; $declMult = [double]$mm; $tok = $t
  }
  if ($seen.Count -gt 1) { $errs.Add("UNIT: declared more than once with different values ($($seen.Values -join ', '))") }

  $found = @{}      # multiplier -> 'sheet KEY: header text'
  foreach ($key in $srcs.Keys) {
    $sv = $srcs[$key].V
    if ($sv -isnot [object[,]]) { continue }
    $l1 = $sv.GetLowerBound(0); $l2 = $sv.GetLowerBound(1)
    $maxR = [math]::Min(15, $sv.GetLength(0))
    $perSheet = @{}
    for ($i = 0; $i -lt $maxR; $i++) { for ($c = 0; $c -lt $sv.GetLength(1); $c++) {
      $x = $sv[($l1 + $i), ($l2 + $c)]
      if ($x -isnot [string]) { continue }
      $fm = Find-UnitInText $x
      if ($null -eq $fm) { continue }
      $perSheet[[string]$fm] = $x.Trim()
      if (-not $found.ContainsKey([string]$fm)) { $found[[string]$fm] = "sheet $key '$($x.Trim())'" }
    } }
    if ($perSheet.Count -gt 1) { $errs.Add("UNIT: source sheet $key states more than one unit ($($perSheet.Values -join ' / ')); confirm the unit with the user") }
  }
  if ($found.Count -gt 1) { $errs.Add("UNIT: source sheets state different units ($($found.Values -join '; ')); confirm the unit with the user and convert before running") }

  $mult = 1.0; $note = ''
  if ($found.Count -eq 1) {
    $fv = [double]@($found.Keys)[0]; $fdesc = @($found.Values)[0]
    if (($null -ne $declMult) -and ($declMult -ne $fv)) { $errs.Add("UNIT: job declares '$tok' (x$declMult) but the source says $fdesc (x$fv)") }
    $mult = $fv
    if ($hasSource) { $note = "UNIT from the source header: x$fv ($fdesc)" }
  } elseif ($null -ne $declMult) {
    $mult = $declMult
    if ($hasSource) { $note = "UNIT declared by the job only ('$tok', x$declMult): no unit header found in the first rows of the source sheets, so it could not be cross-checked" }
  } else {
    if ($hasSource) { $note = 'UNIT assumed won (x1): no unit header found in the first rows of the source sheets and no UNIT line in the job. Check the amount scale against source-dump.txt' }
  }
  return @{ Mult = $mult; Tok = $tok; Note = $note; Errors = $errs }
}

function ToNum($x) {
  if ($null -eq $x) { return $null }
  if ($x -is [double]) { return [double]$x }
  if (($x -is [int]) -or ($x -is [long]) -or ($x -is [decimal]) -or ($x -is [single])) { return [double]$x }
  if ($x -is [string]) { $t = $x.Replace(',', '').Trim(); $d = 0.0; if ([double]::TryParse($t, [ref]$d)) { return $d } }
  return $null
}

# Build the row list of one source sheet from its UsedRange values ($v is a 1-based object[,] as returned by Excel).
# Cur/Prior come from the SRC current/prior columns; Any = the row has a number in ANY column right of the label
# columns (grand totals often sit in other columns than the account lines, e.g. E/G vs D/F).
function New-SourceRows($v, [int]$r0, [int]$c0, [int]$lc1, [int]$lc2, [bool]$deep, [int]$cc, [int]$pc, $sh) {
  $rows = New-Object System.Collections.Generic.List[object]
  if ($v -is [object[,]]) {
    $nr = $v.GetLength(0); $nc = $v.GetLength(1)
    for ($i = 1; $i -le $nr; $i++) {
      $r = $r0 + $i - 1; $raw = ''
      for ($c = $lc1; $c -le $lc2; $c++) { $ci = $c - $c0 + 1; if (($ci -ge 1) -and ($ci -le $nc)) { $x = $v[$i, $ci]; if (($x -is [string]) -and ($x.Trim() -ne '')) { $raw = $x; if (-not $deep) { break } } } }
      $cv = $null; $pv = $null
      $ci = $cc - $c0 + 1; if (($ci -ge 1) -and ($ci -le $nc)) { $cv = ToNum $v[$i, $ci] }
      $pi2 = $pc - $c0 + 1; if (($pi2 -ge 1) -and ($pi2 -le $nc)) { $pv = ToNum $v[$i, $pi2] }
      $any = $false
      for ($c = $lc2 + 1; $c -le ($c0 + $nc - 1); $c++) { $ci = $c - $c0 + 1; if ($null -ne (ToNum $v[$i, $ci])) { $any = $true; break } }
      $rows.Add(@{ Row = $r; Raw = $raw; Norm = (Norm $raw); Cur = $cv; Prior = $pv; Any = $any; Used = $false; Sheet = $sh })
    }
  }
  return ,$rows
}

# Looser label match used only by the save gate: Norm plus a leading lowercase roman numeral ("iii.") is dropped.
$script:RomanLowerPat = '^[' + [string][char]0x2170 + '-' + [string][char]0x217F + ']+\.'
function Norm-Loose([string]$s) { return [regex]::Replace((Norm $s), $script:RomanLowerPat, '') }


# --- zero-row pruning (far-run.ps1 -Prune) ----------------------------------------------------------------------
# Row references of a formula as @{Sheet; Lo; Hi} (cells and ranges; whole-column references have no row and are not
# reported; names followed by "(" such as LOG10( are functions, not cells). $curSheet = the sheet the formula lives on.
function Get-FormulaRowRefs([string]$formula, [string]$curSheet) {
  $out = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrEmpty($formula) -or ($formula[0] -ne '=')) { return ,$out }
  $pat = "(?<![A-Za-z0-9_.])(?:(?<sh>'[^']+'|[^\s!'(),:;=<>&^+\-*/]+)!)?\`$?[A-Z]{1,3}\`$?(?<r1>\d+)(?::\`$?[A-Z]{1,3}\`$?(?<r2>\d+))?(?![A-Za-z0-9_(])"
  foreach ($m in [regex]::Matches($formula, $pat)) {
    $sh = $curSheet; if ($m.Groups['sh'].Success) { $sh = $m.Groups['sh'].Value.Trim("'") }
    $lo = [int]$m.Groups['r1'].Value; $hi = $lo; if ($m.Groups['r2'].Success) { $hi = [int]$m.Groups['r2'].Value }
    if ($hi -lt $lo) { $t = $lo; $lo = $hi; $hi = $t }
    $out.Add(@{ Sheet = $sh; Lo = $lo; Hi = $hi })
  }
  return ,$out
}

# Scan all formula cells of the workbook. $cells = list of @{Sheet; SheetIndex; Row; Col; F}; $farName = name of the FAR
# sheet; $leafRows = row numbers of the FAR account rows. Returns:
#   Protect : leaf row -> 1 when some formula other than its own row, a plain group SUM or a disclosure link uses it
#   Groups  : the plain SUM ranges on the FAR sheet (@{Lo; Hi}), so a group is never emptied completely
#   Links   : leaf row -> list of @{SheetIndex; Row} disclosure-sheet rows that are plain links (=FAR!J16) to it
function Get-FarFormulaScan($cells, [string]$farName, $leafRows) {
  $leaf = @{}; foreach ($r in $leafRows) { $leaf[[int]$r] = 1 }
  $protect = @{}; $links = @{}; $groups = New-Object System.Collections.Generic.List[object]; $seenG = @{}
  foreach ($c in $cells) {
    $f = [string]$c.F
    if ([string]::IsNullOrEmpty($f) -or ($f[0] -ne '=')) { continue }
    $onFar = ($c.Sheet -eq $farName)
    if ($onFar) {
      $m = [regex]::Match($f, '^=SUM\(\$?([A-Z]{1,2})\$?(\d+):\$?([A-Z]{1,2})\$?(\d+)\)$')
      if ($m.Success -and ($m.Groups[1].Value -eq $m.Groups[3].Value)) {
        $lo = [int]$m.Groups[2].Value; $hi = [int]$m.Groups[4].Value
        if (-not $seenG.ContainsKey("$lo-$hi")) { $seenG["$lo-$hi"] = 1; $groups.Add(@{ Lo = $lo; Hi = $hi }) }
        continue
      }
    } else {
      $m = [regex]::Match($f, "^='?" + [regex]::Escape($farName) + "'?!\`$?[A-Z]{1,2}\`$?(\d+)$")
      if ($m.Success) {
        $n = [int]$m.Groups[1].Value
        if (-not $links.ContainsKey($n)) { $links[$n] = New-Object System.Collections.Generic.List[object] }
        # a disclosure row links the current (J) and the prior (K) column: record each sheet row only once
        $dup = $false; foreach ($l in $links[$n]) { if (($l.SheetIndex -eq $c.SheetIndex) -and ($l.Row -eq $c.Row)) { $dup = $true } }
        if (-not $dup) { $links[$n].Add(@{ SheetIndex = $c.SheetIndex; Row = $c.Row }) }
        continue
      }
    }
    foreach ($ref in (Get-FormulaRowRefs $f $c.Sheet)) {
      if ($ref.Sheet -ne $farName) { continue }
      for ($n = $ref.Lo; $n -le $ref.Hi; $n++) {
        if (-not $leaf.ContainsKey($n)) { continue }
        if ($onFar -and ($c.Row -eq $n)) { continue }       # a row's own formulas (J = G + H - I, variance, ...)
        $protect[$n] = 1
      }
    }
  }
  return @{ Protect = $protect; Groups = $groups; Links = $links }
}

# Decide which account rows to delete. $rows = list of @{Row; Label; Amount; Comment} for the FAR account rows (Amount =
# current, prior or Dr/Cr non-zero; Comment = a typed value in the judgement/comment columns). Only rows with no amount,
# no comment, no outside formula reference and not the last row of a SUM group are deleted. Pure function.
# Returns @{ Delete = row numbers, highest first; Kept = lines "R<row> <label>: <reason>" for the zero rows that stay }.
function Get-FarPrunePlan($rows, $protect, $groups) {
  $del = @{}; $kept = New-Object System.Collections.Generic.List[string]; $byRow = @{}
  foreach ($r in $rows) {
    $byRow[[int]$r.Row] = $r
    if ($r.Amount -or $r.Comment) { continue }
    if ($protect.ContainsKey([int]$r.Row)) { $kept.Add("R$($r.Row) $($r.Label): kept - used by an analysis/check formula"); continue }
    $del[[int]$r.Row] = 1
  }
  foreach ($g in $groups) {
    $inG = @($rows | Where-Object { ($_.Row -ge $g.Lo) -and ($_.Row -le $g.Hi) } | ForEach-Object { [int]$_.Row } | Sort-Object)
    if ($inG.Count -eq 0) { continue }
    $left = @($inG | Where-Object { -not $del.ContainsKey($_) })
    if ($left.Count -eq 0) { $keep = $inG[0]; $del.Remove($keep); $kept.Add("R$keep $($byRow[$keep].Label): kept - last account row of its group") }
  }
  $delRows = @($del.Keys | ForEach-Object { [int]$_ } | Sort-Object -Descending)
  return @{ Delete = $delRows; Kept = $kept }
}

# Delete the zero account rows of the FAR sheet (and their linked disclosure rows). Needs the open workbook and the
# Build-FarIndex result. Returns @{ Count; Log } - Log lists every deleted and every kept zero row.
function Invoke-FarPrune($wb, $far, $idx) {
  $farName = [string]$far.Name
  $cells = New-Object System.Collections.Generic.List[object]
  for ($si = 1; $si -le $wb.Worksheets.Count; $si++) {
    $ws = $wb.Worksheets.Item($si); $ur = $ws.UsedRange; $fm = $ur.Formula
    if ($fm -isnot [object[,]]) { continue }
    $l1 = $fm.GetLowerBound(0); $l2 = $fm.GetLowerBound(1)
    for ($i = 0; $i -lt $fm.GetLength(0); $i++) { for ($j = 0; $j -lt $fm.GetLength(1); $j++) {
      $x = $fm[($l1 + $i), ($l2 + $j)]
      if (($x -is [string]) -and ($x.Length -gt 1) -and ($x[0] -eq '=')) { $cells.Add(@{ Sheet = [string]$ws.Name; SheetIndex = $si; Row = ($ur.Row + $i); Col = ($ur.Column + $j); F = $x }) }
    } }
  }
  $leafRows = @($idx.Rows | Where-Object { $_.F -ne '' } | ForEach-Object { [int]$_.Row })
  $scan = Get-FarFormulaScan $cells $farName $leafRows
  $first = 13; $blkV = $far.Range($far.Cells.Item($first, 1), $far.Cells.Item($idx.BodyEnd, 19)).Value2
  $blkF = $far.Range($far.Cells.Item($first, 1), $far.Cells.Item($idx.BodyEnd, 19)).Formula
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($r in $idx.Rows) {
    if ($r.F -eq '') { continue }
    $k = $r.Row - $first + 1
    $amt = $false
    foreach ($c in 7, 8, 9, 11) { $x = ToNum $blkV[$k, $c]; if (($null -ne $x) -and ([math]::Abs($x) -gt 0)) { $amt = $true } }
    $com = $false
    foreach ($c in 17, 18, 19) { $x = $blkF[$k, $c]; if (($x -is [string]) -and ($x.Trim() -ne '') -and ($x[0] -ne '=')) { $com = $true } }
    $rows.Add(@{ Row = [int]$r.Row; Label = ([string]$blkV[$k, 6]).Trim(); Amount = $amt; Comment = $com })
  }
  $plan = Get-FarPrunePlan $rows $scan.Protect $scan.Groups
  $log = New-Object System.Collections.Generic.List[string]
  $bySheet = @{}
  foreach ($n in $plan.Delete) { if ($scan.Links.ContainsKey($n)) { foreach ($l in $scan.Links[$n]) { if (-not $bySheet.ContainsKey($l.SheetIndex)) { $bySheet[$l.SheetIndex] = New-Object System.Collections.Generic.List[int] }; $bySheet[$l.SheetIndex].Add([int]$l.Row) } } }
  foreach ($si in $bySheet.Keys) { foreach ($rw in ($bySheet[$si] | Sort-Object -Descending -Unique)) { $wb.Worksheets.Item($si).Rows.Item($rw).Delete() | Out-Null } }
  $label = @{}; foreach ($r in $rows) { $label[[int]$r.Row] = $r.Label }
  foreach ($n in $plan.Delete) { $far.Rows.Item($n).Delete() | Out-Null; $log.Add("DELETED R$n $($label[$n])") }
  foreach ($k in $plan.Kept) { $log.Add("KEPT $k") }
  $wb.Application.CalculateFull()
  return @{ Count = $plan.Delete.Count; Log = $log }
}

# Variance report on the finished workbook: leaf account rows whose current (J) vs prior (K) change needs an explanation.
# Flags: NEW (prior 0, current not), GONE (current 0, prior not), SIGN (sign flipped), BIG (|change| >= L8 performance materiality).
# Returns @{ Lines; Flagged; Missing } ; Missing = flagged rows whose comment cell S is empty or still a placeholder.
function Get-FarVariance($far) {
  $idx = Build-FarIndex $far
  $thr = 0.0; $t = $far.Range('L8').Value2; if ($t -is [double]) { $thr = [math]::Abs($t) }
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("threshold (L8) = $thr   flags: NEW GONE SIGN BIG")
  $lines.Add('row | account | prior(K) | current(J) | change | flags | comment(S)')
  $flagged = 0; $missing = 0
  $blk = $far.Range($far.Cells.Item(13, 1), $far.Cells.Item($idx.BodyEnd, 19)).Value2
  foreach ($r in $idx.Rows) {
    if ($r.F -eq '') { continue }
    $i = $r.Row - 12
    $cur = ToNum $blk[$i, 10]; $pri = ToNum $blk[$i, 11]
    if ($null -eq $cur) { $cur = 0.0 }; if ($null -eq $pri) { $pri = 0.0 }
    $d = $cur - $pri; $fl = @()
    if (($pri -eq 0) -and ($cur -ne 0)) { $fl += 'NEW' }
    if (($cur -eq 0) -and ($pri -ne 0)) { $fl += 'GONE' }
    if (($cur * $pri) -lt 0) { $fl += 'SIGN' }
    if (($thr -gt 0) -and ([math]::Abs($d) -ge $thr)) { $fl += 'BIG' }
    if ($fl.Count -eq 0) { continue }
    $flagged++
    $cm = ([string]$blk[$i, 19]).Trim()
    $bad = ($cm -eq '') -or ($cm -match '<comment>')
    if ($bad) { $missing++ }
    $lines.Add(("R{0} | {1} | {2} | {3} | {4} | {5} | {6}" -f $r.Row, [string]$blk[$i, 6], $pri, $cur, $d, ($fl -join ','), $(if ($bad) { '** NO COMMENT **' } else { 'ok' })))
  }
  $lines.Add("flagged: $flagged  without comment: $missing")
  return @{ Lines = $lines; Flagged = $flagged; Missing = $missing }
}

# #DIV/0! list on the FAR sheet: cell | row label | formula | probable cause (divisor cell that is 0 or empty).
# Lets the executor/reviewer see at once which #DIV/0! are "denominator is 0" and which need an input (e.g. opening balance).
function Get-FarDiv0List($far) {
  $lines = New-Object System.Collections.Generic.List[string]
  $ur = $far.UsedRange; $r0 = $ur.Row; $c0 = $ur.Column
  $vals = $ur.Value2; $fm = $ur.Formula
  if ($vals -isnot [object[,]]) { return $lines }
  $a1 = $vals.GetLowerBound(0); $a2 = $vals.GetLowerBound(1)
  $n = 0
  for ($i = 0; $i -lt $vals.GetLength(0); $i++) { for ($j = 0; $j -lt $vals.GetLength(1); $j++) {
    $x = $vals[($a1 + $i), ($a2 + $j)]
    if (-not (($x -is [int]) -and ($x -eq -2146826281))) { continue }
    $n++
    $row = $r0 + $i; $col = $c0 + $j; $addr = "{0}{1}" -f (ColL $col), $row
    $label = ''
    for ($c = 1; $c -le 8; $c++) { $t = [string]$far.Cells.Item($row, $c).Text; if ($t.Trim() -ne '') { $label = $t.Trim(); break } }
    $f = [string]$fm[($a1 + $i), ($a2 + $j)]
    $why = @()
    foreach ($m in [regex]::Matches($f, '/\s*\(?\s*\$?([A-Z]{1,3})\$?(\d+)')) {
      $ref = $m.Groups[1].Value + $m.Groups[2].Value
      $rv = $far.Range($ref).Value2
      if (($null -eq $rv) -or (($rv -is [double]) -and ($rv -eq 0))) {
        $rl = ''; $rr = [int]$m.Groups[2].Value
        for ($c = 1; $c -le 8; $c++) { $t = [string]$far.Cells.Item($rr, $c).Text; if ($t.Trim() -ne '') { $rl = $t.Trim(); break } }
        $kind = $(if ($null -eq $rv) { 'empty' } else { '0' })
        $inp = $(if ($far.Range($ref).HasFormula) { 'formula' } else { 'INPUT cell' })
        $why += "divisor $ref ('$rl') is $kind ($inp)"
      }
    }
    if ($why.Count -eq 0) { $why = @('divisor not traced (nested or error-valued reference)') }
    $lines.Add(("{0} | {1} | {2} | {3}" -f $addr, $label, $f, ($why -join '; ')))
  } }
  $lines.Insert(0, "#DIV/0! cells on the FAR sheet: $n   (cell | row label | formula | cause)")
  return $lines
}
