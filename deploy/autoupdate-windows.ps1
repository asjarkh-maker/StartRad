# Tolko da: automatic update. Runs every 2 minutes as a scheduled task (TolkoDaAutoUpdate).
# Asks GitHub for the latest version id; if it differs from the deployed one, runs update-windows.ps1.
# Log: C:\tolko-da\autoupdate.log. ASCII only on purpose.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'asjarkh-maker/startrad'
$branch = 'feature/constructor'
$dir = 'C:\tolko-da'
$log = Join-Path $dir 'autoupdate.log'
$lock = Join-Path $dir 'autoupdate.lock'
$shaFile = Join-Path $dir '.deployed-sha'

# GitHub answers with a non-text content type, so PowerShell 5.1 may return bytes
function Get-LatestSha($headers) {
  $r = Invoke-WebRequest "https://api.github.com/repos/$repo/commits/$branch" -Headers $headers -UseBasicParsing -TimeoutSec 20
  $c = $r.Content
  if ($c -is [byte[]]) { $c = [Text.Encoding]::ASCII.GetString($c) }
  return ([string]$c).Trim()
}

function Log($m) {
  Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m) -Encoding ASCII
  if ((Get-Item $log).Length -gt 512KB) { Get-Content $log -Tail 2000 | Set-Content ($log + '.tmp') -Encoding ASCII; Move-Item ($log + '.tmp') $log -Force }
}

# one run at a time; a lock older than 30 minutes is considered stale
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 30) { exit 0 }
Set-Content -Path $lock -Value $PID -Encoding ASCII
try {
  $headers = @{ 'User-Agent' = 'tolko-da-updater'; 'Accept' = 'application/vnd.github.sha' }
  $tokenFile = Join-Path $dir 'data\github-token.txt'
  if (Test-Path $tokenFile) { $headers['Authorization'] = 'Bearer ' + (Get-Content $tokenFile -Raw).Trim() }
  try {
    $latest = Get-LatestSha $headers
  } catch {
    Log ("check failed: " + $_.Exception.Message)
    exit 0
  }
  $current = if (Test-Path $shaFile) { (Get-Content $shaFile -Raw).Trim() } else { '' }
  if ($latest -notmatch '^[0-9a-f]{40}$') { Log "unexpected answer from GitHub: $latest"; exit 0 }
  if ($latest -eq $current) { exit 0 }
  Log "new version $latest (was $current), updating"
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'deploy\update-windows.ps1') -Sha $latest 2>&1
  $code = $LASTEXITCODE
  $out | Select-Object -Last 15 | ForEach-Object { Log ("  " + $_) }
  if ($code -eq 0) { Log "updated to $latest" } else { Log "update FAILED (code $code)" }
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
