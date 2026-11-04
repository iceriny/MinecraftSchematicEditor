param(
    [ValidateSet('Start', 'Stop', 'Status')]
    [string]$Action = 'Start',
    [switch]$NoBrowser,
    [string]$MinecraftDir = $env:MINECRAFT_DIR,
    [string]$MinecraftInstances = $env:MINECRAFT_INSTANCES
)

$ErrorActionPreference = 'Stop'
$taskUrl = 'http://127.0.0.1:5173'
$taskVite = Join-Path $PSScriptRoot 'node_modules\vite\bin\vite.js'
$taskLogDir = Join-Path $PSScriptRoot 'run.local'
$taskConfigPath = Join-Path $PSScriptRoot 'local-server.local.json'

if ($Action -eq 'Start' -and (Test-Path -LiteralPath $taskConfigPath)) {
    $taskSettings = Get-Content -LiteralPath $taskConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $MinecraftDir) { $MinecraftDir = $taskSettings.minecraftDir }
    if (-not $MinecraftInstances) { $MinecraftInstances = $taskSettings.minecraftInstances }
}

function Get-EditorProcess {
    $taskListeners = @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
    if ($taskListeners.Count -eq 0) { return $null }
    $taskOwners = @($taskListeners.OwningProcess | Select-Object -Unique)
    foreach ($taskOwner in $taskOwners) {
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskOwner"
        if ($taskProcess.CommandLine -and $taskProcess.CommandLine.IndexOf($taskVite, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $taskProcess
        }
    }
    throw 'Port 5173 is occupied by another application.'
}

$taskRunning = Get-EditorProcess
if ($Action -eq 'Stop') {
    if ($taskRunning) {
        Stop-Process -Id $taskRunning.ProcessId
        Write-Output 'Schematic Editor stopped.'
    } else {
        Write-Output 'Schematic Editor is already stopped.'
    }
    exit 0
}
if ($Action -eq 'Status') {
    if ($taskRunning) { Write-Output "Running: $taskUrl (PID $($taskRunning.ProcessId))" }
    else { Write-Output 'Stopped.' }
    exit 0
}

if (-not $taskRunning) {
    if (-not (Test-Path -LiteralPath $taskVite)) {
        throw 'Dependencies are missing. Run npm ci in this folder first.'
    }
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
    $taskPreviousDir = $env:MINECRAFT_DIR
    $taskPreviousInstances = $env:MINECRAFT_INSTANCES
    try {
        if ($MinecraftDir) { $env:MINECRAFT_DIR = $MinecraftDir }
        if ($MinecraftInstances) { $env:MINECRAFT_INSTANCES = $MinecraftInstances }
        $taskChild = Start-Process -FilePath $taskNode -ArgumentList @(
            ('"' + $taskVite + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'
        ) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $taskLogDir 'server.log') `
            -RedirectStandardError (Join-Path $taskLogDir 'server-error.log')
    } finally {
        $env:MINECRAFT_DIR = $taskPreviousDir
        $env:MINECRAFT_INSTANCES = $taskPreviousInstances
    }
}

$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
    try {
        $taskResponse = Invoke-WebRequest -Uri $taskUrl -TimeoutSec 2 -UseBasicParsing
        if ($taskResponse.StatusCode -eq 200 -and $taskResponse.Content.Contains('<title>Schematic Editor</title>')) {
            $taskReady = $true
            break
        }
    } catch { }
    if ($taskChild) {
        $taskChild.Refresh()
        if ($taskChild.HasExited) { break }
    }
    Start-Sleep -Milliseconds 250
}
if (-not $taskReady) {
    if ($taskChild -and -not $taskChild.HasExited) { Stop-Process -Id $taskChild.Id -ErrorAction SilentlyContinue }
    throw "Startup failed. See logs in $taskLogDir"
}
Write-Output "Schematic Editor ready: $taskUrl"
if (-not $NoBrowser) { Start-Process $taskUrl -WindowStyle Hidden }
