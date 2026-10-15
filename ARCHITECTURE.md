# 🏗️ Архитектура системы

## Обзор

**RTSP Сервер "115 обрОсН"** — это одностраничное приложение (SPA) на React с клиентской архитектурой. Все данные хранятся в localStorage браузера, что делает систему полностью автономной и не требующей серверной инфраструктуры для базовой работы.

---

## 📐 Архитектурная диаграмма

```
┌─────────────────────────────────────────────────────────────┐
│                        Браузер (Клиент)                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   React Application                   │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │              Pages (Страницы)                    │  │   │
│  │  │  • DashboardPage    • VideoWallPage             │  │   │
│  │  │  • ComputersPage    • UsersPage                 │  │   │
│  │  │  • IpFilterPage     • LogsPage                  │  │   │
│  │  │  • SettingsPage     • AboutPage                 │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  │                         ↓                               │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │            Components (Компоненты)               │  │   │
│  │  │  • VideoPlayer (hls.js + mpegts.js)             │  │   │
│  │  │  • Layout, Toast, AnimatedCard                  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  │                         ↓                               │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │              Contexts (Контексты)                │  │   │
│  │  │  • AuthContext (Аутентификация)                 │  │   │
│  │  │  • ThemeContext (Тема)                          │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  │                         ↓                               │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │                Lib (Библиотеки)                  │  │   │
│  │  │  • storage.ts (localStorage API)                │  │   │
│  │  │  • logger.ts (Система логирования)              │  │   │
│  │  │  • rtsp-mock.ts (Mock RTSP модуль)              │  │   │
│  │  │  • ip-check.ts (Проверка IP/CIDR)               │  │   │
│  │  │  • types.ts (TypeScript типы)                   │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  │                         ↓                               │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │              localStorage (Хранилище)            │  │   │
│  │  │  • rtsp_users         • rtsp_computers          │  │   │
│  │  │  • rtsp_ip_rules      • rtsp_logs               │  │   │
│  │  │  • rtsp_sessions      • rtsp_settings           │  │   │
│  │  │  • rtsp_login_attempts                           │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Video Streaming (Видео потоки)           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   hls.js    │  │  mpegts.js  │  │  <video>    │  │   │
│  │  │  (HLS/m3u8) │  │ (FLV/TS)    │  │  (MP4/WebM) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                         ↓
         ┌───────────────────────────────┐
         │      External Services        │
         │  ┌─────────────────────────┐  │
         │  │      MediaMTX           │  │
         │  │  (RTSP → HLS/FLV)       │  │
         │  │  • RTSP сервер (:8554)  │  │
         │  │  • HLS сервер (:8888)   │  │
         │  │  • RTMP сервер (:1935)  │  │
         │  └─────────────────────────┘  │
         │  ┌─────────────────────────┐  │
         │  │    IP Cameras (RTSP)    │  │
         │  │  • 192.168.1.100:554    │  │
         │  │  • 192.168.1.101:554    │  │
         │  │  • ...                  │  │
         │  └─────────────────────────┘  │
         └───────────────────────────────┘
```

---

## 🧩 Основные компоненты

### 1. Frontend (React SPA)

#### Страницы (Pages)

**DashboardPage** — Панель управления
- Метрики системы (CPU, RAM, сеть)
- Графики в реальном времени
- Статусы компьютеров и потоков
- Использует Recharts для визуализации

**VideoWallPage** — Видеостена
- Сетка 1×1, 2×2, 3×3, 4×4
- Полноэкранный режим (CSS-based)
- Сохранение конфигураций
- Автоперезагрузка потоков
- Fallback видео при ошибках

**ComputersPage** — Управление компьютерами
- CRUD операции для компьютеров
- Управление потоками
- Автоопределение протокола
- Проверка доступности

**UsersPage** — Управление пользователями
- CRUD операции
- Ролевая модель
- Назначение прав
- Доступ к компьютерам

