# 📥 Инструкция по установке

## Системные требования

### Минимальные требования
- **ОС:** Windows 10/11, Linux (Ubuntu 20.04+, Astra Linux), macOS 10.15+
- **Node.js:** 18.0 или выше
- **npm:** 8.0 или выше
- **RAM:** 2 GB
- **Диск:** 500 MB свободного места
- **Браузер:** Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

### Рекомендуемые требования
- **Node.js:** 20 LTS
- **RAM:** 4 GB
- **Диск:** 1 GB свободного места
- **Сеть:** Локальная сеть с доступом к IP-камерам

---

## 🚀 Быстрая установка (5 минут)

### Шаг 1: Установка Node.js

#### Windows
1. Скачайте Node.js: https://nodejs.org/
2. Запустите установщик
3. Следуйте инструкциям
4. Проверьте установку:
```bash
node --version
npm --version
```

#### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Linux (Astra Linux)
```bash
# Если есть доступ к интернету
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Если сеть изолирована - используйте локальный пакет Node.js
# Скопируйте nodejs.tar.gz на сервер и распакуйте
tar -xzf nodejs.tar.gz
export PATH=$PATH:/path/to/nodejs/bin
```

#### macOS
```bash
# Через Homebrew
brew install node

# Или скачайте установщик: https://nodejs.org/
```

### Шаг 2: Скачивание проекта

#### Вариант A: Из архива
```bash
# Распакуйте архив rtsp-server.zip
unzip rtsp-server.zip
cd rtsp-server
```

#### Вариант B: Из Git репозитория
```bash
git clone https://your-repo-url/rtsp-server.git
cd rtsp-server
```

### Шаг 3: Установка зависимостей

```bash
npm install
```

Это установит все необходимые пакеты:
- React, TypeScript, Vite
- Tailwind CSS, Framer Motion
- hls.js, mpegts.js
- Recharts, Lucide React
- И другие зависимости

### Шаг 4: Запуск в режиме разработки

```bash
npm run dev
```

Вы увидите:
```
  VITE v5.0.0  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### Шаг 5: Открытие в браузере

Откройте: **http://localhost:5173**

### Шаг 6: Вход в систему

- **Логин:** `admin`
- **Пароль:** `admin`

Готово! Система работает.

---

## 🏭 Установка для продакшена

### Шаг 1: Сборка проекта

```bash
npm run build
```

Результат будет в папке `dist/`:
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
└── ...
```

### Шаг 2: Развёртывание на веб-сервере

#### Вариант A: Nginx

1. Скопируйте папку `dist/` на сервер:
```bash
scp -r dist/* user@server:/var/www/rtsp-server/
```

2. Создайте конфиг Nginx `/etc/nginx/sites-available/rtsp-server`:
```nginx
server {
    listen 80;
    server_name your-domain.local;
    
    root /var/www/rtsp-server;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Кэширование статики
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

3. Активируйте сайт:
```bash
sudo ln -s /etc/nginx/sites-available/rtsp-server /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### Вариант B: Apache

1. Скопируйте папку `dist/` на сервер:
```bash
scp -r dist/* user@server:/var/www/html/rtsp-server/
```

2. Создайте `.htaccess` в `/var/www/html/rtsp-server/`:
```apache
RewriteEngine On
RewriteBase /
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

3. Включите mod_rewrite:
```bash
sudo a2enmod rewrite
sudo systemctl restart apache2
```

#### Вариант C: Простой HTTP сервер (для тестирования)

```bash
# Установите serve
npm install -g serve

# Запустите сервер
serve -s dist -l 8080
```

Откройте: **http://localhost:8080**

### Шаг 3: Настройка HTTPS (опционально)

#### Самоподписанный сертификат (для изолированной сети)

```bash
# Создайте папку для сертификатов
mkdir -p /etc/nginx/ssl

# Сгенерируйте самоподписанный сертификат
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/rtsp.key \
  -out /etc/nginx/ssl/rtsp.crt

# Обновите конфиг Nginx
server {
    listen 443 ssl;
    server_name your-domain.local;
    
    ssl_certificate /etc/nginx/ssl/rtsp.crt;
    ssl_certificate_key /etc/nginx/ssl/rtsp.key;
    
    root /var/www/rtsp-server;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Перенаправление HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.local;
    return 301 https://$server_name$request_uri;
}
```

---

## 🎥 Настройка MediaMTX (для RTSP камер)

### Шаг 1: Скачивание MediaMTX

#### Windows
1. Скачайте: https://github.com/bluenviron/mediamtx/releases
2. Распакуйте `mediamtx_windows.zip`
3. Запустите `mediamtx.exe`

#### Linux
```bash
# Скачайте последнюю версию
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_linux_amd64.tar.gz

# Распакуйте
tar -xzf mediamtx_linux_amd64.tar.gz

# Запустите
./mediamtx
```

#### macOS
```bash
# Через Homebrew
brew install mediamtx

# Или скачайте бинарник
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_darwin_amd64.tar.gz
tar -xzf mediamtx_darwin_amd64.tar.gz
./mediamtx
```

### Шаг 2: Конфигурация

Откройте файл `mediamtx.yml`:

```yaml
# Общие настройки
logLevel: info
logDestinations: [stdout]

# HTTP сервер
api: yes
apiAddress: :9997

# Metrics
metrics: yes
metricsAddress: :9998

# RTSP сервер
rtsp: yes
rtspAddress: :8554
rtspEncryption: "no"

# RTMP сервер
rtmp: yes
rtmpAddress: :1935

# HLS сервер
hls: yes
hlsAddress: :8888

