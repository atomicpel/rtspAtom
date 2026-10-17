# RTSP Atom — панель управления видеотрансляцией

**115 обрОсН** • веб-панель для просмотра IP-камер в изолированной сети на Astra Linux SE 1.8.

- Видеостена 1×1 … 4×4, сохранённые раскладки, полноэкранный режим.
- Камеры по RTSP, RTMP, HLS, SRT и UDP. Приём через MediaMTX, показ в браузере по LL-HLS.
- Пользователи с ролями: администратор, оператор, наблюдатель. Доступ ограничивается по компьютерам и IP-адресам.
- Глобальный IP-фильтр (белый и чёрный списки), блокировка перебора паролей, журнал действий с экспортом в CSV.
- Мониторинг: загрузка CPU и RAM, сетевой трафик, состояние камер, число зрителей.
- Работает **без интернета**. Пакет содержит Node.js и MediaMTX, ставится одной командой.

## Установка

См. **[INSTALL.md](INSTALL.md)**. Коротко:

```bash
tar -xzf rtspatom-*-astra-x86_64.tar.gz && cd rtspatom-*-astra-x86_64
sudo ./install.sh
```

Готовый пакет собирает GitHub Actions (`.github/workflows/offline-bundle.yml`) и выкладывает его в **Releases**.
Перед публикацией сборка проходит проверку типов, тесты сервера, сквозной тест «камера → MediaMTX → панель → HLS»
и пробную установку в чистом Debian 12, на котором основана Astra 1.8.

## Устройство

| Каталог | Что внутри |
|---|---|
| `src/` | веб-интерфейс: React, TypeScript, Vite, Tailwind |
| `server/` | сервер на Node.js без внешних зависимостей: `node:http`, `node:sqlite`, `node:crypto` |
| `server/test/` | тесты API (`npm run test:server`) |
| `deploy/` | установщик, службы systemd, конфигурация MediaMTX, утилита `rtspatom-admin` |
| `scripts/` | сборка офлайн-пакета, сквозной тест, тест установщика |

Подробнее — [ARCHITECTURE.md](ARCHITECTURE.md).

## Разработка

```bash
npm install
npm run build                   # фронтенд в dist/
npm run server                  # сервер на :8080 (нужен Node.js 22.13+), отдаёт dist/
npm run dev                     # Vite на :3000 с проксированием /api и /hls на :8080
npm run test:server             # тесты сервера
```

Для видео нужен запущенный MediaMTX с конфигурацией `deploy/mediamtx.yml`.
Конфигурация сервера задаётся файлом `RTSPATOM_CONFIG` (по умолчанию `/etc/rtspatom/config.json`)
или переменными `RTSPATOM_PORT`, `RTSPATOM_DATA_DIR`, `RTSPATOM_MEDIAMTX_API` и `RTSPATOM_MEDIAMTX_HLS`.