**IpFilterPage** — IP-фильтрация
- Белый/чёрный списки
- CIDR нотация
- Приоритеты правил

**LogsPage** — Журналы событий
- Фильтрация по категориям
- Экспорт в CSV
- Поиск по сообщениям

**SettingsPage** — Настройки
- TLS/SSL
- TTL сессий
- Rate limiting
- Формат логов

**AboutPage** — О системе
- Информация о системе
- Кнопка сброса данных

#### Компоненты (Components)

**VideoPlayer** — Видеоплеер
```typescript
interface VideoPlayerProps {
  url: string;
  protocol: StreamProtocol;
  name: string;
  className?: string;
}
```

Поддерживает:
- HLS/m3u8 через hls.js
- HTTP-FLV через mpegts.js
- MPEG-TS через mpegts.js
- HTTP/HTTPS MP4/WebM
- Fallback видео при ошибках

**Layout** — Основной layout
- Боковое меню
- Хедер с навигацией
- Футер
- Адаптивный дизайн

**Toast** — Система уведомлений
- Success, Error, Warning, Info
- Анимации появления/исчезновения
- Автоскрытие через 3 секунды

**AnimatedCard** — Анимированные карточки
- Framer Motion анимации
- Hover эффекты
- Glassmorphism стиль

#### Контексты (Contexts)

**AuthContext** — Аутентификация
```typescript
interface AuthContextType {
  user: User | null;
  session: Session | null;
  login: (login: string, password: string) => Promise<boolean>;
  logout: () => void;
  isFirstRun: boolean;
  createFirstAdmin: (login: string, password: string) => Promise<boolean>;
}
```

Функции:
- Вход/выход
- Создание первого администратора
- Проверка сессии
- Rate limiting

**ThemeContext** — Тема оформления
```typescript
interface ThemeContextType {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}
```

#### Библиотеки (Lib)

**storage.ts** — API для localStorage
```typescript
// Пользователи
getUsers(): User[]
saveUsers(users: User[]): void
getUserByLogin(login: string): User | undefined

// Компьютеры
getComputers(): Computer[]
saveComputers(computers: Computer[]): void

// IP правила
getIpRules(): IpRule[]
saveIpRules(rules: IpRule[]): void

// Логи
getLogs(): LogEntry[]
addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): void

// Сессии
getSessions(): Session[]
getCurrentSession(): Session | null
setCurrentSession(token: string): void

// Настройки
getSettings(): Settings
saveSettings(settings: Settings): void
```

**logger.ts** — Система логирования
```typescript
logger.auth(message, user, ip)
logger.access(message, user, ip)
logger.stream(message, stream)
logger.error(message, user)
logger.admin(message, user, ip)
```

**rtsp-mock.ts** — Mock RTSP модуль
```typescript
initializeRtspMock(computers: Computer[]): void
getMockMetrics(): {
  cpu: number;
  ram: number;
  networkIn: number;
  networkOut: number;
  activeComputers: number;
  connectedClients: number;
  totalStreams: number;
  uptime: number;
}
```

**ip-check.ts** — Проверка IP/CIDR
```typescript
checkIpAccess(ip: string): { allowed: boolean; reason: string }
validateCidr(cidr: string): boolean
```

**types.ts** — TypeScript типы
```typescript
type UserRole = 'admin' | 'operator' | 'viewer';
type StreamProtocol = 'rtsp' | 'http' | 'https' | 'hls' | 'm3u8' | 'ts' | 'flv' | 'rtmp' | 'webrtc';

interface User { ... }
interface Computer { ... }
interface Stream { ... }
interface IpRule { ... }
interface LogEntry { ... }
interface Session { ... }
interface Settings { ... }
```

---

## 💾 Модель данных

### localStorage

Все данные хранятся в localStorage браузера в JSON формате.

