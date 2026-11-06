#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$AppPath = 'C:\code\whstocklocal',
    [string]$BundleRoot = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
$serviceName = 'WHStock5555'
$serviceDir = Join-Path $env:ProgramData $serviceName
$wrapper = Join-Path $serviceDir ($serviceName + '.exe')
$configPath = Join-Path $serviceDir ($serviceName + '.xml')
$payload = Join-Path $BundleRoot 'app'
$manifestPath = Join-Path $BundleRoot 'manifest.json'
$stopped = $false
$restartAttempted = $false

function Test-PageMarker([string]$RelativeUrl, [string]$Marker) {
    $uri = 'http://127.0.0.1:5555/' + $RelativeUrl + '?repair=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10 -Headers @{'Cache-Control'='no-cache'}
    if ($r.StatusCode -ne 200 -or -not $r.Content.Contains($Marker)) { throw "Wrong page served at $RelativeUrl. Check which process owns port 5555." }
}
function Test-ApiMounted([string]$RelativeUrl) {
    try {
        $r = Invoke-WebRequest ('http://127.0.0.1:5555/' + $RelativeUrl) -UseBasicParsing -TimeoutSec 10
        throw "Unexpected unauthenticated response for $RelativeUrl : $($r.StatusCode)"
    } catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }
        $status = [int]$response.StatusCode
        $type = [string]$response.ContentType
        if ($status -ne 401 -or $type -notmatch 'application/json') {
            throw "API $RelativeUrl is not ready: expected JSON 401 without login, got HTTP $status ($type)."
        }
    }
}
try {
    if ($env:COMPUTERNAME -ine 'DESKTOP-RT67GE0') { throw "Run this repair on DESKTOP-RT67GE0. Current machine: $env:COMPUTERNAME" }
    if (-not (Test-Path -LiteralPath $payload) -or -not (Test-Path -LiteralPath $manifestPath)) { throw 'Extract the complete update ZIP first. app and manifest.json must be beside this script.' }
    $AppPath = [IO.Path]::GetFullPath($AppPath).TrimEnd('\')
    if (-not (Test-Path -LiteralPath (Join-Path $AppPath '.env'))) { throw 'Missing target .env. Restore the server configuration before running repair.' }
    if (-not (Test-Path -LiteralPath $wrapper) -or -not (Test-Path -LiteralPath $configPath)) { throw "Missing WinSW files in $serviceDir. Run the service installer first." }
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    $svc = Get-CimInstance Win32_Service -Filter "Name='WHStock5555'"
    if (-not $svc) { throw "Service $serviceName is not installed." }
    # Avoid replacing configuration for an unrelated service installation.
    $imagePath = [string]$svc.PathName
    if ($imagePath -notmatch ('^\s*"?' + [regex]::Escape($wrapper) + '"?(?:\s|$)')) { throw "Service executable differs from expected WinSW path: $imagePath" }
    $sourceRoot = [IO.Path]::GetFullPath($payload).TrimEnd('\') + '\'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $entries = @($manifest.files)
    if (-not $entries.Count) { throw 'Empty update manifest.' }
    foreach ($entry in $entries) {
        $relative = [string]$entry.path
        if ($relative -notmatch '^(src/|public/|createport/|mssql/|package\.json$|package-lock\.json$)' -or $relative -match '(^|/)\.\.?(/|$)' -or $relative.Contains(':') -or $relative -match '(^|/)\.env($|\.)') { throw "Invalid payload path: $relative" }
        $source = [IO.Path]::GetFullPath((Join-Path $payload $relative.Replace('/','\')))
        if (-not $source.StartsWith($sourceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw "Payload escapes source directory: $relative" }
        $target = [IO.Path]::GetFullPath((Join-Path $AppPath $relative.Replace('/','\')))
        if (-not $target.StartsWith($AppPath+'\',[StringComparison]::OrdinalIgnoreCase)) { throw "Invalid target path: $relative" }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Payload file missing: $relative" }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ine $entry.sha256) { throw "Payload checksum mismatch: $relative" }
    }
    $expectedMarkers = @{
        'public/supervisor/receive.html'='supervisor-inbound.js'
        'public/supervisor/load.html'='supervisor-deliveries.js'
        'src/server.js'="'/api/inbound'"
    }
    foreach ($relative in $expectedMarkers.Keys) {
        if (-not (Get-Content -LiteralPath (Join-Path $payload $relative) -Raw).Contains($expectedMarkers[$relative])) { throw "Bundle is not the expected version: $relative" }
    }
    $serverText = Get-Content -LiteralPath (Join-Path $payload 'src/server.js') -Raw
    if (-not $serverText.Contains("'/api/deliveries'")) { throw 'Delivery route missing in bundle.' }
    $envPath = Join-Path $AppPath '.env'
    $envHash = (Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash
    $backupRoot = Join-Path $serviceDir ('backups\repair-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6))
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupRoot 'WHStock5555.xml')
    foreach ($entry in $entries) {
        $relative = ([string]$entry.path).Replace('/','\')
        $target = Join-Path $AppPath $relative
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $backupFile = Join-Path $backupRoot ('app\'+$relative)
            New-Item -ItemType Directory -Path (Split-Path $backupFile -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $target -Destination $backupFile
        }
    }
    Write-Host "Backup saved: $backupRoot"
    $service = Get-Service -Name $serviceName
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $serviceName; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(40)) }
    $stopped = $true
    for ($n=0;$n -lt 10;$n++) {
        $listeners = @(Get-NetTCPConnection -LocalPort 5555 -State Listen -ErrorAction SilentlyContinue)
        if (-not $listeners.Count) { break }
        Start-Sleep -Seconds 1
    }
    if ($listeners.Count) {
        $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ','
        throw "Port 5555 is still occupied by PID $owners after stopping WHStock5555. No unrelated process was killed."
    }
    foreach ($entry in $entries) {
        $relative = ([string]$entry.path).Replace('/','\')
        $target = Join-Path $AppPath $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $payload $relative) -Destination $target -Force
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $entry.sha256) { throw "Copy verification failed: $relative" }
    }
    [xml]$config = Get-Content -LiteralPath $configPath -Raw
    $config.service.executable = $nodeCommand.Source
    $config.service.arguments = '"' + (Join-Path $AppPath 'src\server.js') + '"'
    $config.service.workingdirectory = $AppPath
    foreach ($pair in @(@('PORT','5555'),@('APP_HOST','DESKTOP-RT67GE0'))) {
        $item = $config.service.SelectSingleNode("env[@name='$($pair[0])']")
        if (-not $item) { $item=$config.CreateElement('env');$item.SetAttribute('name',$pair[0]);$config.service.AppendChild($item)|Out-Null }
        $item.SetAttribute('value',$pair[1])
    }
    # Retain DB_SERVER, DB_DATABASE, SQL dependency and all existing service credentials.
    $config.Save($configPath)
    Push-Location $AppPath
    try {
        & $npmCommand.Source ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. See the output above.' }
        & $nodeCommand.Source --check (Join-Path $AppPath 'src\server.js')
        if ($LASTEXITCODE -ne 0) { throw 'server.js syntax check failed.' }
    } finally { Pop-Location }
    & icacls.exe $AppPath /grant '*S-1-5-19:(OI)(CI)RX' /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant LocalService read access to the updated code.' }
    if ((Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash -ine $envHash) { throw '.env was changed unexpectedly. Inspect before starting.' }
    & $wrapper start
    if ($LASTEXITCODE -ne 0) { throw 'WinSW could not start the service.' }
    $restartAttempted = $true
    $ready = $false
    for ($n=0;$n -lt 30;$n++) {
        try { $r=Invoke-WebRequest 'http://127.0.0.1:5555/index.html' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){$ready=$true;break} } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Web did not become ready. Inspect C:\ProgramData\WHStock5555\logs.' }
    Test-PageMarker 'supervisor/receive.html' 'supervisor-inbound.js'
    Test-PageMarker 'supervisor/load.html' 'supervisor-deliveries.js'
    Test-ApiMounted 'api/inbound'
    Test-ApiMounted 'api/deliveries'
    Write-Host 'SUCCESS: latest receive/load pages and JSON APIs are being served on port 5555.' -ForegroundColor Green
    Write-Host 'No .env or database data was changed. No SQL migration was executed.'
    Write-Host 'Log in and verify data access. If a module reports missing tables, apply its SQL migration separately.'
    Write-Host 'Open http://DESKTOP-RT67GE0:5555/supervisor/receive.html and press Ctrl+F5.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    if ($stopped -and -not $restartAttempted) {
        Write-Warning 'The service was stopped. Inspect the failure before starting it; it has not been auto-started with a partial update.'
    }
    if ($backupRoot) { Write-Warning "Previous code/config backup: $backupRoot" }
    exit 1
}
