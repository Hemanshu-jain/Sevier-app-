# Watchdog for hosting from this PC: restarts the API and the Cloudflare tunnel if either exits.
# Start it detached (survives closing the terminal). Keep the inner double quotes: the path has a space.
#   Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"D:\Hemanshu\PERSNOAL\Auto Seizure\server\keep-alive.ps1"'
# ponytail: polling every 30s, not a Windows service; it cannot help if the PC sleeps or shuts down.
$repo = Split-Path -Parent $PSScriptRoot
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

while ($true) {
  $api = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server/index.mjs*' }
  if (-not $api) {
    Start-Process -WindowStyle Hidden -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $repo `
      -RedirectStandardOutput "$repo\server-run.log" -RedirectStandardError "$repo\server-run.err.log"
    Add-Content "$repo\keep-alive.log" "$(Get-Date -Format s) restarted API"
  }
  # Only Handoff's own tunnel counts; the LMS app runs a cloudflared of its own on this PC.
  $tunnel = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*tunnel run handoff*' }
  if (-not $tunnel) {
    Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList 'tunnel', 'run', 'handoff'
    Add-Content "$repo\keep-alive.log" "$(Get-Date -Format s) restarted tunnel"
  }
  Start-Sleep -Seconds 30
}