#### rtsp_users
```json
[
  {
    "id": "abc123",
    "login": "admin",
    "passwordHash": "hashed_password",
    "role": "admin",
    "isAdmin": true,
    "allowedCidrs": ["0.0.0.0/0"],
    "allowedComputerIds": [],
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

#### rtsp_computers
```json
[
  {
    "id": "comp123",
    "name": "КПП-1",
    "hostname": "kpp1-server",
    "ip": "192.168.1.10",
    "description": "Центральный пост",
    "streams": [
      {
        "id": "stream123",
        "name": "Камера въезда",
        "url": "rtsp://192.168.1.100:554/stream1",
        "protocol": "rtsp",
        "sourceLogin": "admin",
        "sourcePassword": "password",
        "isActive": true,
        "status": "online"
      }
    ],
    "isActive": true,
    "status": "online",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

#### rtsp_ip_rules
```json
[
  {
    "id": "rule123",
    "cidr": "192.168.1.0/24",
    "type": "white",
    "priority": 1,
    "comment": "Локальная сеть",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

#### rtsp_logs
```json
[
  {
    "id": "log123",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "level": "info",
    "category": "auth",
    "user": "admin",
    "ip": "192.168.1.1",
    "stream": "",
    "message": "Успешный вход"
  }
]
```

#### rtsp_sessions
```json
[
  {
    "id": "session123",
    "userId": "user123",
    "token": "jwt_token",
    "ip": "192.168.1.1",
    "expiresAt": "2024-01-01T13:00:00.000Z"
  }
]
```

#### rtsp_settings
```json
{
  "tlsEnabled": false,
  "sessionTtl": 3600,
  "maxConnections": 100,
  "logFormat": "json",
  "rateLimitLogin": 5,
  "rateLimitApi": 60
}
```

#### rtsp_login_attempts
```json
{
  "192.168.1.1": {
    "count": 3,
    "blockedUntil": null
  }
}
```

---

## 🔐 Безопасность

### Аутентификация

1. **Пароли**
   - Хеширование через bcrypt (mock в демо-версии)
   - Соль: фиксированная (в продакшене — случайная)

2. **Сессии**
   - JWT токены (mock в демо-версии)
   - Хранение в sessionStorage
   - TTL настраивается (по умолчанию 1 час)

3. **Rate Limiting**
   - 5 неудачных попыток входа
   - Блокировка на 15 минут
   - Счётчик попыток в localStorage

### Авторизация

**Ролевая модель:**
```
admin (полный доступ)
  ↓
operator (управление потоками, просмотр журналов)
  ↓
viewer (только просмотр видеостены)
```

**Проверка доступа:**
```typescript
function canAccessPage(page: string, user: User): boolean {
  if (user.isAdmin) return true;
  
  const pageRoles: Record<string, string[]> = {
    'dashboard': ['admin', 'operator', 'viewer'],
    'video-wall': ['admin', 'operator', 'viewer'],
    'computers': ['admin'],
    'users': ['admin'],
    'ip-filter': ['admin'],
    'logs': ['admin', 'operator'],
    'settings': ['admin'],
    'about': ['admin', 'operator', 'viewer'],
  };
  
  return pageRoles[page]?.includes(user.role) ?? false;
}
```

### IP-фильтрация

**Алгоритм проверки:**
```typescript
function checkIpAccess(ip: string): { allowed: boolean; reason: string } {
  const rules = getIpRules();
  
  // Сортировка по приоритету
  const sortedRules = rules.sort((a, b) => a.priority - b.priority);
  
  // Проверка чёрного списка
  const blackRules = sortedRules.filter(r => r.type === 'black');
  for (const rule of blackRules) {
    if (cidrContains(rule.cidr, ip)) {
      return { allowed: false, reason: `Заблокировано: ${rule.cidr}` };
    }
  }
  
  // Проверка белого списка
  const whiteRules = sortedRules.filter(r => r.type === 'white');
  if (whiteRules.length > 0) {
    for (const rule of whiteRules) {
      if (cidrContains(rule.cidr, ip)) {
        return { allowed: true, reason: `Разрешено: ${rule.cidr}` };
      }
    }
    return { allowed: false, reason: 'IP не в белом списке' };
  }
  
  return { allowed: true, reason: 'Нет правил' };
}
```

---

## 🎬 Видеостриминг

### Архитектура воспроизведения

```
URL потока
    ↓
detectProtocolFromUrl()
    ↓
┌─────────────┬─────────────┬─────────────┬─────────────┐
│   HLS/m3u8  │  HTTP-FLV   │  MPEG-TS    │  MP4/WebM   │
│   (hls.js)  │ (mpegts.js) │ (mpegts.js) │  (<video>)  │
└─────────────┴─────────────┴─────────────┴─────────────┘
    ↓              ↓              ↓              ↓
    └──────────────┴──────────────┴──────────────┘
                         ↓
                   <video> элемент
                         ↓
                   Воспроизведение
```

### hls.js (HLS/m3u8)

```typescript
const hls = new Hls({
  enableWorker: true,
  lowLatencyMode: true,
});

hls.loadSource(url);
hls.attachMedia(video);

hls.on(Hls.Events.MANIFEST_PARSED, () => {
  video.play();
});

hls.on(Hls.Events.ERROR, (_, data) => {
  if (data.fatal) {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      hls.startLoad(); // Retry
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
    } else {
      // Fallback
    }
  }
});
```

### mpegts.js (HTTP-FLV, MPEG-TS)

```typescript
const player = mpegts.createPlayer({
  type: 'flv', // или 'mpegts'
  url: url,
  isLive: true,
});

player.attachMediaElement(video);
player.load();
player.play();

player.on(mpegts.Events.ERROR, () => {
  // Fallback
});
```

### Fallback механизм

```typescript
const FALLBACK_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

function tryFallback() {
  setStatus('fallback');
  video.src = FALLBACK_VIDEO_URL;
  video.play();
}
```

---

## 🔄 Поток данных

### Вход пользователя

```
1. Пользователь вводит логин/пароль
   ↓
2. login() в AuthContext
   ↓
3. Проверка rate limiting
   ↓
4. Поиск пользователя в localStorage
   ↓
5. Проверка пароля (bcrypt)
   ↓
6. Создание сессии (JWT)
   ↓
7. Сохранение в sessionStorage
   ↓
8. Логирование события
   ↓
9. Перенаправление на Dashboard
```

### Добавление потока

```
1. Пользователь вводит URL
   ↓
2. detectProtocolFromUrl() определяет протокол
   ↓
3. Проверка доступности (fetch)
   ↓
4. Сохранение в localStorage
   ↓
5. Логирование события
   ↓
6. Обновление UI
```

### Воспроизведение видео

```
1. Пользователь выбирает поток на видеостене
   ↓
2. VideoPlayer получает URL и протокол
   ↓
3. Выбор плеера (hls.js / mpegts.js / <video>)
   ↓
4. Загрузка потока
   ↓
5. Воспроизведение
   ↓
6. Если ошибка → Fallback видео
```

---

## 📊 Масштабирование

### Текущие ограничения

**localStorage:**
- Ограничение ~5-10 MB
- Не подходит для больших объёмов данных
- Нет транзакций
- Нет индексации

**Решение для продакшена:**
- SQLite + Prisma
- Node.js API Routes
- Реальная аутентификация
- Серверное логирование

### Архитектура для продакшена

```
┌─────────────────────────────────────────┐
│           Frontend (React)              │
│  (без изменений, только API вызовы)     │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│         Backend (Node.js API)           │
│  • Express / Fastify                    │
│  • JWT аутентификация                   │
│  • Rate limiting                        │
│  • Валидация данных                     │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│         Database (SQLite/PostgreSQL)    │
│  • Prisma ORM                           │
│  • Миграции                             │
│  • Транзакции                           │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│      Media Server (MediaMTX/FFmpeg)     │
│  • RTSP → HLS/FLV конвертация           │
│  • Запись потоков                       │
│  • Транскодинг                          │
└─────────────────────────────────────────┘
```

---

## 🎨 UI/UX дизайн

### Дизайн-система

**Цвета:**
- Primary: Blue (#3B82F6)
- Secondary: Purple (#8B5CF6)
- Success: Green (#10B981)
- Warning: Yellow (#F59E0B)
- Error: Red (#EF4444)
- Background: Gray (#0F172A)

**Типографика:**
- Шрифт: Inter, system-ui
- Размеры: 12px, 14px, 16px, 20px, 24px

**Компоненты:**
- Кнопки: Rounded, Gradient, Hover эффекты
- Карточки: Glassmorphism, Border, Shadow
- Формы: Input, Select, Checkbox, Radio
- Модальные окна: Backdrop blur, Animation

### Анимации

**Framer Motion:**
```typescript
// Появление элемента
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3 }}
>

