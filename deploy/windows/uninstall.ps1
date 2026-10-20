#Requires -Version 5.1
<#
  Удаление RTSP Atom с Windows.
    uninstall.cmd          — удалить программу и службы, сохранить данные и настройки
    uninstall.cmd -Purge   — удалить всё, включая базу и настройки (C:\ProgramData\RTSPAtom)
#>
[CmdletBinding()]
param([switch]$Purge, [switch]$Elevated, [switch]$Yes)

$ErrorActionPreference = 'Stop'

# Если скрипт запущен из PowerShell 7, унаследованный PSModulePath указывает на модули PS7,
# и Windows PowerShell 5.1 не находит свои командлеты. Восстанавливаем стандартные пути.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $env:PSModulePath = @(
    (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $PSHOME 'Modules')
  ) -join ';'
}
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$InstallDir = $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData 'RTSPAtom'

function Finish([int]$code) {
  if ($Elevated) { Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null }
  exit $code
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')
  if ($Purge) { $a += '-Purge' }
  if ($Yes) { $a += '-Yes' }
  try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $a | Out-Null } catch {
    Write-Host 'Удаление отменено: права администратора не получены' -ForegroundColor Red
  }
  exit 0
}

if (-not $Yes -and [Environment]::UserInteractive) {
  $what = if ($Purge) { 'программу, службы, а также ВСЕ ДАННЫЕ и настройки' } else { 'программу и службы (данные сохранятся)' }
  $answer = Read-Host "Удалить RTSP Atom — $what? [д/Н]"
  if ($answer -notmatch '^(д|да|y|yes)$') { Write-Host 'Отменено.'; Finish 0 }
}

foreach ($s in @('rtspatom', 'rtspatom-mediamtx')) {
  $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
  if (-not $svc) { continue }
  Write-Host "==> Удаляю службу $s" -ForegroundColor Cyan
  if ($svc.Status -ne 'Stopped') { Stop-Service -Name $s -Force -ErrorAction SilentlyContinue }
  $wrapper = Join-Path $InstallDir "service\$s.exe"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  if (Test-Path $wrapper) { & $wrapper uninstall 2>&1 | Out-Null } else { & sc.exe delete $s 2>&1 | Out-Null }
  $ErrorActionPreference = $prev
}

foreach ($rule in 'RTSPAtom-HTTP', 'RTSPAtom-ICE-UDP', 'RTSPAtom-ICE-TCP', 'RTSPAtom-RTMP', 'RTSPAtom-SRT') {
  Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$parts = $machinePath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $InstallDir.TrimEnd('\')) }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'Machine')

$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
if ($desktop) { Remove-Item -LiteralPath (Join-Path $desktop 'RTSP Atom.url') -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1
# Папка архива (выбранная в панели — из базы, иначе из config.json); узнаём, пока программа на месте
$archiveDir = ''
try { $archiveDir = ([IO.File]::ReadAllText((Join-Path $DataRoot 'config.json')).TrimStart([char]0xFEFF) | ConvertFrom-Json).archiveDir } catch {}
$nodeExe = Join-Path $InstallDir 'node\node.exe'
$cliJs = Join-Path $InstallDir 'app\server\cli.js'
if ((Test-Path $nodeExe) -and (Test-Path $cliJs)) {
  try {
    $env:RTSPATOM_CONFIG = Join-Path $DataRoot 'config.json'
    $eff = & $nodeExe --disable-warning=ExperimentalWarning $cliJs archive-dir 2>$null | Select-Object -Last 1
    if ($LASTEXITCODE -eq 0 -and $eff) { $archiveDir = "$eff".Trim() }
  } catch {}
}
Set-Location $env:TEMP
Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) {
  Write-Host "!!  Не все файлы удалось удалить из $InstallDir — удалите каталог вручную после перезагрузки" -ForegroundColor Yellow
}

if ($Purge) {
  Remove-Item -LiteralPath $DataRoot -Recurse -Force -ErrorAction SilentlyContinue
  if ($archiveDir -and -not $archiveDir.StartsWith($DataRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "!!  Архив в $archiveDir оставлен — это отдельный каталог, удалите его вручную, если он не нужен." -ForegroundColor Yellow
  }
  Write-Host '==> RTSP Atom удалён полностью.' -ForegroundColor Cyan
} else {
  Write-Host "==> RTSP Atom удалён. Данные и настройки сохранены в $DataRoot" -ForegroundColor Cyan
}
Finish 0
