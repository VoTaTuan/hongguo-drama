# Detects (and optionally closes) running instances of this project's app, packaged or dev.
# Only processes whose executable lives under this repo's dist\win-unpacked or node_modules\electron are touched.
# Usage: close-app.ps1 -Check   -> exit 1 if the app is running, 0 otherwise
#        close-app.ps1 -Close   -> close it (graceful first, then force); exit 0 on success, 1 if still running
param([switch]$Check, [switch]$Close, [string[]]$Root)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
# -Root exists only so the detection can be tested against a harmless stand-in process.
$folders = if ($Root) { $Root } else { @((Join-Path $repo 'dist\win-unpacked'), (Join-Path $repo 'node_modules\electron')) }
$roots = $folders | ForEach-Object { $_.TrimEnd('\').ToLowerInvariant() + '\' }

function Get-AppProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $path = $_.ExecutablePath
    $path -and ($roots | Where-Object { $path.ToLowerInvariant().StartsWith($_) })
  }
}

$running = @(Get-AppProcesses)
if ($Check) { if ($running.Count -gt 0) { exit 1 } else { exit 0 } }

if ($Close) {
  foreach ($proc in $running) {
    $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }
  }
  for ($i = 0; $i -lt 10 -and @(Get-AppProcesses).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  foreach ($proc in @(Get-AppProcesses)) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  if (@(Get-AppProcesses).Count -gt 0) { exit 1 } else { exit 0 }
}
