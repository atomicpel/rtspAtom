# 📦 Как упаковать проект для скачивания

## 🎯 Цель

Создать ZIP архив со всеми файлами проекта для передачи заказчику или развёртывания на другом компьютере.

---

## 🚀 Быстрая упаковка (1 минута)

### Шаг 1: Очистите проект

```bash
# Удалите node_modules и dist
rm -rf node_modules dist

# Или на Windows
rmdir /s /q node_modules
rmdir /s /q dist
```

### Шаг 2: Создайте архив

#### Linux/macOS
```bash
# Перейдите в родительскую папку
cd ..

# Создайте ZIP архив
zip -r rtsp-server-115-obroshn-v1.0.0.zip rtsp-server/ \
  -x "rtsp-server/node_modules/*" \
  -x "rtsp-server/dist/*" \
  -x "rtsp-server/.git/*" \
  -x "rtsp-server/*.log"
```

#### Windows (PowerShell)
```powershell
# Перейдите в родительскую папку
cd ..

# Создайте ZIP архив
Compress-Archive -Path "rtsp-server\*" -DestinationPath "rtsp-server-115-obroshn-v1.0.0.zip" -Force
```

#### Windows (7-Zip)
```bash
# Если установлен 7-Zip
"C:\Program Files\7-Zip\7z.exe" a -tzip rtsp-server-115-obroshn-v1.0.0.zip rtsp-server\ -xr!node_modules -xr!dist -xr!.git
```

### Шаг 3: Проверьте архив

```bash
# Linux/macOS
unzip -l rtsp-server-115-obroshn-v1.0.0.zip | tail -1

# Должно показать: ~40 файлов, ~400 KB
```

---

## 📋 Что должно быть в архиве

### ✅ Должно быть:

**Документация (7 файлов):**
- ✅ README.md
- ✅ INSTALL.md
- ✅ ARCHITECTURE.md
- ✅ CHANGELOG.md
- ✅ SUMMARY.md
- ✅ DOWNLOAD.md
- ✅ FILES.md

