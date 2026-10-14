import { User, Stream, IpRule, LogEntry, Session, Settings } from './types';

const KEYS = {
  users: 'rtsp_users',
  streams: 'rtsp_streams',
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

// Streams
export function getStreams(): Stream[] {
  return get<Stream[]>(KEYS.streams, []);
}

export function saveStreams(streams: Stream[]): void {
  set(KEYS.streams, streams);
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
  // Keep last 10000 logs
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

// Initialize with seed data
export function initializeDb(): void {
  if (get<boolean>(KEYS.initialized, false)) return;
  
  const adminUser: User = {
    id: generateId(),
    login: 'admin',
    passwordHash: hashPassword('admin'),
    role: 'admin',
    allowedCidrs: ['0.0.0.0/0'],
    allowedStreams: [],
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  const testStreams: Stream[] = [
    {
      id: generateId(),
      name: 'Камера КПП-1',
      url: 'rtsp://192.168.1.100:554/stream1',
      sourceLogin: 'cam_admin',
      sourcePassword: 'cam_pass123',
      priority: 1,
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      name: 'Камера Периметр',
      url: 'rtsp://192.168.1.101:554/stream1',
      sourceLogin: 'cam_admin',
      sourcePassword: 'cam_pass456',
      priority: 2,
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
    },
  ];

  saveUsers([adminUser]);
  saveStreams(testStreams);
  saveIpRules([]);
  saveLogs([]);
  saveSessions([]);
  set(KEYS.initialized, true);
}
