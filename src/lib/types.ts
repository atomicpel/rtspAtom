export type UserRole = 'admin' | 'operator' | 'viewer';

export interface Camera {
  id: string;
  name: string;
  url: string;
  sourceLogin: string;
  sourcePassword: string;
  isActive: boolean;
  status: 'online' | 'offline' | 'reconnecting';
}

export interface System {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  description: string;
  cameras: Camera[];
  isActive: boolean;
  status: 'online' | 'offline' | 'reconnecting';
  createdAt: string;
}

export interface User {
  id: string;
  login: string;
  passwordHash: string;
  role: UserRole;
  isAdmin: boolean; // Явные права администратора
  allowedCidrs: string[];
  allowedSystemIds: string[]; // Разрешённые системы (пусто = все)
  isActive: boolean;
  createdAt: string;
}

export interface IpRule {
  id: string;
  cidr: string;
  type: 'white' | 'black';
  priority: number;
  comment: string;
  createdAt: string;
}

export type LogLevel = 'info' | 'warning' | 'error' | 'debug';
export type LogCategory = 'auth' | 'access' | 'stream' | 'error' | 'admin';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  user: string;
  ip: string;
  stream: string;
  message: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  ip: string;
  expiresAt: string;
}

export interface Settings {
  tlsEnabled: boolean;
  sessionTtl: number;
  maxConnections: number;
  logFormat: 'syslog' | 'json';
  rateLimitLogin: number;
  rateLimitApi: number;
}

export interface SystemMetrics {
  cpu: number;
  ram: number;
  networkIn: number;
  networkOut: number;
  activeSystems: number;
  connectedClients: number;
  uptime: number;
}
