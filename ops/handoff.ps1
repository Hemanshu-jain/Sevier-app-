# Handoff server control: start / stop / restart / status / data / sql.
# Used by Handoff-tools.bat (double-click that). Everything runs hidden in the background and keeps
# running after this window closes. It only ever touches Handoff's own processes, never the LMS app.
param([ValidateSet('start', 'stop', 'restart', 'status', 'data', 'sql')][string]$Action = 'status')

$repo = Split-Path -Parent $PSScriptRoot
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$publicUrl = 'https://handoff.bhodhix.com'

function Find-Api { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server/index.mjs*' } }
function Find-Tunnel { Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*tunnel run handoff*' } }
function Find-Watchdog { Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*-File*keep-alive.ps1*' -and $_.ProcessId -ne $PID } }

function Stop-Tree($processes) {
  foreach ($process in $processes) { taskkill /PID $process.ProcessId /T /F *> $null }
}

function Test-Health($url) {
  try { (Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 5).status -eq 'ok' } catch { $false }
}

function Show-Line($label, $ok, $detail = '') {
  $mark = if ($ok) { 'OK  ' } else { 'DOWN' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1,-22} {2}" -f $mark, $label, $detail) -ForegroundColor $color
}

function Show-Status {
  Write-Host "`nHandoff status" -ForegroundColor Cyan
  Show-Line 'App server (API)' ([bool](Find-Api)) 'port 8787'
  Show-Line 'Cloudflare tunnel' ([bool](Find-Tunnel)) 'tunnel "handoff"'
  Show-Line 'Watchdog' ([bool](Find-Watchdog)) 'auto-restarts the two above'
  Show-Line 'Local health check' (Test-Health 'http://localhost:8787') 'http://localhost:8787'
  Show-Line 'Public website' (Test-Health $publicUrl) $publicUrl
  Write-Host ''
}

function Start-Handoff {
  if (-not (Find-Api)) {
    Start-Process -WindowStyle Hidden -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $repo `
      -RedirectStandardOutput "$repo\server-run.log" -RedirectStandardError "$repo\server-run.err.log"
    Write-Host 'Starting the app server...'
  }
  if (-not (Find-Tunnel)) {
    Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList 'tunnel', 'run', 'handoff'
    Write-Host 'Starting the Cloudflare tunnel...'
  }
  if (-not (Find-Watchdog)) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$repo\server\keep-alive.ps1`""
    Write-Host 'Starting the watchdog...'
  }
  foreach ($attempt in 1..30) {
    if (Test-Health 'http://localhost:8787') { break }
    Start-Sleep -Seconds 2
  }
  Start-Sleep -Seconds 3  # give the tunnel a moment to register with Cloudflare
  Show-Status
}

function Stop-Handoff {
  # Watchdog first, otherwise it would bring the others straight back.
  Stop-Tree (Find-Watchdog); Stop-Tree (Find-Api); Stop-Tree (Find-Tunnel)
  Write-Host 'Handoff stopped (the LMS app was not touched).'
  Show-Status
}

# Database access uses the app's own connection settings from .env.
function Get-Db {
  $line = Get-Content "$repo\.env" | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  $uri = [Uri]($line -replace '^DATABASE_URL=', '')
  $user, $password = $uri.UserInfo.Split(':', 2)
  @{ Host = $uri.Host; Port = $uri.Port; User = [Uri]::UnescapeDataString($user); Password = [Uri]::UnescapeDataString($password); Name = $uri.AbsolutePath.TrimStart('/') }
}

function Invoke-Sql($sql) {
  $db = Get-Db
  $env:MYSQL_PWD = $db.Password
  try { & $mysql -h $db.Host -P $db.Port -u $db.User $db.Name --table -e $sql } finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}

function Show-Data {
  Write-Host "`nCompanies (wallet balance in rupees)" -ForegroundColor Cyan
  Invoke-Sql "SELECT t.name AS company, COALESCE(w.balance_paise, 0) / 100 AS wallet_rs, (SELECT COUNT(*) FROM recovery_cases c WHERE c.tenant_id = t.id) AS applications, (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users FROM tenants t LEFT JOIN wallets w ON w.tenant_id = t.id WHERE t.archived_at IS NULL ORDER BY t.name;"
  Write-Host "`nLogins" -ForegroundColor Cyan
  Invoke-Sql "SELECT u.name, u.mobile, u.role, COALESCE(t.name, '(independent agent)') AS company, IF(u.active = 1, 'active', 'suspended') AS status FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE t.archived_at IS NULL AND u.email NOT LIKE '%@test.invalid' ORDER BY u.role, u.name;"
  Write-Host "`nLatest 20 applications" -ForegroundColor Cyan
  Invoke-Sql "SELECT c.id, t.name AS company, c.borrower_name AS customer, c.registration, c.status, LEFT(COALESCE(c.created_at, c.updated_at), 10) AS created FROM recovery_cases c JOIN tenants t ON t.id = c.tenant_id WHERE t.archived_at IS NULL ORDER BY COALESCE(c.created_at, c.updated_at) DESC LIMIT 20;"
}

function Open-Sql {
  $db = Get-Db
  Write-Host "Connected to $($db.Name). Type exit to leave." -ForegroundColor Cyan
  $env:MYSQL_PWD = $db.Password
  try { & $mysql -h $db.Host -P $db.Port -u $db.User $db.Name } finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
}

switch ($Action) {
  'start' { Start-Handoff }
  'stop' { Stop-Handoff }
  'restart' { Stop-Tree (Find-Watchdog); Stop-Tree (Find-Api); Stop-Tree (Find-Tunnel); Start-Sleep -Seconds 2; Start-Handoff }
  'status' { Show-Status }
  'data' { Show-Data }
  'sql' { Open-Sql }
}
