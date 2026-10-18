# Проверка Windows-пакета на чистой машине (GitHub Actions, windows-runner, права администратора).
# Установщик запускается в Windows PowerShell 5.1 — как у пользователя Windows 11;
# сам тест — в PowerShell 7 (pwsh).
#   pwsh scripts/windows-test.ps1 -Zip out\rtspatom-...-windows-x64.zip
param([Parameter(Mandatory)][string]$Zip)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Port = 18080
$Password = 'ci-пароль-12345'
$DataRoot = Join-Path $env:ProgramData 'RTSPAtom'
$InstallDir = Join-Path $env:ProgramFiles 'RTSPAtom'
$W = Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) 'rtspatom-wtest'
$procs = @()

function Annotate([string]$title, [string]$text) {
  $t = ($text -replace '%', '%25' -replace "`r", '' -replace "`n", '%0A')
  Write-Host "::error title=$title::$t"
}
function Fail([string]$m) {
  Write-Host "::error title=Windows::$m"
  Write-Host "ОШИБКА: $m" -ForegroundColor Red
  if (Test-Path "$DataRoot\logs") {
    Get-ChildItem "$DataRoot\logs" -File -ErrorAction SilentlyContinue | ForEach-Object {
      $tail = (Get-Content $_.FullName -Tail 30 -ErrorAction SilentlyContinue) -join "`n"
      if ($tail) { Annotate "log $($_.Name)" $tail }
    }
  }
  foreach ($f in 'camera.log', 'ffmpeg.log') {
    if (Test-Path "$W\$f") { Write-Host "::group::$f"; Get-Content "$W\$f" -Tail 40; Write-Host '::endgroup::' }
  }
  exit 1
}
function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }

function Install-Bundle([string[]]$Extra) {
  $dir = (Get-ChildItem $W -Directory | Where-Object Name -like 'rtspatom-*' | Select-Object -First 1).FullName
  $log = Join-Path $W "install-$([guid]::NewGuid().ToString('N').Substring(0,6)).log"
  $p = Start-Process powershell.exe -Wait -PassThru -NoNewWindow -RedirectStandardOutput $log `
    -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$dir\install.ps1`"") + $Extra)
  $text = Get-Content $log -Raw -Encoding UTF8
  Write-Host $text
  if ($p.ExitCode -ne 0 -or $text -match 'Ошибка:') {
    Annotate 'install.ps1' ((($text -split "`n") | Select-Object -Last 40) -join "`n")
    Fail "install.ps1 завершился с кодом $($p.ExitCode)"
  }
}

