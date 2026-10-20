#Requires -Version 5.1
<#
  Установка / обновление RTSP Atom на Windows 11 (и Windows 10 1809+, Windows Server 2019+), x64.
  Работает без интернета: всё необходимое лежит в этом каталоге.

  Обычно запускается двойным щелчком по install.cmd. Параметры:
    -Port 8080          порт веб-интерфейса
    -Tls                включить HTTPS (самоподписанный сертификат)
    -AdminLogin admin   логин первого администратора
    -AdminPassword ...  пароль первого администратора (без него будет запрошен)
    -NoStart            не запускать службы
    -NoFirewall         не создавать правило брандмауэра
    -ArchiveDir D:\Archive  каталог архива видео (по умолчанию C:\ProgramData\RTSPAtom\data\archive)
#>
[CmdletBinding()]
param(
  [int]$Port = 0,
  [switch]$Tls,
  [string]$AdminLogin = 'admin',
  [string]$AdminPassword = '',
  [switch]$NoStart,
  [switch]$NoFirewall,
  [string]$ArchiveDir = '',
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'RTSPAtom'),
  [switch]$Elevated
)

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
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

$Src = $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData 'RTSPAtom'
$DataDir = Join-Path $DataRoot 'data'
$LogDir = Join-Path $DataRoot 'logs'
$TlsDir = Join-Path $DataRoot 'tls'
$ConfigFile = Join-Path $DataRoot 'config.json'
$YmlFile = Join-Path $DataRoot 'mediamtx.yml'
$Services = @('rtspatom', 'rtspatom-mediamtx')

