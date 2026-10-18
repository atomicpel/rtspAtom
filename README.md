# RTSP Atom — панель управления видеотрансляцией

Веб-панель для просмотра IP-камер в изолированной сети. Ставится на **Astra Linux SE 1.8** и **Windows 11**.

- Видеостена во весь экран: 1, 4, 9 или 16 камер, полноэкранный режим браузера для стены и отдельной камеры,
  перетаскивание камер между ячейками, сохранённые раскладки.
- Камеры по RTSP, RTMP, HLS, SRT и UDP. Приём через MediaMTX, показ в браузере по **WebRTC с задержкой ~0,3 с**
  (запасной путь — LL-HLS, 1–3 с).
- Пользователи с ролями: администратор, оператор, наблюдатель. Доступ ограничивается по камерам и IP-адресам.
- Глобальный IP-фильтр (белый и чёрный списки), блокировка перебора паролей, журнал действий с экспортом в CSV.
- Состояние каждой камеры (в сети, нет сигнала), кодек, число зрителей.
- Работает **без интернета**. Пакет содержит Node.js и MediaMTX, ставится одной командой.

## Установка

Готовые офлайн-пакеты лежат в **Releases**:

| Система | Пакет | Инструкция |
|---|---|---|
| Astra Linux SE 1.8 (x86_64) | `rtspatom-<версия>-astra-x86_64.tar.gz` → `sudo ./install.sh` | [INSTALL.md](INSTALL.md) |
| Windows 11 (x64) | `rtspatom-<версия>-windows-x64.zip` → `install.cmd` | [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) |

Пакеты собирает GitHub Actions (`.github/workflows/offline-bundle.yml`). Перед публикацией сборка проходит:

- проверку типов и тесты сервера;
- сквозной тест «камера → MediaMTX → панель → HLS» на Linux;
- пробную установку в Debian 12 и в образе Astra Linux 1.8;
- на Windows Server 2025 (основа та же, что у Windows 11): установку служб, тот же видеотест,
  включение HTTPS при обновлении и удаление.

## Устройство

| Каталог | Что внутри |
|---|---|
| `src/` | веб-интерфейс: React, TypeScript, Vite, Tailwind |
| `server/` | сервер на Node.js без внешних зависимостей: `node:http`, `node:sqlite`, `node:crypto` |
| `server/test/` | тесты API (`npm run test:server`) |
| `deploy/` | установщик для Linux, службы systemd, конфигурация MediaMTX, утилита `rtspatom-admin` |
| `deploy/windows/` | установщик для Windows (`install.ps1`), шаблоны служб WinSW, `rtspatom-admin.cmd` |
| `scripts/` | сборка офлайн-пакетов, сквозной тест, тесты установщиков |

Подробнее — [ARCHITECTURE.md](ARCHITECTURE.md).

## Разработка

```bash
npm install
npm run build                   # фронтенд в dist/
npm run server                  # сервер на :8080 (нужен Node.js 22.13+), отдаёт dist/
npm run dev                     # Vite на :3000 с проксированием /api, /hls и /webrtc на :8080
npm run test:server             # тесты сервера
```

Для видео нужен запущенный MediaMTX с конфигурацией `deploy/mediamtx.yml`.
Конфигурация сервера задаётся файлом `RTSPATOM_CONFIG` (по умолчанию `/etc/rtspatom/config.json`)
или переменными `RTSPATOM_PORT`, `RTSPATOM_DATA_DIR`, `RTSPATOM_MEDIAMTX_API` и `RTSPATOM_MEDIAMTX_HLS`.
