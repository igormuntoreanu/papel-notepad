<#
.SYNOPSIS
  Launch a desktop build, wait for its window, capture it to PNG, and report the
  time from launch to first painted window.

.DESCRIPTION
  Used for two jobs: proving a portable build actually starts, and producing the
  golden images the three variants are compared against (plan D9). It closes the
  process afterwards so a failed capture cannot leave a stray shell running.

.EXAMPLE
  powershell -NoProfile -File scripts/capture-window.ps1 -Exe dist-portable/V1/Papel.exe -Out screenshots/portable-v1.png
#>
param(
  [Parameter(Mandatory = $true)][string] $Exe,
  [Parameter(Mandatory = $true)][string] $Out,
  [int] $TimeoutSeconds = 30,
  [string] $Arguments = "",
  # Crop to the client area: golden images must not contain the title bar, which
  # differs between WebView2 and Chromium windows.
  [switch] $ClientOnly
)

$ErrorActionPreference = "Stop"

# Some CI/sandbox shells export ELECTRON_RUN_AS_NODE=1 so that "electron" acts as
# plain Node. For an Electron GUI build that means no window and a silent exit,
# which looks exactly like a broken app.
if (Test-Path Env:ELECTRON_RUN_AS_NODE) {
  Write-Output "clearing ELECTRON_RUN_AS_NODE for the GUI launch"
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}

if (-not (Test-Path $Exe)) { throw "executable not found: $Exe" }

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PapelWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  // Renders the window itself instead of copying screen pixels: the capture is
  // then independent of whatever else is on the desktop, which is what a golden
  // image needs. PW_RENDERFULLCONTENT (2) is required for DirectComposition
  // content such as WebView2.
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@

$exePath = (Resolve-Path $Exe).Path
# A portable app must start from its own folder: WebView2 resolves the loader
# and its profile relative to the executable's directory, and a foreign working
# directory makes it fail to load with a "WebView2Loader.dll not found" dialog.
$startArgs = @{
  FilePath = $exePath
  WorkingDirectory = (Split-Path -Parent $exePath)
  PassThru = $true
}
if ($Arguments) { $startArgs.ArgumentList = $Arguments }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process @startArgs
$handle = [IntPtr]::Zero
try {
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    Start-Sleep -Milliseconds 100
    $proc.Refresh()
    if ($proc.HasExited) { throw "process exited early with code $($proc.ExitCode)" }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
      $handle = $proc.MainWindowHandle
      break
    }
  }
  if ($handle -eq [IntPtr]::Zero) { throw "no window appeared within ${TimeoutSeconds}s" }

  $visibleMs = [int]$sw.Elapsed.TotalMilliseconds
  # A window exists before the renderer has composited its first frame; printing
  # then yields a solid fill. Retry until the frame has content.
  # SW_RESTORE, not SW_MAXIMIZE: maximizing would change the client size and the
  # golden images must be taken at the requested window size.
  [void][PapelWin32]::ShowWindow($handle, 9)
  [void][PapelWin32]::SetForegroundWindow($handle)

  $rect = New-Object PapelWin32+RECT
  if (-not [PapelWin32]::GetWindowRect($handle, [ref]$rect)) { throw "GetWindowRect failed" }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { throw "window has no size" }

  # The client area only: the title bar is always drawn, so including it makes
  # an unpainted window look captured. Threshold is 25 distinct colours in a
  # ~23px grid: the boot screen has roughly a dozen, the board adds the kraft
  # desk texture, paper, ink, accent red and shadows.
  function Test-Painted([System.Drawing.Bitmap] $bitmap) {
    $colors = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($y = 60; $y -lt $bitmap.Height - 10; $y += 23) {
      for ($x = 12; $x -lt $bitmap.Width - 12; $x += 23) {
        [void]$colors.Add($bitmap.GetPixel($x, $y).ToArgb())
        if ($colors.Count -ge 25) { return $true }
      }
    }
    return $false
  }

  # No fixed wait: poll immediately so `paint_ms` really is time-to-content. The
  # colour threshold below is what separates the boot screen from the board.
  $bmp = $null
  $paintSw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($paintSw.Elapsed.TotalSeconds -lt 25) {
    if ($bmp) { $bmp.Dispose() }
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $gfx.GetHdc()
    $captured = $false
    try {
      $captured = [PapelWin32]::PrintWindow($handle, $hdc, 2)
    } finally {
      $gfx.ReleaseHdc($hdc)
      $gfx.Dispose()
    }
    if ($captured -and (Test-Painted $bmp)) { break }
    Start-Sleep -Milliseconds 100
  }
  # OpenGL windows (the egui shell) do not render into PrintWindow's HDC.
  # Fall back to grabbing the screen region while the window is foregrounded.
  if (-not $bmp -or -not (Test-Painted $bmp)) {
    [void][PapelWin32]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 400
    if ($bmp) { $bmp.Dispose() }
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $gfx.Dispose()
    Start-Sleep -Milliseconds 300
  }
  if (-not $bmp -or -not (Test-Painted $bmp)) {
    throw "captured only blank frames (was the window painted?)"
  }
  $paintMs = [int]$paintSw.Elapsed.TotalMilliseconds

  if ($ClientOnly) {
    $client = New-Object PapelWin32+RECT
    if (-not [PapelWin32]::GetClientRect($handle, [ref]$client)) { throw "GetClientRect failed" }
    $origin = New-Object PapelWin32+POINT
    if (-not [PapelWin32]::ClientToScreen($handle, [ref]$origin)) { throw "ClientToScreen failed" }
    $cropX = $origin.X - $rect.Left
    $cropY = $origin.Y - $rect.Top
    $cropW = $client.Right - $client.Left
    $cropH = $client.Bottom - $client.Top
    if ($cropW -gt 0 -and $cropH -gt 0) {
      $cropped = New-Object System.Drawing.Bitmap $cropW, $cropH
      $cg = [System.Drawing.Graphics]::FromImage($cropped)
      $cg.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $cropW, $cropH), (New-Object System.Drawing.Rectangle $cropX, $cropY, $cropW, $cropH), [System.Drawing.GraphicsUnit]::Pixel)
      $cg.Dispose()
      $bmp.Dispose()
      $bmp = $cropped
      $width = $cropW
      $height = $cropH
    }
  }

  # `(Get-Location)` stringifies to "Microsoft.PowerShell.Core\FileSystem::D:\..." in
  # Windows PowerShell, which GetFullPath rejects; take the provider path instead.
  # An absolute `-Out` is used as given; a relative one is resolved against the
  # caller's directory. `Join-Path` mangles rooted children in both shells, and
  # `Get-Location` stringifies to a provider path in Windows PowerShell.
  $outPath = if ([System.IO.Path]::IsPathRooted($Out)) {
    $Out
  } else {
    [System.IO.Path]::Combine((Get-Location).Path, $Out)
  }  New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  Write-Output "captured=$outPath"
  Write-Output "size=${width}x${height}"
  Write-Output "window_ms=$visibleMs"
  Write-Output "paint_ms=$paintMs"
} finally {
  if ($proc -and -not $proc.HasExited) {
    $proc.CloseMainWindow() | Out-Null
    Start-Sleep -Milliseconds 800
    if (-not $proc.HasExited) { $proc.Kill() }
  }
}