function Say([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Finish([int]$code) {
  if ($Elevated) { Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null }
  exit $code
}
function Die([string]$m) { Write-Host "Ошибка: $m" -ForegroundColor Red; Finish 1 }

# Запуск внешней программы: в PowerShell 5.1 вывод в stderr при $ErrorActionPreference=Stop
# превращается в исключение, поэтому временно ослабляем режим и собираем весь вывод строками.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments = @(), [string]$InputText = $null)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($null -ne $InputText) { $out = $InputText | & $Exe @Arguments 2>&1 } else { $out = & $Exe @Arguments 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  $text = (@($out) | ForEach-Object { "$_" }) -join "`n"
  return [pscustomobject]@{ Code = $code; Output = $text.Trim() }
}

# --- Права администратора: перезапуск с повышением ---------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Нужны права администратора — Windows запросит подтверждение'
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated', '-AdminLogin', $AdminLogin)
  if ($Port) { $a += @('-Port', $Port) }
  if ($Tls) { $a += '-Tls' }
  if ($NoStart) { $a += '-NoStart' }
  if ($NoFirewall) { $a += '-NoFirewall' }
  if ($ArchiveDir) { $a += @('-ArchiveDir', "`"$ArchiveDir`"") }
  $a += @('-InstallDir', "`"$InstallDir`"")
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $a | Out-Null
  } catch {
    Die 'установка отменена: права администратора не получены'
  }
  exit 0
}

try {
  # --- Проверки -------------------------------------------------------------------
  if (-not [Environment]::Is64BitOperatingSystem) { Die 'нужна 64-разрядная Windows' }
  $build = [Environment]::OSVersion.Version.Build
  if ($build -lt 17763) { Die "слишком старая Windows (сборка $build), нужна Windows 10 1809 / Windows 11" }
  foreach ($f in @('node\node.exe', 'mediamtx\mediamtx.exe', 'service\WinSW.exe', 'app\server\index.js', 'deploy\mediamtx.yml')) {
    if (-not (Test-Path (Join-Path $Src $f))) { Die "пакет неполный (нет $f) — распакуйте архив целиком" }
  }
  $osName = (Get-CimInstance Win32_OperatingSystem).Caption
  Say "Система: $osName (сборка $build)"

  # Файлы из интернета помечены Windows как «заблокированные» — снимаем пометку.
  Get-ChildItem -Path $Src -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

  $sums = Join-Path $Src 'SHA256SUMS'
  if (Test-Path $sums) {
    Say 'Проверка целостности пакета'
    $bad = @()
    $sha = [Security.Cryptography.SHA256]::Create()
    foreach ($line in Get-Content -LiteralPath $sums -Encoding UTF8) {
      if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
      $file = Join-Path $Src ($Matches[2] -replace '^\./', '' -replace '/', '\')
      if (-not (Test-Path -LiteralPath $file)) { $bad += $Matches[2]; continue }
      $expected = $Matches[1]; $name = $Matches[2]
      $fs = [IO.File]::OpenRead($file)
      try { $hash = -join ($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) } finally { $fs.Dispose() }
      if ($hash -ne $expected) { $bad += $name }
    }
    if ($bad.Count) { Die ("файлы пакета повреждены: " + ($bad -join ', ')) }
  }

  # --- Остановка старой версии ------------------------------------------------------
  foreach ($s in $Services) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
      if ($svc.Status -ne 'Stopped') { Say "Останавливаю службу $s"; Stop-Service -Name $s -Force }
      $wrapper = Join-Path $InstallDir "service\$s.exe"
      if (Test-Path $wrapper) { Invoke-Native $wrapper @('uninstall') | Out-Null } else { Invoke-Native 'sc.exe' @('delete', $s) | Out-Null }
    }
  }
  # Ждём завершения процессов старой версии, чтобы файлы не были заняты.
  for ($i = 0; $i -lt 20; $i++) {
    $running = Get-Process -Name node, mediamtx, rtspatom, rtspatom-mediamtx -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
    if (-not $running) { break }
    if ($i -eq 19) { $running | Stop-Process -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }

  # --- Копирование программы --------------------------------------------------------
  Say "Копирую файлы в $InstallDir"
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  foreach ($d in @('app', 'node', 'mediamtx', 'service', 'deploy')) {
    $dst = Join-Path $InstallDir $d
    if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $Src $d) -Destination $dst -Recurse -Force
  }
  foreach ($f in @('VERSION.txt', 'INSTALL.md')) {
    if (Test-Path (Join-Path $Src $f)) { Copy-Item -LiteralPath (Join-Path $Src $f) -Destination $InstallDir -Force }
  }
  foreach ($f in @('uninstall.ps1', 'uninstall.cmd', 'rtspatom-admin.cmd')) {
    Copy-Item -LiteralPath (Join-Path $Src "deploy\windows\$f") -Destination $InstallDir -Force
  }

  $Node = Join-Path $InstallDir 'node\node.exe'
  $Mtx = Join-Path $InstallDir 'mediamtx\mediamtx.exe'
  $Cli = Join-Path $InstallDir 'app\server\cli.js'

  # --- Данные и права доступа ---------------------------------------------------------
  # Службы работают от «NT AUTHORITY\LocalService» (S-1-5-19), а не от SYSTEM.
  Say "Каталог данных $DataRoot"
  foreach ($d in @($DataRoot, $DataDir, $LogDir, $TlsDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  # Наследуемые разрешения на каталогах сами распространяются на вложенные файлы.
  $r = Invoke-Native 'icacls.exe' @($DataRoot, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-19:(OI)(CI)RX', '/Q')
  if ($r.Code -ne 0) { Die "не удалось настроить права на $DataRoot`: $($r.Output)" }
  foreach ($d in @($DataDir, $LogDir)) {
    $r = Invoke-Native 'icacls.exe' @($d, '/grant', '*S-1-5-19:(OI)(CI)M', '/Q')
    if ($r.Code -ne 0) { Warn "права на $d настроены не полностью: $($r.Output)" }
  }

  # --- HTTPS --------------------------------------------------------------------------
  $pfxArgs = @()
  if ($Tls) {
    $pfx = Join-Path $TlsDir 'rtspatom.pfx'
    if (-not (Test-Path $pfx)) {
      Say 'Создаю самоподписанный сертификат (10 лет)'
      $names = @($env:COMPUTERNAME, 'localhost')
      $cert = New-SelfSignedCertificate -DnsName $names -CertStoreLocation 'Cert:\LocalMachine\My' `
        -NotAfter (Get-Date).AddYears(10) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 `
        -FriendlyName 'RTSP Atom'
      $plain = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
      $secure = ConvertTo-SecureString $plain -AsPlainText -Force
      $exp = @{ Cert = $cert; FilePath = $pfx; Password = $secure }
      if ((Get-Command Export-PfxCertificate).Parameters.ContainsKey('CryptoAlgorithmOption')) {
        $exp.CryptoAlgorithmOption = 'AES256_SHA256'
      }
      Export-PfxCertificate @exp | Out-Null
      Remove-Item -LiteralPath "Cert:\LocalMachine\My\$($cert.Thumbprint)" -Force
      $pfxArgs = @('--tls-pfx', $pfx, '--tls-pass', $plain)
    } else {
      $pfxArgs = @('--tls-pfx', $pfx)
    }
  }

  # --- Свободные порты ----------------------------------------------------------------
  # Желаемые порты: из -Port / прежней установки / по умолчанию. Если порт занят другой
  # программой (наши службы уже остановлены), берётся следующий свободный.
  $wantPanel = 8080; $wantHls = 8888; $wantApi = 9997; $wantWhep = 8890; $wantIce = 8189; $wantRtmp = 1935; $wantSrt = 8890; $wantPlay = 9996; $wantRtsp = 8554
  if (Test-Path $ConfigFile) {
    try {
      $old = [IO.File]::ReadAllText($ConfigFile).TrimStart([char]0xFEFF) | ConvertFrom-Json
      if ($old.port) { $wantPanel = [int]$old.port }
      if ($old.mediamtx.hlsUrl) { $wantHls = ([Uri]$old.mediamtx.hlsUrl).Port }
      if ($old.mediamtx.apiUrl) { $wantApi = ([Uri]$old.mediamtx.apiUrl).Port }
      if ($old.mediamtx.webrtcUrl) { $wantWhep = ([Uri]$old.mediamtx.webrtcUrl).Port }
      if ($old.mediamtx.icePort) { $wantIce = [int]$old.mediamtx.icePort }
      if ($old.mediamtx.rtmpPort) { $wantRtmp = [int]$old.mediamtx.rtmpPort }
      if ($old.mediamtx.srtPort) { $wantSrt = [int]$old.mediamtx.srtPort }
      if ($old.mediamtx.playbackUrl) { $wantPlay = ([Uri]$old.mediamtx.playbackUrl).Port }
      if ($old.mediamtx.rtspUrl) { $wantRtsp = ([Uri]$old.mediamtx.rtspUrl).Port }
    } catch { Warn "не удалось прочитать прежний $ConfigFile — используются порты по умолчанию" }
  }
  if ($Port) { $wantPanel = $Port }
  Say 'Проверяю, свободны ли порты'
  $r = Invoke-Native $Node @((Join-Path $InstallDir 'deploy\ports.mjs'), "panel=$wantPanel@0.0.0.0", "hls=$wantHls@127.0.0.1", "api=$wantApi@127.0.0.1", "whep=$wantWhep@127.0.0.1", "ice=$wantIce@0.0.0.0+udp", "rtmp=$wantRtmp@0.0.0.0", "srt=$wantSrt@0.0.0.0/udp", "playback=$wantPlay@127.0.0.1", "rtsp=$wantRtsp@127.0.0.1")
  if ($r.Code -ne 0) { Die "не удалось подобрать порты: $($r.Output)" }
  $ports = ($r.Output -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  $labels = @{ panel = 'веб-интерфейса'; hls = 'видео HLS (внутренний)'; api = 'управления MediaMTX (внутренний)'; whep = 'подключения WebRTC (внутренний)'; ice = 'видео WebRTC'; rtmp = 'приёма RTMP от энкодеров'; srt = 'приёма SRT от энкодеров'; playback = 'выдачи архива (внутренний)'; rtsp = 'передачи потока энкодера в архив (внутренний)' }
  foreach ($k in 'panel', 'hls', 'api', 'whep', 'ice', 'rtmp', 'srt', 'playback', 'rtsp') {
    $pr = $ports.$k
    if ($pr.busyBy) { Warn "Порт $($pr.wanted) занят ($($pr.busyBy)) — для $($labels[$k]) взят свободный порт $($pr.port)" }
  }

  # --- Конфигурация -------------------------------------------------------------------
  $cfgArgs = @(
    (Join-Path $InstallDir 'deploy\windows\configure.mjs'),
    '--config', $ConfigFile,
    '--template', (Join-Path $InstallDir 'deploy\mediamtx.yml'),
    '--yml', $YmlFile,
    '--data', $DataDir,
    '--public', (Join-Path $InstallDir 'app\public')
  )
  $cfgArgs += @('--port', $ports.panel.port, '--mtx-hls-port', $ports.hls.port, '--mtx-api-port', $ports.api.port,
    '--mtx-whep-port', $ports.whep.port, '--ice-port', $ports.ice.port, '--rtmp-port', $ports.rtmp.port, '--srt-port', $ports.srt.port, '--playback-port', $ports.playback.port, '--rtsp-port', $ports.rtsp.port)
  if ($ArchiveDir) { $cfgArgs += @('--archive-dir', [IO.Path]::GetFullPath($ArchiveDir)) }
  $cfgArgs += $pfxArgs
  $r = Invoke-Native $Node $cfgArgs
  if ($r.Code -ne 0) { Die "не удалось записать конфигурацию: $($r.Output)" }
  $summary = ($r.Output -split "`n" | Select-Object -Last 1) | ConvertFrom-Json
  if ($summary.ymlNew) { Warn "Ваш $YmlFile изменён и оставлен как есть; новая версия — mediamtx.yml.new" }

  # --- Каталог архива -----------------------------------------------------------------
  # Пишет MediaMTX и чистит панель — обе службы работают от LocalService.
  Say "Каталог архива $($summary.archiveDir)"
  New-Item -ItemType Directory -Force -Path $summary.archiveDir | Out-Null
  $r = Invoke-Native 'icacls.exe' @($summary.archiveDir, '/grant', '*S-1-5-19:(OI)(CI)M', '/Q')
  if ($r.Code -ne 0) { Warn "права на каталог архива настроены не полностью: $($r.Output)" }
  $env:RTSPATOM_CONFIG = $ConfigFile
  if ($ArchiveDir) {
    # явно указанный каталог важнее выбранного раньше в «Настройки → Архив»
    $r = Invoke-Native $Node @('--disable-warning=ExperimentalWarning', $Cli, 'archive-dir', '--reset')
    if ($r.Code -ne 0) { Warn "не удалось применить -ArchiveDir: $($r.Output)" }
  }

  # --- Службы (WinSW) -----------------------------------------------------------------
  Say 'Регистрирую службы Windows'
  $svcDir = Join-Path $InstallDir 'service'
  $tpl = Join-Path $InstallDir 'deploy\windows'
  $vars = @{
    '@NODE@' = $Node; '@MEDIAMTX@' = $Mtx; '@APP@' = (Join-Path $InstallDir 'app');
    '@CONFIG@' = $ConfigFile; '@YML@' = $YmlFile; '@DATA@' = $DataDir; '@LOGS@' = $LogDir
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  foreach ($s in $Services) {
    Copy-Item -LiteralPath (Join-Path $svcDir 'WinSW.exe') -Destination (Join-Path $svcDir "$s.exe") -Force
    $xml = [IO.File]::ReadAllText((Join-Path $tpl "$s.xml"), $utf8)
    foreach ($k in $vars.Keys) { $xml = $xml.Replace($k, [Security.SecurityElement]::Escape($vars[$k])) }
    [IO.File]::WriteAllText((Join-Path $svcDir "$s.xml"), $xml, $utf8)
    $r = Invoke-Native (Join-Path $svcDir "$s.exe") @('install')
    if ($r.Code -ne 0) { Die "не удалось зарегистрировать службу ${s}: $($r.Output)" }
    $res = Get-CimInstance -ClassName Win32_Service -Filter "Name='$s'" | Invoke-CimMethod -MethodName Change `
      -Arguments @{ StartName = 'NT AUTHORITY\LocalService'; StartPassword = '' }
    if ($res.ReturnValue -ne 0) { Die "не удалось назначить службе $s учётную запись LocalService (код $($res.ReturnValue))" }
  }

  # --- rtspatom-admin в PATH ----------------------------------------------------------
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if (($machinePath -split ';') -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable('Path', ($machinePath.TrimEnd(';') + ';' + $InstallDir), 'Machine')
  }

  # --- Брандмауэр ---------------------------------------------------------------------
  if (-not $NoFirewall) {
    Say "Разрешаю входящие подключения на порт $($summary.port)/TCP"
    Get-NetFirewallRule -Name 'RTSPAtom-HTTP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name 'RTSPAtom-HTTP' -DisplayName "RTSP Atom (TCP $($summary.port))" `
      -Direction Inbound -Protocol TCP -LocalPort $summary.port -Action Allow -Profile Any | Out-Null
    # Видео WebRTC идёт напрямую от MediaMTX по порту ICE (UDP, запасной — TCP)
    Say "Разрешаю видео WebRTC на порт $($summary.icePort) (UDP и TCP)"
    foreach ($proto in 'UDP', 'TCP') {
      Get-NetFirewallRule -Name "RTSPAtom-ICE-$proto" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      New-NetFirewallRule -Name "RTSPAtom-ICE-$proto" -DisplayName "RTSP Atom видео WebRTC ($proto $($summary.icePort))" `
        -Direction Inbound -Protocol $proto -LocalPort $summary.icePort -Action Allow -Profile Any | Out-Null
    }
    # Приём от энкодеров, которые отправляют поток сами
    Say "Разрешаю приём от энкодеров: RTMP $($summary.rtmpPort)/TCP, SRT $($summary.srtPort)/UDP"
    foreach ($fw in @(@('RTSPAtom-RTMP', 'TCP', $summary.rtmpPort, 'RTMP'), @('RTSPAtom-SRT', 'UDP', $summary.srtPort, 'SRT'))) {
      Get-NetFirewallRule -Name $fw[0] -ErrorAction SilentlyContinue | Remove-NetFirewallRule
      New-NetFirewallRule -Name $fw[0] -DisplayName "RTSP Atom приём $($fw[3]) от энкодеров ($($fw[1]) $($fw[2]))" `
        -Direction Inbound -Protocol $fw[1] -LocalPort $fw[2] -Action Allow -Profile Any | Out-Null
    }
  }

  # --- Первый администратор -----------------------------------------------------------
  $r = Invoke-Native $Node @('--disable-warning=ExperimentalWarning', $Cli, 'list-users')
  if ($r.Code -ne 0) { Die "не удалось открыть базу: $($r.Output)" }
  if ($r.Output -match 'Пользователей нет') {
    if (-not $AdminPassword) {
      if (-not [Environment]::UserInteractive) {
        Warn 'Администратор не создан. Выполните: rtspatom-admin create-admin'
      } else {
        Say "Создание администратора «$AdminLogin»"
        while ($true) {
          $p1 = Read-Host 'Пароль (не короче 8 символов)' -AsSecureString
          $p2 = Read-Host 'Повторите пароль' -AsSecureString
          $t1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
          $t2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
          if ($t1.Length -lt 8) { Warn 'Пароль слишком короткий'; continue }
          if ($t1 -ne $t2) { Warn 'Пароли не совпадают'; continue }
          $AdminPassword = $t1
          break
        }
      }
    }
    if ($AdminPassword) {
      $env:RTSPATOM_NEW_PASSWORD = $AdminPassword
      try {
        $r = Invoke-Native $Node @('--disable-warning=ExperimentalWarning', $Cli, 'create-admin', $AdminLogin, '--password-env', 'RTSPATOM_NEW_PASSWORD')
      } finally { Remove-Item Env:\RTSPATOM_NEW_PASSWORD -ErrorAction SilentlyContinue }
      if ($r.Code -ne 0) { Die "не удалось создать администратора: $($r.Output)" }
      Write-Host "    $($r.Output)"
    }
  }

  # --- Ярлык на рабочем столе ---------------------------------------------------------
  $proto = if ($summary.tls) { 'https' } else { 'http' }
  $url = "${proto}://localhost:$($summary.port)/"
  $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  if ($desktop) {
    [IO.File]::WriteAllText((Join-Path $desktop 'RTSP Atom.url'), "[InternetShortcut]`r`nURL=$url`r`n", [Text.Encoding]::ASCII)
  }

  # --- Запуск -------------------------------------------------------------------------
  if (-not $NoStart) {
    Say 'Запускаю службы'
    Start-Service -Name 'rtspatom-mediamtx'
    Start-Service -Name 'rtspatom'
    Start-Sleep -Seconds 3
    $bad = $Services | Where-Object { (Get-Service -Name $_).Status -ne 'Running' }
    if ($bad) {
      Warn "Не запустились: $($bad -join ', '). Журналы: $LogDir"
      # Последняя ошибка из журнала MediaMTX — чаще всего это занятый порт
      $mtxLog = Join-Path $LogDir 'rtspatom-mediamtx.out.log'
      if (Test-Path $mtxLog) {
        $err = Get-Content $mtxLog -Tail 50 -ErrorAction SilentlyContinue | Where-Object { $_ -match ' ERR ' } | Select-Object -Last 1
        if ($err) {
          Warn "MediaMTX: $err"
          if ($err -match 'bind|Only one usage|address already in use') { Warn 'Порт занят другой программой. Запустите install.cmd ещё раз — он подберёт свободный.' }
        }
      }
    } else { Say 'Службы работают' }
  }

  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -First 1).IPAddress
  $version = if (Test-Path (Join-Path $InstallDir 'VERSION.txt')) { (Get-Content (Join-Path $InstallDir 'VERSION.txt') -Encoding UTF8 | Select-Object -First 1) } else { 'RTSP Atom' }
  Write-Host ''
  Say "Готово: $version"
  Write-Host "    Панель на этом компьютере:  $url  (ярлык «RTSP Atom» на рабочем столе)"
  if ($ip) { Write-Host "    С других компьютеров:       ${proto}://${ip}:$($summary.port)/" }
  Write-Host "    Видео WebRTC:               порт $($summary.icePort) UDP/TCP (открыт в брандмауэре Windows)"
  $archiveNow = $summary.archiveDir
  $r = Invoke-Native $Node @('--disable-warning=ExperimentalWarning', $Cli, 'archive-dir')
  if ($r.Code -eq 0 -and $r.Output) { $archiveNow = ($r.Output -split "`n" | Select-Object -Last 1).Trim() }
  try {
    $drive = (Get-Item $archiveNow).PSDrive
    Write-Host "    Архив:                      $archiveNow (свободно $([math]::Round($drive.Free / 1GB)) ГБ)"
  } catch { Write-Host "    Архив:                      $archiveNow" }
  Write-Host "    Энкодеры:                   RTMP порт $($summary.rtmpPort), SRT порт $($summary.srtPort) (адреса и ключ — в панели, «Потоки»)"
  Write-Host "    Журналы:                    $LogDir"
  Write-Host '    Утилита:                    rtspatom-admin help  (командная строка от имени администратора)'
  Write-Host "    Удаление:                   $InstallDir\uninstall.cmd"
  Finish 0
} catch {
  Die $_.Exception.Message
}