# Пути (камеры)
paths:
  # Пример 1: RTSP камера
  camera1:
    source: rtsp://192.168.1.100:554/stream1
    sourceProtocol: tcp
    sourceOnDemand: yes
  
  # Пример 2: Другая RTSP камера
  camera2:
    source: rtsp://192.168.1.101:554/stream1
    sourceProtocol: tcp
    sourceOnDemand: yes
  
  # Пример 3: HLS поток (обход CORS)
  ntv:
    source: https://cdn.ntv.ru/unknown_russia/tracks-v1a1/playlist.m3u8
    sourceOnDemand: yes
  
  # Пример 4: Локальный файл
  test:
    source: publisher
```

### Шаг 3: Запуск MediaMTX

```bash
./mediamtx
```

Вы увидите:
```
2024/01/01 12:00:00 INF [RTSP] listener opened on :8554 (TCP), :8554 (UDP)
2024/01/01 12:00:00 INF [RTMP] listener opened on :1935
2024/01/01 12:00:00 INF [HLS] listener opened on :8888
```

### Шаг 4: Использование в RTSP Сервере

В RTSP Сервере добавьте потоки:

- **HTTP-FLV** (низкая задержка): `http://localhost:8888/camera1`
- **HLS**: `http://localhost:8888/camera1/hls`

Пример:
1. Откройте "Компьютеры"
2. Добавьте компьютер "Офис"
3. Добавьте поток:
   - Название: "Камера 1"
   - URL: `http://localhost:8888/camera1/hls`
   - Протокол: HLS (определяется автоматически)
4. Видео начнёт воспроизводиться

### Шаг 5: Автозапуск MediaMTX (Linux)

Создайте systemd сервис `/etc/systemd/system/mediamtx.service`:

```ini
[Unit]
Description=MediaMTX Media Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/mediamtx
ExecStart=/opt/mediamtx/mediamtx
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Активируйте:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mediamtx
sudo systemctl start mediamtx
sudo systemctl status mediamtx
```

---

## 🔧 Устранение неполадок

### Проблема: `npm install` не работает

**Решение:**
```bash
# Очистите кэш npm
npm cache clean --force

# Удалите node_modules и package-lock.json
rm -rf node_modules package-lock.json

# Установите заново
npm install
```

### Проблема: Порт 5173 занят

**Решение:**
```bash
# Запустите на другом порту
npm run dev -- --port 3000
```

### Проблема: Видео не воспроизводится

**Решение:**
1. Откройте консоль браузера (F12)
2. Проверьте ошибки
3. Убедитесь что URL доступен
4. Проверьте CORS заголовки
5. Используйте MediaMTX для конвертации

### Проблема: MediaMTX не запускается

**Решение:**
```bash
# Проверьте что порт не занят
sudo lsof -i :8554
sudo lsof -i :8888

# Если занят - убейте процесс
sudo kill -9 <PID>

# Запустите заново
./mediamtx
```

### Проблема: Не могу войти в систему

**Решение:**
```bash
# Очистите localStorage
# Откройте консоль браузера (F12) и выполните:
localStorage.clear()

# Перезагрузите страницу
# Войдите с admin/admin
```

---

## 📊 Мониторинг и логи

### Логи RTSP Сервера

Логи хранятся в localStorage и доступны на странице "Журналы".

### Логи MediaMTX

```bash
# Просмотр логов
journalctl -u mediamtx -f

# Или если запущен напрямую
./mediamtx 2>&1 | tee mediamtx.log
```

### Метрики MediaMTX

```bash
# Prometheus метрики
curl http://localhost:9998/metrics
```

---

## 🔄 Обновление

### Шаг 1: Остановите сервер

```bash
# Если запущен в режиме разработки - Ctrl+C

# Если запущен как сервис
sudo systemctl stop rtsp-server
```

### Шаг 2: Создайте резервную копию

```bash
# Сохраните настройки
cp -r dist/ dist-backup-$(date +%Y%m%d)/
```

### Шаг 3: Обновите код

```bash
# Из Git
git pull

# Или распакуйте новую версию
unzip rtsp-server-new.zip
```

### Шаг 4: Переустановите зависимости

```bash
npm install
```

### Шаг 5: Пересоберите

```bash
npm run build
```

### Шаг 6: Запустите

```bash
# Режим разработки
npm run dev

# Или продакшен
sudo systemctl start rtsp-server
```

---

## 📞 Поддержка

### Документация
- README.md — основное описание
- ARCHITECTURE.md — архитектура системы
- CHANGELOG.md — история изменений

### Технологии
- Node.js: https://nodejs.org/
- React: https://react.dev/
- MediaMTX: https://github.com/bluenviron/mediamtx

### Контакты
- Email: support@example.com
- Telegram: @rtsp_support

---

## ✅ Чек-лист установки

- [ ] Node.js установлен (версия 18+)
- [ ] npm установлен (версия 8+)
- [ ] Проект скачан/клонирован
- [ ] Зависимости установлены (`npm install`)
- [ ] Сервер запущен (`npm run dev`)
- [ ] Браузер открыт (http://localhost:5173)
- [ ] Вход выполнен (admin/admin)
- [ ] MediaMTX установлен (для RTSP камер)
- [ ] MediaMTX настроен (mediamtx.yml)
- [ ] MediaMTX запущен
- [ ] Тестовые потоки воспроизводятся
- [ ] RTSP камеры добавлены (если есть)

---

**Версия документа:** 1.0  
**Дата обновления:** 2024  
**Совместимость:** Windows, Linux, macOS
