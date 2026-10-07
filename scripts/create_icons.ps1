Add-Type -AssemblyName System.Drawing

function Draw-BaseIcon {
    param([int]$size = 128)
    
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    
    # 1. Background Rounded Rectangle
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $arcRadius = 26
    $rect = New-Object System.Drawing.Rectangle 4, 4, 120, 120
    $d = $arcRadius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.Point 0, 0),
        (New-Object System.Drawing.Point 128, 128),
        ([System.Drawing.Color]::FromArgb(255, 30, 30, 30)),
        ([System.Drawing.Color]::FromArgb(255, 12, 12, 12))
    )
    $g.FillPath($bgBrush, $path)
    
    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 60, 60, 60)), 2
    $g.DrawPath($borderPen, $path)
    
    # 2. Left vertical bar of "N"
    $leftBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.Point 0, 24),
        (New-Object System.Drawing.Point 0, 104),
        ([System.Drawing.Color]::FromArgb(255, 180, 25, 30)),
        ([System.Drawing.Color]::FromArgb(255, 120, 10, 15))
    )
    $g.FillRectangle($leftBrush, 32, 24, 18, 80)
    
    # 3. Right vertical bar of "N"
    $rightBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.Point 0, 24),
        (New-Object System.Drawing.Point 0, 104),
        ([System.Drawing.Color]::FromArgb(255, 180, 25, 30)),
        ([System.Drawing.Color]::FromArgb(255, 120, 10, 15))
    )
    $g.FillRectangle($rightBrush, 78, 24, 18, 80)
    
    # 4. Diagonal band of "N" with shadow
    $diagPoints = @(
        (New-Object System.Drawing.Point 32, 24),
        (New-Object System.Drawing.Point 50, 24),
        (New-Object System.Drawing.Point 96, 104),
        (New-Object System.Drawing.Point 78, 104)
    )
    
    # Shadow for diagonal
    $shadowPoints = @(
        (New-Object System.Drawing.Point 34, 26),
        (New-Object System.Drawing.Point 52, 26),
        (New-Object System.Drawing.Point 98, 106),
        (New-Object System.Drawing.Point 80, 106)
    )
    $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(120, 0, 0, 0))
    $g.FillPolygon($shadowBrush, $shadowPoints)
    
    $centerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.Point 32, 24),
        (New-Object System.Drawing.Point 96, 104),
        ([System.Drawing.Color]::FromArgb(255, 235, 15, 25)),
        ([System.Drawing.Color]::FromArgb(255, 200, 20, 25))
    )
    $g.FillPolygon($centerBrush, $diagPoints)
    
    # 5. Rating Badge on Bottom-Right
    # Circular badge container
    $badgeRect = New-Object System.Drawing.Rectangle 63, 63, 46, 46
    $badgeBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 20, 20))
    $badgeBorder = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 204, 0)), 2
    $g.FillEllipse($badgeBg, $badgeRect)
    $g.DrawEllipse($badgeBorder, $badgeRect)
    
    # 5-pointed Golden Star centered at (86, 86)
    $cx = 86; $cy = 86; $rOuter = 16; $rInner = 7
    $starPoints = @()
    for ($i = 0; $i -lt 10; $i++) {
        $angle = ($i * 36 - 90) * [Math]::PI / 180.0
        $r = if ($i % 2 -eq 0) { $rOuter } else { $rInner }
        $x = [int][Math]::Round($cx + $r * [Math]::Cos($angle))
        $y = [int][Math]::Round($cy + $r * [Math]::Sin($angle))
        $starPoints += (New-Object System.Drawing.Point $x, $y)
    }
    
    $starBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
        (New-Object System.Drawing.Point 70, 70),
        (New-Object System.Drawing.Point 100, 100),
        ([System.Drawing.Color]::FromArgb(255, 255, 230, 80)),
        ([System.Drawing.Color]::FromArgb(255, 255, 160, 0))
    )
    $g.FillPolygon($starBrush, $starPoints)
    
    $g.Dispose()
    return $bmp
}

function Resize-Bitmap {
    param($srcBmp, [int]$targetSize)
    $destBmp = New-Object System.Drawing.Bitmap $targetSize, $targetSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($srcBmp, 0, 0, $targetSize, $targetSize)
    $g.Dispose()
    return $destBmp
}

$baseBmp = Draw-BaseIcon 128
$assetsDir = Join-Path $PSScriptRoot "..\assets"

$sizes = @(16, 32, 48, 128)
foreach ($s in $sizes) {
    $outPath = Join-Path $assetsDir "icon-$s.png"
    if ($s -eq 128) {
        $baseBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
        $resized = Resize-Bitmap $baseBmp $s
        $resized.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $resized.Dispose()
    }
    Write-Output "Created: $outPath ($s x $s)"
}

$baseBmp.Dispose()
Write-Output "All icons generated successfully!"
