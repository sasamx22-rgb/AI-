<#
.SYNOPSIS
  Review list of a company dictionary (dict.txt): which MAP/ADD/SKIP/TIE lines are confirmed and which are guesses.
  ASCII-only script; the Korean tags live in the dictionary (UTF-8).

.DESCRIPTION
  far-dict-report.ps1 -Dict companies\abc\dict.txt [-OutFile companies\abc\dict-review.txt]

  Tag convention: a comment line #[confirmed] or #[estimated] (Korean words, see skill far-analytical) sets the
  status of every entry line below it until the next tag line.
  Entries below no tag are reported as UNTAGGED. The report is read by the user once after the first year, and by
  Amy at the start of the next year: ESTIMATED and UNTAGGED entries are re-checked, CONFIRMED ones are reused.
  Exit code 1 when any ESTIMATED or UNTAGGED entry exists (informational; does not stop a job).
#>
param(
  [Parameter(Mandatory = $true)][string]$Dict,
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$rxOk  = '^#\s*\[\s*' + [string][char]0xD655 + [string][char]0xC815 + '\s*\]'    # confirmed
$rxEst = '^#\s*\[\s*' + [string][char]0xCD94 + [string][char]0xC815 + '\s*\]'    # estimated
$status = 'UNTAGGED'; $tagNote = ''
$rows = New-Object System.Collections.Generic.List[object]
$ln = 0
foreach ($line in (Get-Content -LiteralPath $Dict -Encoding UTF8)) {
  $ln++
  $t = $line.Trim()
  if ($t -eq '') { continue }
  if ($t.StartsWith('#')) {
    if ($t -match $rxOk) { $status = 'CONFIRMED'; $tagNote = $t }
    elseif ($t -match $rxEst) { $status = 'ESTIMATED'; $tagNote = $t }
    continue
  }
  $cmd = $t.Split('|')[0].Trim().ToUpper()
  if (@('MAP', 'ADD', 'ADDD', 'SKIP', 'TIE') -notcontains $cmd) { continue }
  $rows.Add(@{ Ln = $ln; Status = $status; Cmd = $cmd; Text = $t; Note = $tagNote })
}
$cnt = @{ CONFIRMED = 0; ESTIMATED = 0; UNTAGGED = 0 }
foreach ($r in $rows) { $cnt[$r.Status]++ }
$out = New-Object System.Collections.Generic.List[string]
$out.Add("dictionary: $Dict   entries: $($rows.Count)   CONFIRMED: $($cnt.CONFIRMED)  ESTIMATED: $($cnt.ESTIMATED)  UNTAGGED: $($cnt.UNTAGGED)")
foreach ($st in @('ESTIMATED', 'UNTAGGED', 'CONFIRMED')) {
  $sel = @($rows | Where-Object { $_.Status -eq $st }); if ($sel.Count -eq 0) { continue }
  $out.Add(''); $out.Add("== $st ($($sel.Count)) ==")
  foreach ($r in $sel) { $out.Add(("line {0} | {1}" -f $r.Ln, $r.Text)); if ($st -ne 'CONFIRMED' -and $r.Note) { $out.Add("    tag: $($r.Note)") } }
}
if ($OutFile) { [System.IO.File]::WriteAllText($OutFile, ($out -join "`r`n"), (New-Object System.Text.UTF8Encoding($true))); "OK -> $OutFile" }
$out | Select-Object -First 1
if (($cnt.ESTIMATED + $cnt.UNTAGGED) -gt 0) { exit 1 }
