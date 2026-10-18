export type UserRole = 'admin' | 'operator' | 'viewer';

/** Тип источника определяется сервером по схеме URL. */
export type StreamProtocol = 'rtsp' | 'rtmp' | 'hls' | 'srt' | 'udp';
export type StreamTransport = 'auto' | 'tcp' | 'udp';

/** idle — камера подключается только при просмотре (режим «по запросу»). */
export type StreamStatus = 'online' | 'offline' | 'reconnecting' | 'idle';

export interface Stream {
  id: string;
  computerId: string;
  name: string;
  url: string;
  protocol: StreamProtocol;
  transport: StreamTransport;
  sourceLogin: string;
  hasPassword: boolean;
  isActive: boolean;
  status: StreamStatus;
  tracks: string[];
  viewers: number;
}

export interface Computer {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  description: string;
  streams: Stream[];
  isActive: boolean;
  status: 'online' | 'offline' | 'reconnecting';
  createdAt: string;
}

export interface User {
  id: string;
  login: string;
  role: UserRole;
  isAdmin: boolean;
  allowedCidrs: string[];
  allowedComputerIds: string[]; // пусто = все компьютеры
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
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

export interface Settings {
  tlsEnabled: boolean; // только чтение — задаётся в /etc/rtspatom/config.json
  sessionTtl: number;
  maxConnections: number;
  logFormat: 'syslog' | 'json';
  rateLimitLogin: number;
  rateLimitApi: number;
  logRetentionDays: number;
  camerasAlwaysOn: boolean;
}

export interface Metrics {
  cpu: number;
  ram: number;
  networkIn: number;
  networkOut: number;
  activeComputers: number;
  totalComputers: number;
  totalStreams: number;
  onlineStreams: number;
  connectedClients: number;
  uptime: number;
  appUptime: number;
  mediamtx: { reachable: boolean };
}

export interface SystemInfo {
  version: string;
  node: string;
  hostname: string;
  platform: string;
  os: 'linux' | 'windows';
  tlsEnabled: boolean;
  mediamtx: { reachable: boolean; version: string | null; lastError: string; lastSyncAt: string | null };
}

export interface WallCell {
  computerId: string | null;
  streamId: string | null;
}

export type WallLayout = '1x1' | '2x2' | '3x3' | '4x4';

export interface WallState {
  layout: WallLayout;
  cells: WallCell[];
  refreshInterval: number;
}

export interface WallConfig {
  id: string;
  name: string;
  layout: WallLayout;
  cells: WallCell[];
  createdAt: string;
}

export interface ProbeResult {
  ok: boolean;
  tracks: string[];
  protocol: StreamProtocol;
  warning: string;
}
