param(
  [string]$OutFile = (Join-Path $PSScriptRoot 'icon.ico')
)

Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

function New-IconColor([string]$Hex, [int]$Alpha = 255) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($Hex)
  [System.Drawing.Color]::FromArgb($Alpha, $color.R, $color.G, $color.B)
}

function New-RoundedRect([single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $path
}

function New-IconFrame([int]$Size) {
  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.ScaleTransform($Size / 256.0, $Size / 256.0)

  $pagePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $pagePath.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(55, 38),
    [System.Drawing.PointF]::new(179, 38),
    [System.Drawing.PointF]::new(210, 69),
    [System.Drawing.PointF]::new(210, 218),
    [System.Drawing.PointF]::new(55, 218)
  ))
  $pageBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(70, 44),
    [System.Drawing.PointF]::new(191, 207),
    (New-IconColor '#fff8e8'),
    (New-IconColor '#eadfbd')
  )
  $graphics.FillPath($pageBrush, $pagePath)

  $foldBrush = [System.Drawing.SolidBrush]::new((New-IconColor '#d8c895'))
  $graphics.FillPolygon($foldBrush, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(179, 38),
    [System.Drawing.PointF]::new(179, 69),
    [System.Drawing.PointF]::new(210, 69)
  ))

  $pagePen = [System.Drawing.Pen]::new((New-IconColor '#cdbb82'), 5)
  $pagePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($pagePen, $pagePath)

  $gridPen = [System.Drawing.Pen]::new((New-IconColor '#8fa29d' 92), 2)
  foreach ($y in 91, 126, 161) { $graphics.DrawLine($gridPen, 76, $y, 188, $y) }
  foreach ($x in 96, 131, 166) { $graphics.DrawLine($gridPen, $x, 73, $x, 185) }

  $greenWick = [System.Drawing.Pen]::new((New-IconColor '#24443f'), 7)
  $redWick = [System.Drawing.Pen]::new((New-IconColor '#563433'), 7)
  $greenWick.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $greenWick.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $redWick.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $redWick.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($greenWick, 84, 138, 84, 170)
  $graphics.DrawLine($redWick, 114, 100, 114, 144)
  $graphics.DrawLine($greenWick, 144, 108, 144, 164)
  $graphics.DrawLine($greenWick, 174, 79, 174, 148)

  $greenBrush = [System.Drawing.SolidBrush]::new((New-IconColor '#22b586'))
  $greenBrushDark = [System.Drawing.SolidBrush]::new((New-IconColor '#1fa47d'))
  $redBrush = [System.Drawing.SolidBrush]::new((New-IconColor '#d85f4f'))
  $graphics.FillPath($greenBrushDark, (New-RoundedRect 75 117 18 36 4))
  $graphics.FillPath($redBrush, (New-RoundedRect 105 118 18 25 4))
  $graphics.FillPath($greenBrush, (New-RoundedRect 135 99 18 43 4))
  $graphics.FillPath($greenBrush, (New-RoundedRect 165 84 18 40 4))

  $trendPen = [System.Drawing.Pen]::new((New-IconColor '#f5c84b'), 9)
  $trendPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trendPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trendPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($trendPen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(72, 173),
    [System.Drawing.PointF]::new(106, 139),
    [System.Drawing.PointF]::new(134, 158),
    [System.Drawing.PointF]::new(182, 92)
  ))
  $graphics.DrawLines($trendPen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(178, 90),
    [System.Drawing.PointF]::new(192, 85),
    [System.Drawing.PointF]::new(191, 100)
  ))
  $dotBrush = [System.Drawing.SolidBrush]::new((New-IconColor '#f5c84b'))
  $graphics.FillEllipse($dotBrush, 65, 166, 14, 14)

  $graphics.Dispose()
  $memory = [System.IO.MemoryStream]::new()
  $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  $memory.ToArray()
}

$frames = 16, 24, 32, 48, 64, 128, 256 | ForEach-Object {
  [pscustomobject]@{ Size = $_; Bytes = New-IconFrame $_ }
}

$parent = Split-Path -Parent $OutFile
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

$stream = [System.IO.File]::Create($OutFile)
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$frames.Count)

  $offset = 6 + ($frames.Count * 16)
  foreach ($frame in $frames) {
    $entrySize = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$entrySize)
    $writer.Write([byte]$entrySize)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
  }

  foreach ($frame in $frames) {
    $writer.Write([byte[]]$frame.Bytes)
  }
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Host "Wrote $OutFile"