// Hover эффект
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
>

// Stagger анимация списка
<motion.div
  initial="hidden"
  animate="visible"
  variants={{
    visible: {
      transition: {
        staggerChildren: 0.1
      }
    }
  }}
>
```

---

## 🧪 Тестирование

### Unit тесты (TODO)

```typescript
// storage.test.ts
describe('storage', () => {
  test('getUsers returns empty array if no users', () => {
    localStorage.clear();
    expect(getUsers()).toEqual([]);
  });
  
  test('saveUsers saves users to localStorage', () => {
    const users = [{ id: '1', login: 'admin', ... }];
    saveUsers(users);
    expect(getUsers()).toEqual(users);
  });
});

// ip-check.test.ts
describe('ip-check', () => {
  test('validateCidr validates correct CIDR', () => {
    expect(validateCidr('192.168.1.0/24')).toBe(true);
    expect(validateCidr('invalid')).toBe(false);
  });
});
```

### E2E тесты (TODO)

```typescript
// cypress/e2e/login.cy.ts
describe('Login', () => {
  it('should login with valid credentials', () => {
    cy.visit('/');
    cy.get('[data-testid="login-input"]').type('admin');
    cy.get('[data-testid="password-input"]').type('admin');
    cy.get('[data-testid="login-button"]').click();
    cy.url().should('include', '/dashboard');
  });
});
```

---

## 📈 Производительность

### Оптимизации

**React:**
- React.memo для компонентов
- useMemo для вычислений
- useCallback для функций
- Lazy loading страниц

**Видео:**
- Web Workers для hls.js
- Low latency mode
- Auto cleanup буферов
- Fallback механизм

**localStorage:**
- Ограничение размера логов (10000 записей)
- Очистка старых сессий
- Компактное хранение данных

### Метрики

**Размер бандла:**
- JS: ~1.7 MB (gzip: ~480 KB)
- CSS: ~70 KB (gzip: ~10 KB)

**Время загрузки:**
- First Contentful Paint: ~1.5s
- Time to Interactive: ~2.5s
- Largest Contentful Paint: ~3s

**Производительность:**
- 60 FPS анимации
- <100ms время отклика
- <50ms время рендеринга

---

## 🔮 Будущие улучшения

### Короткий срок
- [ ] Unit тесты
- [ ] E2E тесты
- [ ] Документация API
- [ ] Оптимизация размера бандла

### Средний срок
- [ ] Node.js бэкенд
- [ ] SQLite база данных
- [ ] Реальная аутентификация
- [ ] Запись видео потоков

### Долгий срок
- [ ] Микросервисная архитектура
- [ ] Kubernetes оркестрация
- [ ] AI анализ видео
- [ ] Мобильное приложение

---

**Версия документа:** 1.0  
**Дата обновления:** 2024  
**Автор:** RTSP Server Team