**Исходный код (25 файлов):**
- ✅ src/components/*.tsx (5 файлов)
- ✅ src/pages/*.tsx (9 файлов)
- ✅ src/contexts/*.tsx (2 файла)
- ✅ src/lib/*.ts (5 файлов)
- ✅ src/App.tsx
- ✅ src/main.tsx
- ✅ src/index.css

**Конфигурация (4 файла):**
- ✅ package.json
- ✅ package-lock.json
- ✅ tsconfig.json
- ✅ vite.config.js

**Точка входа (1 файл):**
- ✅ index.html

**Итого:** ~37 файлов, ~400 KB

### ❌ НЕ должно быть:

- ❌ node_modules/ (~250 MB)
- ❌ dist/ (~1.8 MB)
- ❌ .git/ (если есть)
- ❌ *.log (логи)
- ❌ .env (секреты)
- ❌ .DS_Store (macOS)
- ❌ Thumbs.db (Windows)

---

## 📊 Размер архива

### Ожидаемый размер

- **Без node_modules:** ~400 KB
- **С node_modules:** ~250 MB (НЕ включайте!)
- **После распаковки:** ~400 KB

### Сжатие

ZIP архив сожмёт файлы примерно на 30-40%:
- **До сжатия:** ~400 KB
- **После сжатия:** ~250-280 KB

---

## 🔍 Проверка архива

### Шаг 1: Распакуйте в тестовую папку

```bash
mkdir test-install
cd test-install
unzip ../rtsp-server-115-obroshn-v1.0.0.zip
```

### Шаг 2: Проверьте структуру

```bash
tree -L 2
```

Должно быть:
```
rtsp-server/
├── README.md
├── INSTALL.md
├── ARCHITECTURE.md
├── CHANGELOG.md
├── SUMMARY.md
├── DOWNLOAD.md
├── FILES.md
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.js
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── index.css
    ├── components/
    ├── pages/
    ├── contexts/
    └── lib/
```

### Шаг 3: Установите и запустите

```bash
cd rtsp-server
npm install
npm run dev
```

Откройте: http://localhost:5173

Войдите: admin / admin

---

## 📝 Альтернативные способы упаковки

### Способ 1: Git archive (если есть Git)

```bash
# Создайте архив из Git репозитория
git archive --format=zip --output=rtsp-server-v1.0.0.zip HEAD

# Или с префиксом
git archive --format=zip --prefix=rtsp-server/ --output=rtsp-server-v1.0.0.zip HEAD
```

### Способ 2: Tar (Linux/macOS)

```bash
# Создайте tar.gz архив
tar -czf rtsp-server-v1.0.0.tar.gz \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  rtsp-server/
```

### Способ 3: rsync + zip (для больших проектов)

```bash
# Скопируйте файлы без node_modules
rsync -av --exclude='node_modules' --exclude='dist' --exclude='.git' \
  rtsp-server/ rtsp-server-clean/

# Создайте архив
zip -r rtsp-server-v1.0.0.zip rtsp-server-clean/

# Удалите временную папку
rm -rf rtsp-server-clean/
```

---

## 🔄 Автоматизация

### Скрипт для Linux/macOS

Создайте файл `package.sh`:

```bash
#!/bin/bash

VERSION="1.0.0"
PROJECT_NAME="rtsp-server-115-obroshn"
ARCHIVE_NAME="${PROJECT_NAME}-v${VERSION}.zip"

echo "📦 Упаковка проекта ${PROJECT_NAME} v${VERSION}..."

# Очистка
echo "🧹 Очистка..."
rm -rf node_modules dist

# Создание архива
echo "📦 Создание архива..."
cd ..
zip -r ${ARCHIVE_NAME} ${PROJECT_NAME}/ \
  -x "${PROJECT_NAME}/node_modules/*" \
  -x "${PROJECT_NAME}/dist/*" \
  -x "${PROJECT_NAME}/.git/*" \
  -x "${PROJECT_NAME}/*.log"

# Проверка
echo "✅ Проверка архива..."
unzip -l ${ARCHIVE_NAME} | tail -1

echo "✅ Готово! Архив: ${ARCHIVE_NAME}"
```

Запустите:
```bash
chmod +x package.sh
./package.sh
```

### Скрипт для Windows

Создайте файл `package.bat`:

```batch
@echo off
set VERSION=1.0.0
set PROJECT_NAME=rtsp-server-115-obroshn
set ARCHIVE_NAME=%PROJECT_NAME%-v%VERSION%.zip

echo 📦 Упаковка проекта %PROJECT_NAME% v%VERSION%...

:: Очистка
echo 🧹 Очистка...
rmdir /s /q node_modules 2>nul
rmdir /s /q dist 2>nul

:: Создание архива
echo 📦 Создание архива...
cd ..
powershell -Command "Compress-Archive -Path '%PROJECT_NAME%\*' -DestinationPath '%ARCHIVE_NAME%' -Force"

echo ✅ Готово! Архив: %ARCHIVE_NAME%
pause
```

Запустите:
```cmd
package.bat
```

---

## 📤 Передача архива

### Email
- Размер: ~250 KB
- Можно отправить как вложение

### Мессенджеры
- Telegram: до 2 GB
- WhatsApp: до 100 MB
- Slack: до 1 GB

### Облачные хранилища
- Google Drive: до 5 TB
- Dropbox: до 2 GB
- Яндекс.Диск: до 10 GB

### FTP/SFTP
```bash
# Загрузите на сервер
scp rtsp-server-v1.0.0.zip user@server:/path/to/upload/
```

---

## ✅ Финальная проверка

Перед передачей архива проверьте:

- [ ] Архив создан
- [ ] Размер ~250-400 KB
- [ ] Содержит ~37 файлов
- [ ] НЕ содержит node_modules
- [ ] НЕ содержит dist
- [ ] Распаковывается без ошибок
- [ ] `npm install` работает
- [ ] `npm run dev` запускается
- [ ] Вход admin/admin работает
- [ ] Тестовые потоки воспроизводятся

---

## 🎉 Готово!

Архив готов к передаче заказчику или развёртыванию на другом компьютере.

**Имя файла:** `rtsp-server-115-obroshn-v1.0.0.zip`  
**Размер:** ~250-400 KB  
**Количество файлов:** ~37  
**Версия:** 1.0.0

Удачи! 🚀

---

**© 2024 • 115 обрОсН • Все права защищены**
