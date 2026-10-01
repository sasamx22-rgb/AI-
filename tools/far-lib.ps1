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
  $bad = New-Object System.Collections.Generic.List[string]; $errs = @{}; $ph = @{}
  foreach ($ws in $wb.Worksheets) {
    $ur = $ws.UsedRange; $v = $ur.Value2; if ($v -isnot [object[,]]) { continue }
    $a1 = $v.GetLowerBound(0); $a2 = $v.GetLowerBound(1)
    for ($i = 0; $i -lt $v.GetLength(0); $i++) { for ($j = 0; $j -lt $v.GetLength(1); $j++) {
      $x = $v[($a1 + $i), ($a2 + $j)]
      $addr = "{0}!{1}{2}" -f $ws.Index, (ColL ($ur.Column + $j)), ($ur.Row + $i)
      if (($x -is [bool]) -and (-not $x)) { $bad.Add("FALSE $addr") }
      if (($x -is [string]) -and ($x -match '^\[[^\]]+\]$')) { $ph[$ws.Index] = 1 + [int]$ph[$ws.Index] }
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
