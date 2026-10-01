<#
.SYNOPSIS
  Build an independent verification bundle for a .pptx using the locally
  installed PowerPoint (no third-party converters, no protection bypass).

.DESCRIPTION
  Opens the presentation read-only in PowerPoint and writes, into OutDir:
    slide-N.png   rendered image of every slide
    extract.txt   text, table cells and chart series read from the real file,
                  plus objective layout flags per shape:
                    TEXT_OVERFLOW  text needs more height than its box has
                    OFF_SLIDE      shape (or its text) extends past the slide edge
  The reviewer reads these files; it never opens the deliverable itself, and
  it does not rely on the executor's own .review.txt.

  If PowerPoint cannot open the file (for example a security policy denies
  access), the script stops with an error. Do not work around it: report it
  to the user.

.EXAMPLE
  powershell -File tools\render-verify.ps1 -File outputs\deck-v1.pptx -OutDir outputs\_verify\deck-v1
#>
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'

$full = (Resolve-Path -LiteralPath $File).Path
if ([System.IO.Path]::GetExtension($full).ToLower() -ne '.pptx') {
  throw "Only .pptx is supported by this script: $full"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outFull = (Resolve-Path -LiteralPath $OutDir).Path

$lines = New-Object System.Collections.Generic.List[string]
$app = $null
$pres = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  # ReadOnly = msoTrue, Untitled = msoFalse, WithWindow = msoFalse
  $pres = $app.Presentations.Open($full, -1, 0, 0)

  $sw = [double]$pres.PageSetup.SlideWidth
  $sh = [double]$pres.PageSetup.SlideHeight
  $lines.Add("FILE: $([System.IO.Path]::GetFileName($full))")
  $lines.Add("SLIDE_SIZE_PT: ${sw} x ${sh}")
  $lines.Add("SLIDE_COUNT: $($pres.Slides.Count)")
  $lines.Add("")

  foreach ($slide in $pres.Slides) {
    $n = $slide.SlideIndex
    $png = Join-Path $outFull "slide-$n.png"
    $slide.Export($png, 'PNG', 1280, [int](1280 * $sh / $sw))
    $lines.Add("=== [Slide $n] ===")

    foreach ($shape in $slide.Shapes) {
      $flags = @()
      $left = [double]$shape.Left; $top = [double]$shape.Top
      $w = [double]$shape.Width;   $h = [double]$shape.Height

      if ($shape.HasTable -eq -1) {
        $tbl = $shape.Table
        $lines.Add("TABLE '$($shape.Name)' rows=$($tbl.Rows.Count) cols=$($tbl.Columns.Count)")
        for ($r = 1; $r -le $tbl.Rows.Count; $r++) {
          $cells = @()
          for ($c = 1; $c -le $tbl.Columns.Count; $c++) {
            $cells += $tbl.Cell($r, $c).Shape.TextFrame.TextRange.Text
          }
          $lines.Add("  ROW $r | " + ($cells -join ' | '))
        }
      }
      elseif ($shape.HasChart -eq -1) {
        $ch = $shape.Chart
        $lines.Add("CHART '$($shape.Name)' type=$($ch.ChartType)")
        try {
          for ($i = 1; $i -le $ch.SeriesCollection().Count; $i++) {
            $s = $ch.SeriesCollection($i)
            $lines.Add("  SERIES '$($s.Name)' values=" + (($s.Values | ForEach-Object { $_ }) -join ', ') +
                       " labels=" + (($s.XValues | ForEach-Object { $_ }) -join ', '))
          }
        } catch { $lines.Add("  (chart data not readable: $($_.Exception.Message))") }
      }
      elseif ($shape.HasTextFrame -eq -1 -and $shape.TextFrame2.HasText -eq -1) {
        $tr = $shape.TextFrame2.TextRange
        $bound = [double]$tr.BoundHeight
        if ($bound -gt ($h + 1)) { $flags += "TEXT_OVERFLOW(boxH=$([math]::Round($h,1)),textH=$([math]::Round($bound,1)))" }
        if (($top + [math]::Max($h, $bound)) -gt ($sh + 1)) { $flags += 'OFF_SLIDE(bottom)' }
        $flag = ''
        if ($flags.Count -gt 0) { $flag = '  <<' + ($flags -join ' ') + '>>' }
        $lines.Add("TEXT '$($shape.Name)'$flag")
        foreach ($p in ($tr.Text -split "`r")) { if ($p.Trim()) { $lines.Add("  $p") } }
      }

      if ((($left + $w) -gt ($sw + 1)) -or (($top + $h) -gt ($sh + 1)) -or ($left -lt -1) -or ($top -lt -1)) {
        $lines.Add("  <<OFF_SLIDE(shape '$($shape.Name)' box left=$([math]::Round($left,1)) top=$([math]::Round($top,1)) w=$([math]::Round($w,1)) h=$([math]::Round($h,1)))>>")
      }
    }
    $lines.Add("")
  }
}
finally {
  if ($pres) { $pres.Close() }
  if ($app) { $app.Quit() }
  [System.GC]::Collect()
}

$extract = Join-Path $outFull 'extract.txt'
[System.IO.File]::WriteAllText($extract, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
Write-Output "OK: $($pres -ne $null) wrote $extract and slide images to $outFull"
