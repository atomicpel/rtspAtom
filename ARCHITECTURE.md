# Архитектура RTSP Atom

```
                ┌──────────────────────── сервер Astra Linux ────────────────────────┐
 Камеры ─RTSP──▶│ MediaMTX  127.0.0.1:9997 (API)   127.0.0.1:8888 (HLS)              │
                │     ▲ пути s_<id> добавляет панель        │                         │
                │     │ /v3/config/paths/*                   ▼                         │
                │ rtspatom (Node.js) :8080 ── /api/* ── SQLite /var/lib/rtspatom      │
                │                       └─ /hls/<id>/* → прокси с проверкой прав      │
                └────────────────────────────────────────────────────────────────────┘
                                         ▲ HTTP(S), cookie-сессия
                                     Браузеры операторов
```

## Сервер (`server/`)

Внешних npm-зависимостей нет, используются только модули Node.js (22.13+):

- `lib/app.js`: обработка запросов. Глобальный IP-фильтр, ограничение частоты API, сессии, защита от CSRF
  (изменяющие запросы обязаны нести заголовок `X-RTSPAtom: 1`), раздача фронтенда.
- `lib/db.js`: SQLite (`node:sqlite`) со встроенными миграциями.
- `lib/security.js`: пароли scrypt, токены сессий (в базе хранится только SHA-256), проверка IPv4/IPv6 CIDR.
- `lib/mediamtx.js`: клиент Control API v3 и класс `StreamSync`. Он приводит пути MediaMTX
  в соответствие с базой (при изменениях и раз в 30 с), опрашивает состояние потоков (раз в 5 с)
  и пишет в журнал переходы «в сети / нет сигнала».
- `lib/metrics.js`: CPU, RAM и сеть из `/proc`.
- `routes/`: API (`auth`, `users`, `computers`, `system`, `wall`) и HLS-прокси (`hls.js`).
- `cli.js`: утилита `rtspatom-admin`.

### Безопасность

- Сессия хранится в cookie `HttpOnly; SameSite=Strict` (с `Secure` при HTTPS), срок продлевается при активности.
- Перебор паролей: после N неудачных попыток за 15 минут вход с этого IP блокируется на 15 минут.
- Пароли камер не передаются в браузер. Логин и пароль, вписанные в URL, сервер выносит в отдельные поля.
- Видео доступно только через `/hls/…` после входа и только для камер, к которым у пользователя есть доступ.
- Нельзя удалить или отключить последнего администратора, а также добавить IP-правило, которое заблокирует текущий адрес.
  С `127.0.0.1` доступ есть всегда.
- Первого администратора можно создать только с самого сервера или командой `rtspatom-admin`.

### API (кратко)

| Метод | Путь | Роль |
|---|---|---|
| GET | `/api/auth/status`, POST `/api/auth/login`, `/api/auth/logout`, `/api/auth/setup` | все |
| GET | `/api/auth/me`, POST `/api/auth/password` | вошедший |
| GET | `/api/computers`, `/api/metrics`, `/api/system`, `/api/wall/*` | наблюдатель+ |
| GET | `/api/logs`, `/api/logs/export` | оператор+ |
| * | `/api/computers*`, `/api/streams*`, `/api/users*`, `/api/ip-rules*`, `/api/settings` | администратор |

## Веб-интерфейс (`src/`)

Это React-приложение без маршрутизатора: страницы переключаются через состояние. Данные приходят из `src/lib/api.ts`,
периодическое обновление делает `usePolling`. Плеер (`components/VideoPlayer.tsx`) построен на hls.js
в режиме низкой задержки и сам переподключается при потере сигнала.

## Пакет и установка

`scripts/build-bundle.sh` собирает каталог `rtspatom-<версия>-astra-x86_64`:

```
install.sh  uninstall.sh  INSTALL.md  VERSION  SHA256SUMS
node/bin/node             — официальная сборка Node.js (glibc ≥ 2.28)
mediamtx/mediamtx         — официальная сборка MediaMTX
app/server/  app/public/  — сервер и собранный фронтенд
deploy/                   — службы systemd, mediamtx.yml, rtspatom-admin
```

После установки файлы лежат так: `/opt/rtspatom` — программа, `/etc/rtspatom` — `config.json`, `mediamtx.yml` и `tls/`,
`/var/lib/rtspatom` — база. Обе службы работают от пользователя `rtspatom`.
