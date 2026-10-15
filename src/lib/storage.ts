import { User, Computer, Stream, IpRule, LogEntry, Session, Settings, StreamProtocol } from './types';

const STORAGE_KEYS = {
  users: 'rtsp_users',
  computers: 'rtsp_computers',
  ipRules: 'rtsp_ip_rules',
  logs: 'rtsp_logs',
  sessions: 'rtsp_sessions',
  settings: 'rtsp_settings',
  loginAttempts: 'rtsp_login_attempts',
  videoWallState: 'rtsp_video_wall_state',
};

export function initializeStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.users)) {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.computers)) {
    localStorage.setItem(STORAGE_KEYS.computers, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.ipRules)) {
    localStorage.setItem(STORAGE_KEYS.ipRules, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.logs)) {
    localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.sessions)) {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.settings)) {
    const defaultSettings: Settings = {
      tlsEnabled: false,
      sessionTtl: 3600,
      maxConnections: 100,
      logFormat: 'json',
      rateLimitLogin: 5,
      rateLimitApi: 60,
    };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(defaultSettings));
  }
  if (!localStorage.getItem(STORAGE_KEYS.loginAttempts)) {
    localStorage.setItem(STORAGE_KEYS.loginAttempts, JSON.stringify({}));
  }
}

// Users
export function getUsers(): User[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.users) || '[]');
}

export function saveUsers(users: User[]) {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
}

export function getUserByLogin(login: string): User | undefined {
  return getUsers().find(u => u.login === login);
}

// Computers
export function getComputers(): Computer[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.computers) || '[]');
}

export function saveComputers(computers: Computer[]) {
  localStorage.setItem(STORAGE_KEYS.computers, JSON.stringify(computers));
}

export function getComputerById(id: string): Computer | undefined {
  return getComputers().find(c => c.id === id);
}

// IP Rules
export function getIpRules(): IpRule[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.ipRules) || '[]');
}

export function saveIpRules(rules: IpRule[]) {
  localStorage.setItem(STORAGE_KEYS.ipRules, JSON.stringify(rules));
}

// Logs
export function getLogs(): LogEntry[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.logs) || '[]');
}

export function saveLogs(logs: LogEntry[]) {
  localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(logs));
}

export function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>) {
  const logs = getLogs();
  logs.unshift({
    ...log,
    id: generateId(),
    timestamp: new Date().toISOString(),
  });
  if (logs.length > 10000) logs.pop();
  saveLogs(logs);
}

// Sessions
export function getSessions(): Session[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || '[]');
}

export function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

export function getCurrentSession(): Session | null {
  const token = sessionStorage.getItem('rtsp_token');
  if (!token) return null;
  const sessions = getSessions();
  const session = sessions.find(s => s.token === token);
  if (!session) return null;
  if (new Date() > new Date(session.expiresAt)) {
    clearCurrentSession();
    return null;
  }
  return session;
}

export function setCurrentSession(token: string) {
  sessionStorage.setItem('rtsp_token', token);
}

export function clearCurrentSession() {
  sessionStorage.removeItem('rtsp_token');
}

// Settings
export function getSettings(): Settings {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

// Login Attempts
export function getLoginAttempts(): Record<string, { count: number; blockedUntil: string | null }> {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.loginAttempts) || '{}');
}

export function saveLoginAttempts(attempts: Record<string, { count: number; blockedUntil: string | null }>) {
  localStorage.setItem(STORAGE_KEYS.loginAttempts, JSON.stringify(attempts));
}

export function isBlocked(ip: string): boolean {
  const attempts = getLoginAttempts();
  const attempt = attempts[ip];
  if (!attempt || !attempt.blockedUntil) return false;
  return new Date() < new Date(attempt.blockedUntil);
}

export function recordFailedLogin(ip: string) {
  const attempts = getLoginAttempts();
  if (!attempts[ip]) {
    attempts[ip] = { count: 0, blockedUntil: null };
  }
  attempts[ip].count++;
  if (attempts[ip].count >= 5) {
    attempts[ip].blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  }
  saveLoginAttempts(attempts);
}

export function clearFailedLogin(ip: string) {
  const attempts = getLoginAttempts();
  delete attempts[ip];
  saveLoginAttempts(attempts);
}

// User access to computers
export function getComputersForUser(user: User | null): Computer[] {
  if (!user) return [];
  const allComputers = getComputers();
  if (user.isAdmin) return allComputers;
  if (user.allowedComputerIds.length === 0) return allComputers;
  return allComputers.filter(c => user.allowedComputerIds.includes(c.id));
}

// Video Wall State persistence
export interface VideoWallState {
  layout: string;
  cells: Array<{ computerId: string | null; streamId: string | null }>;
  refreshInterval: number;
}

export function saveVideoWallState(state: VideoWallState) {
  localStorage.setItem(STORAGE_KEYS.videoWallState, JSON.stringify(state));
}

export function getVideoWallState(): VideoWallState | null {
  const saved = localStorage.getItem(STORAGE_KEYS.videoWallState);
  return saved ? JSON.parse(saved) : null;
}

// Utilities
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function hashPassword(password: string): string {
  return btoa(password + '_salt_123');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(): string {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

// Seed data initialization
export function initializeSeedData() {
  if (localStorage.getItem('initialized')) return;
  
  const adminUser: User = {
    id: generateId(),
    login: 'admin',
    passwordHash: hashPassword('admin'),
    role: 'admin',
    isAdmin: true,
    allowedCidrs: ['0.0.0.0/0'],
    allowedComputerIds: [],
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  const testComputers: Computer[] = [
    {
      id: generateId(),
      name: 'КПП-1 (Центральный пост)',
      hostname: 'kpp1-server',
      ip: '192.168.1.10',
      description: 'Центральный пост охраны КПП №1',
      isActive: true,
      status: 'online',
      createdAt: new Date().toISOString(),
      streams: [
        {
          id: generateId(),
          name: 'Камера въезда',
          url: 'rtsp://192.168.1.100:554/stream1',
          protocol: 'rtsp',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass123',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера выезда',
          url: 'rtsp://192.168.1.101:554/stream1',
          protocol: 'rtsp',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass123',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера КПП (внутр.)',
          url: 'rtsp://192.168.1.102:554/stream1',
          protocol: 'rtsp',
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
      streams: [
        {
          id: generateId(),
          name: 'Камера С-1',
          url: 'rtsp://192.168.1.110:554/stream1',
          protocol: 'rtsp',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass456',
          isActive: true,
          status: 'online',
        },
        {
          id: generateId(),
          name: 'Камера С-2',
          url: 'http://192.168.1.111:8080/stream',
          protocol: 'http',
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
      streams: [
        {
          id: generateId(),
          name: 'Ворота склада',
          url: 'https://192.168.1.120/hls/stream.m3u8',
          protocol: 'hls',
          sourceLogin: 'cam_admin',
          sourcePassword: 'cam_pass789',
          isActive: true,
          status: 'online',
        },
      ],
    },
  ];

  saveUsers([adminUser]);
  saveComputers(testComputers);
  localStorage.setItem('initialized', 'true');
}
