export type UserRole = 'admin' | 'operator' | 'viewer';

/** Тип источника определяется сервером по схеме URL. */
export type StreamProtocol = 'rtsp' | 'rtmp' | 'hls' | 'srt' | 'udp' | 'push';
export type StreamTransport = 'auto' | 'tcp' | 'udp';

/** idle — камера подключается только при просмотре (режим «по запросу»). */
export type StreamStatus = 'online' | 'offline' | 'reconnecting' | 'idle';

export interface Stream {
  id: string;
  name: string;
  description: string;
  /** pull — сервер забирает по адресу; push — энкодер отправляет сам (RTMP/SRT) */
  mode: 'pull' | 'push';
  /** Только администратору и только для push */
  push: { key: string; path: string; rtmpPort: number; srtPort: number } | null;
  url: string;
  protocol: StreamProtocol;
  transport: StreamTransport;
  sourceLogin: string;
  hasPassword: boolean;
  isActive: boolean;
  /** Запись в архив включена */
  record: boolean;
  status: StreamStatus;
  tracks: string[];
  viewers: number;
  sort: number;
}

export interface User {
  id: string;
  login: string;
  role: UserRole;
  isAdmin: boolean;
  allowedCidrs: string[];
  allowedStreamIds: string[]; // пусто = все потоки
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
  tlsEnabled: boolean; // только чтение — задаётся в config.json
  sessionTtl: number;
  maxConnections: number;
  logFormat: 'syslog' | 'json';
  rateLimitLogin: number;
  rateLimitApi: number;
  logRetentionDays: number;
  camerasAlwaysOn: boolean;
  lowLatency: boolean;
  archiveDays: number;
  archiveMinFreeGb: number;
  archiveNewStreams: boolean;
}

export interface ArchiveSpan {
  start: string; // ISO
  duration: number; // секунды
}

export interface ArchiveStreamInfo {
  id: string;
  name: string;
  description: string;
  record: boolean;
  isActive: boolean;
  bytes: number;
  oldest: string | null;
}

export interface ArchiveInfo {
  enabled: boolean;
  days: number;
  minFreeGb: number;
  dir?: string;
  totalBytes: number;
  bytesPerDay: number;
  capacityDays: number | null;
  disk: { free: number; size: number } | null;
  streams: ArchiveStreamInfo[];
}

export interface Bookmark {
  id: string;
  streamId: string;
  ts: string;
  note: string;
  user: string;
  createdAt: string;
  canDelete: boolean;
}

export interface SystemInfo {
  version: string;
  node: string;
  hostname: string;
  platform: string;
  os: 'linux' | 'windows';
  tlsEnabled: boolean;
  /** IPv4-адреса сервера в сети (только администратору) */
  addresses?: string[];
  mediamtx: { reachable: boolean; version: string | null; lastError: string; lastSyncAt: string | null };
}

export interface WallCell {
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