function New-Session([string]$base) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ login = 'admin'; password = $Password } | ConvertTo-Json
  Invoke-RestMethod "$base/api/auth/login" -Method Post -WebSession $s -SkipCertificateCheck `
    -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-RTSPAtom' = '1' } -Body $body | Out-Null
  return $s
}
function Api([string]$method, [string]$url, $body, $s) {
  $p = @{ Uri = $url; Method = $method; WebSession = $s; SkipCertificateCheck = $true; Headers = @{ 'X-RTSPAtom' = '1' } }
  if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Depth 5); $p.ContentType = 'application/json; charset=utf-8' }
  Invoke-RestMethod @p
}
function Wait-Http([string]$url, [int]$sec = 30) {
  for ($i = 0; $i -lt $sec * 2; $i++) {
    try { Invoke-WebRequest $url -SkipCertificateCheck -TimeoutSec 3 | Out-Null; return } catch { Start-Sleep -Milliseconds 500 }
  }
  Fail "нет ответа от $url"
}

try {
  Remove-Item $W -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $W | Out-Null
  Expand-Archive -LiteralPath $Zip -DestinationPath $W
  $bundle = (Get-ChildItem $W -Directory | Select-Object -First 1).FullName

  # ---------- Занятые порты ----------
  # Имитируем «чужую» программу на порту панели и на порту HLS MediaMTX:
  # установщик должен сам взять следующие свободные порты.
  Step "Занимаю порты $Port и 8888 посторонними процессами"
  foreach ($bp in @(@($Port, '0.0.0.0'), @(8888, '127.0.0.1'))) {
    $procs += Start-Process "$bundle\node\node.exe" -PassThru -NoNewWindow `
      -ArgumentList @('-e', "`"require('net').createServer().listen($($bp[0]),'$($bp[1])')`"")
  }
  Start-Sleep -Seconds 1

  # ---------- Установка ----------
  Step 'Установка (Windows PowerShell 5.1)'
  Install-Bundle @('-Port', $Port, '-AdminPassword', "`"$Password`"")
  $cfg = Get-Content "$DataRoot\config.json" -Raw | ConvertFrom-Json
  if ($cfg.port -eq $Port) { Fail "установщик занял уже занятый порт $Port" }
  if (([Uri]$cfg.mediamtx.hlsUrl).Port -eq 8888) { Fail 'установщик занял уже занятый порт 8888' }
  if ((Get-Content "$DataRoot\mediamtx.yml" -Raw) -notmatch "hlsAddress: 127\.0\.0\.1:$(([Uri]$cfg.mediamtx.hlsUrl).Port)") { Fail 'адрес HLS в mediamtx.yml не совпадает с config.json' }
  Write-Host "Порты подобраны: панель $($cfg.port), HLS $(([Uri]$cfg.mediamtx.hlsUrl).Port), API $(([Uri]$cfg.mediamtx.apiUrl).Port)"
  $Port = [int]$cfg.port

  foreach ($s in 'rtspatom', 'rtspatom-mediamtx') {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$s'"
    if (-not $svc) { Fail "служба $s не зарегистрирована" }
    if ($svc.State -ne 'Running') { Fail "служба $s не запущена ($($svc.State))" }
    if ($svc.StartMode -ne 'Auto') { Fail "служба $s не в автозапуске ($($svc.StartMode))" }
    if ($svc.StartName -notmatch 'LocalService') { Fail "служба $s работает от $($svc.StartName), ожидалась LocalService" }
  }
  if (-not (Get-NetFirewallRule -Name 'RTSPAtom-HTTP' -ErrorAction SilentlyContinue)) { Fail 'нет правила брандмауэра' }
  $adminOut = & cmd.exe /c "`"$InstallDir\rtspatom-admin.cmd`" list-users" 2>&1
  if (($adminOut -join "`n") -notmatch 'admin') { Fail "rtspatom-admin не работает: $adminOut" }

  $B = "http://127.0.0.1:$Port"
  Wait-Http "$B/api/auth/status"
  $st = Invoke-RestMethod "$B/api/auth/status"
  if ($st.platform -ne 'windows') { Fail "platform = $($st.platform)" }
  if ((Invoke-WebRequest "$B/").Content -notmatch 'id="root"') { Fail 'фронтенд не отдаётся' }
  $S = New-Session $B

  for ($i = 0; $i -lt 40; $i++) { if ((Api GET "$B/api/system" $null $S).mediamtx.reachable) { break }; Start-Sleep -Milliseconds 500 }
  $sys = Api GET "$B/api/system" $null $S
  if (-not $sys.mediamtx.reachable) { Fail "панель не видит MediaMTX: $($sys.mediamtx.lastError)" }
  Write-Host "Система: $($sys.platform), MediaMTX $($sys.mediamtx.version)"

  # MediaMTX не должен слушать внешние адреса
  $mtx = Get-Process mediamtx | Where-Object { $_.Path -like "$InstallDir*" }
  $listen = @(Get-NetTCPConnection -State Listen -OwningProcess $mtx.Id | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" })
  $listen += @(Get-NetUDPEndpoint -OwningProcess $mtx.Id -ErrorAction SilentlyContinue | ForEach-Object { "udp $($_.LocalAddress):$($_.LocalPort)" })
  $exposed = $listen | Where-Object { $_ -notmatch '^(udp )?(127\.0\.0\.1|::1):' }
  if ($exposed) { Fail "MediaMTX слушает внешние адреса: $($exposed -join ', ')" }
  Write-Host "MediaMTX слушает: $($listen -join ', ')"

  # ---------- Тестовая камера ----------
  Step 'Тестовая камера RTSP (MediaMTX + ffmpeg)'
  @'
logLevel: info
api: no
rtsp: yes
rtspAddress: 127.0.0.1:18554
rtpAddress: :18000
rtcpAddress: :18001
rtmp: no
hls: no
webrtc: no
srt: no
moq: no
paths:
  all_others:
'@ | Set-Content "$W\camera.yml" -Encoding ascii
  $procs += Start-Process "$bundle\mediamtx\mediamtx.exe" -ArgumentList "`"$W\camera.yml`"" -PassThru -NoNewWindow `
    -RedirectStandardOutput "$W\camera.log" -RedirectStandardError "$W\camera.err"
  Start-Sleep -Seconds 1
  $procs += Start-Process ffmpeg -PassThru -NoNewWindow -RedirectStandardError "$W\ffmpeg.log" -ArgumentList @(
    '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '25', '-pix_fmt', 'yuv420p',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', 'rtsp://127.0.0.1:18554/cam')
  Start-Sleep -Seconds 2

  # ---------- Камера через панель ----------
  Step 'Добавление камеры и видео через панель'

  $probe = Api POST "$B/api/streams/probe" @{ url = 'rtsp://127.0.0.1:18554/cam'; transport = 'tcp' } $S
  if (-not $probe.ok -or ($probe.tracks -notcontains 'H264')) { Fail "проверка камеры: $($probe | ConvertTo-Json -Compress)" }
  $stream = Api POST "$B/api/streams" @{ name = 'Камера въезда (Windows)'; url = 'rtsp://127.0.0.1:18554/cam'; transport = 'tcp' } $S
  if ($stream.name -ne 'Камера въезда (Windows)') { Fail "кириллица искажена: $($stream.name)" }
  $status = ''
  for ($i = 0; $i -lt 40; $i++) {
    $status = ((Api GET "$B/api/streams" $null $S) | Where-Object id -eq $stream.id).status
    if ($status -eq 'online') { break }
    Start-Sleep -Seconds 1
  }
  if ($status -ne 'online') { Fail "поток не перешёл в online ($status)" }

  $master = $null
  for ($i = 0; $i -lt 30; $i++) {
    try { $master = (Invoke-WebRequest "$B/hls/$($stream.id)/index.m3u8" -WebSession $S).Content; break } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $master) { Fail 'index.m3u8 не получен' }
  if ($master -is [byte[]]) { $master = [Text.Encoding]::UTF8.GetString($master) }
  $variant = ($master -split "`n" | Where-Object { $_ -and $_ -notmatch '^#' -and $_ -match '\.m3u8' } | Select-Object -First 1).Trim()
  $vtext = (Invoke-WebRequest "$B/hls/$($stream.id)/$variant" -WebSession $S).Content
  if ($vtext -is [byte[]]) { $vtext = [Text.Encoding]::UTF8.GetString($vtext) }
  $seg = $null; $gap = $false
  foreach ($line in $vtext -split "`n") {
    $line = $line.Trim()
    if ($line -like '#EXT-X-GAP*') { $gap = $true; continue }
    if (-not $line -or $line.StartsWith('#')) { continue }
    if (-not $gap) { $seg = $line; break }
    $gap = $false
  }
  if (-not $seg -and $vtext -match '#EXT-X-PART:[^\n]*URI="([^"]+)"') { $seg = $Matches[1] }
  if (-not $seg) { Fail "в плейлисте нет сегментов: $vtext" }
  $r = Invoke-WebRequest "$B/hls/$($stream.id)/$seg" -WebSession $S
  $size = $r.RawContentLength
  if ($size -lt 500) { Fail "сегмент слишком мал ($size байт)" }
  Write-Host "Сегмент $seg получен через панель: $size байт"
  try { Invoke-WebRequest "$B/hls/$($stream.id)/index.m3u8" | Out-Null; Fail 'видео отдаётся без входа' } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { Fail "без входа ожидался код 401, получен $($_.Exception.Response.StatusCode.value__)" }
  }

  # ---------- Перезапуск службы ----------
  Step 'Перезапуск службы rtspatom'
  Restart-Service rtspatom
  Wait-Http "$B/api/auth/status"

  # ---------- Обновление с включением HTTPS ----------
  Step 'Повторная установка с -Tls (обновление, данные должны сохраниться)'
  Install-Bundle @('-Tls')
  $cfg2 = Get-Content "$DataRoot\config.json" -Raw | ConvertFrom-Json
  if ($cfg2.port -ne $Port) { Fail "при обновлении порт сменился: $Port -> $($cfg2.port)" }
  $BS = "https://127.0.0.1:$Port"
  Wait-Http "$BS/api/auth/status"
  $S2 = New-Session $BS
  $streamsAfter = Api GET "$BS/api/streams" $null $S2
  if (-not ($streamsAfter | Where-Object id -eq $stream.id)) { Fail 'после обновления пропали данные' }
  if (-not (Api GET "$BS/api/system" $null $S2).tlsEnabled) { Fail 'HTTPS не включился' }
  Write-Host 'HTTPS работает, данные сохранены'

  # ---------- Удаление ----------
  Step 'Удаление (данные сохраняются)'
  $p = Start-Process powershell.exe -Wait -PassThru -NoNewWindow `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$InstallDir\uninstall.ps1`"", '-Yes')
  if ($p.ExitCode -ne 0) { Fail "uninstall.ps1 завершился с кодом $($p.ExitCode)" }
  if (Get-Service rtspatom -ErrorAction SilentlyContinue) { Fail 'служба rtspatom не удалена' }
  if (Get-Service rtspatom-mediamtx -ErrorAction SilentlyContinue) { Fail 'служба rtspatom-mediamtx не удалена' }
  if (Test-Path $InstallDir) { Fail "каталог $InstallDir не удалён" }
  if (-not (Test-Path "$DataRoot\data\rtspatom.db")) { Fail 'база удалена без -Purge' }
  if (Get-NetFirewallRule -Name 'RTSPAtom-HTTP' -ErrorAction SilentlyContinue) { Fail 'правило брандмауэра не удалено' }

  Write-Host "::notice title=Windows::Занятые порты обойдены (панель на $Port), установка, службы (LocalService), камера RTSP -> MediaMTX -> панель -> HLS ($size байт), HTTPS, обновление и удаление проверены на $((Get-CimInstance Win32_OperatingSystem).Caption)"
  Write-Host 'Windows: всё работает' -ForegroundColor Green
} catch {
  Fail "$($_.Exception.Message) (строка $($_.InvocationInfo.ScriptLineNumber))"
} finally {
  $procs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}
