import { User, System, Camera, IpRule, LogEntry, Session, Settings } from './types';

const KEYS = {
  users: 'rtsp_users',
  systems: 'rtsp_systems',
  ipRules: 'rtsp_ip_rules',
  logs: 'rtsp_logs',
  sessions: 'rtsp_sessions',
  settings: 'rtsp_settings',
  loginAttempts: 'rtsp_login_attempts',
  initialized: 'rtsp_initialized',
};

function get<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function set<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// Simple hash for mock (in production use bcrypt)
export function hashPassword(password: string): string {
  let hash = 0;
  const salt = 'rtsp_salt_2024';
  const str = salt + password;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'hashed_' + Math.abs(hash).toString(36) + '_' + btoa(password).slice(0, 8);
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Users
export function getUsers(): User[] {
  return get<User[]>(KEYS.users, []);
}

export function saveUsers(users: User[]): void {
  set(KEYS.users, users);
}

export function getUserByLogin(login: string): User | undefined {
  return getUsers().find(u => u.login === login);
}

// Systems
export function getSystems(): System[] {
  return get<System[]>(KEYS.systems, []);
}

export function saveSystems(systems: System[]): void {
  set(KEYS.systems, systems);
}

// IP Rules
export function getIpRules(): IpRule[] {
  return get<IpRule[]>(KEYS.ipRules, []);
}

export function saveIpRules(rules: IpRule[]): void {
  set(KEYS.ipRules, rules);
}

// Logs
export function getLogs(): LogEntry[] {
  return get<LogEntry[]>(KEYS.logs, []);
}

export function saveLogs(logs: LogEntry[]): void {
  set(KEYS.logs, logs);
}

export function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): void {
  const logs = getLogs();
  logs.unshift({
    ...log,
    id: generateId(),
    timestamp: new Date().toISOString(),
  });
  if (logs.length > 10000) logs.length = 10000;
  saveLogs(logs);
}

// Sessions
export function getSessions(): Session[] {
  return get<Session[]>(KEYS.sessions, []);
}

export function saveSessions(sessions: Session[]): void {
  set(KEYS.sessions, sessions);
}

export function getCurrentSession(): Session | null {
  const token = sessionStorage.getItem('rtsp_token');
  if (!token) return null;
  const session = getSessions().find(s => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;
  return session;
}

export function setCurrentSession(token: string): void {
  sessionStorage.setItem('rtsp_token', token);
}

export function clearCurrentSession(): void {
  sessionStorage.removeItem('rtsp_token');
}

// Settings
export function getSettings(): Settings {
  return get<Settings>(KEYS.settings, {
    tlsEnabled: false,
    sessionTtl: 3600,
    maxConnections: 100,
    logFormat: 'json',
    rateLimitLogin: 5,
    rateLimitApi: 60,
  });
}

export function saveSettings(settings: Settings): void {
  set(KEYS.settings, settings);
}

// Login attempts (rate limiting)
interface LoginAttempt {
  ip: string;
  attempts: number;
  blockedUntil: string | null;
}

export function getLoginAttempts(): LoginAttempt[] {
  return get<LoginAttempt[]>(KEYS.loginAttempts, []);
}

export function saveLoginAttempts(attempts: LoginAttempt[]): void {
  set(KEYS.loginAttempts, attempts);
}

export function isBlocked(ip: string): boolean {
  const attempts = getLoginAttempts();
  const attempt = attempts.find(a => a.ip === ip);
  if (!attempt || !attempt.blockedUntil) return false;
  return new Date(attempt.blockedUntil) > new Date();
}

export function recordFailedLogin(ip: string): void {
  const attempts = getLoginAttempts();
  let attempt = attempts.find(a => a.ip === ip);
  if (!attempt) {
    attempt = { ip, attempts: 0, blockedUntil: null };
    attempts.push(attempt);
  }
  attempt.attempts++;
  if (attempt.attempts >= 5) {
    attempt.blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  }
  saveLoginAttempts(attempts);
}

export function clearFailedLogin(ip: string): void {
  const attempts = getLoginAttempts().filter(a => a.ip !== ip);
  saveLoginAttempts(attempts);
}

// Helper: get systems available to user
export function getSystemsForUser(user: User | null): System[] {
  const allSystems = getSystems();
  if (!user) return [];
  if (user.isAdmin || user.role === 'admin') return allSystems;
  if (user.allowedSystemIds.length === 0) return allSystems; // пусто = все
  return allSystems.filter(s => user.allowedSystemIds.includes(s.id));
}

// Initialize with seed data
export function initializeDb(): void {
  if (get<boolean>(KEYS.initialized, false)) return;
  
  const adminUser: User = {
    id: generateId(),
    login: 'admin',
    passwordHash: hashPassword('admin'),
    role: 'admin',
    isAdmin: true,
    allowedCidrs: ['0.0.0.0/0'],
    allowedSystemIds: [],
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  const testSystems: System[] = [
    {
      id: generateId(),
      name: 'КПП-1 (Центральный пост)',
      hostname: 'kpp1-server',
      ip: '192.168.1.10',
      description: 'Центральный пост охраны КПП №1',
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
      cameras: [
        {
          id: generateId(),
          name: 'Камера въезда',
          url: 'rtsp://192.168.1.100:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass123',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера выезда',
          url: 'rtsp://192.168.1.101:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass123',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера КПП (внутр.)',
          url: 'rtsp://192.168.1.102:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass123',
          isActive: true,
          status: 'online',
        },
      ],
    },
    {
      id: generateId(),
      name: 'Периметр (Северный участок)',
      hostname: 'perim-north',
      ip: '192.168.1.20',
      description: 'Северный участок периметра объекта',
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
      cameras: [
        {
          id: generateId(),
          name: 'Камера С-1',
          url: 'rtsp://192.168.1.110:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass456',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера С-2',
          url: 'rtsp://192.168.1.111:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass456',
          isActive: true,
          status: 'online',
        },
      ],
    },
    {
      id: generateId(),
      name: 'Склад (Западный)',
      hostname: 'warehouse-west',
      ip: '192.168.1.30',
      description: 'Западный складской комплекс',
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
      cameras: [
        {
          id: generateId(),
          name: 'Ворота склада',
          url: 'rtsp://192.168.1.120:554/stream1',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass789',
          isActive: true,
          status: 'online',
        },
      ],
    },
  ];

  saveUsers([adminUser]);
  saveSystems(testSystems);
  saveIpRules([]);
  saveLogs([]);
  saveSessions([]);
  set(KEYS.initialized, true);
}
