import type {
  Computer, IpRule, LogEntry, Metrics, ProbeResult, Settings, Stream, SystemInfo, User,
  WallConfig, WallState,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Событие, по которому интерфейс возвращается на страницу входа. */
export const UNAUTHORIZED_EVENT = 'rtspatom:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-RTSPAtom'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Сервер недоступен');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`);
  }
  return data as T;
}

const get = <T>(u: string) => request<T>('GET', u);
const post = <T>(u: string, b: unknown = {}) => request<T>('POST', u, b);
const put = <T>(u: string, b: unknown = {}) => request<T>('PUT', u, b);
const del = <T>(u: string) => request<T>('DELETE', u);

export interface ComputerInput {
  name: string;
  hostname: string;
  ip: string;
  description: string;
  isActive?: boolean;
}

export interface StreamInput {
  name?: string;
  url?: string;
  transport?: 'auto' | 'tcp' | 'udp';
  sourceLogin?: string;
  sourcePassword?: string;
  clearPassword?: boolean;
  isActive?: boolean;
}

export interface UserInput {
  login?: string;
  password?: string;
  role?: string;
  isAdmin?: boolean;
  allowedCidrs?: string[];
  allowedComputerIds?: string[];
  isActive?: boolean;
}

export interface LogQuery {
  category?: string;
  level?: string;
  user?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function logQueryString(q: LogQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export const api = {
  authStatus: () => get<{ setupRequired: boolean; setupAllowedHere: boolean; authenticated: boolean; platform: 'linux' | 'windows' }>('/api/auth/status'),
  me: () => get<{ user: User }>('/api/auth/me'),
  login: (login: string, password: string) => post<{ user: User }>('/api/auth/login', { login, password }),
  setup: (login: string, password: string) => post<{ user: User }>('/api/auth/setup', { login, password }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: boolean }>('/api/auth/password', { currentPassword, newPassword }),

  computers: () => get<Computer[]>('/api/computers'),
  createComputer: (c: ComputerInput) => post<Computer>('/api/computers', c),
  updateComputer: (id: string, c: Partial<ComputerInput>) => put<Computer>(`/api/computers/${id}`, c),
  deleteComputer: (id: string) => del<void>(`/api/computers/${id}`),
  createStream: (computerId: string, s: StreamInput) => post<Stream>(`/api/computers/${computerId}/streams`, s),
  updateStream: (id: string, s: StreamInput) => put<Stream>(`/api/streams/${id}`, s),
  deleteStream: (id: string) => del<void>(`/api/streams/${id}`),
  probeStream: (s: StreamInput & { streamId?: string }) => post<ProbeResult>('/api/streams/probe', s),

  users: () => get<User[]>('/api/users'),
  createUser: (u: UserInput) => post<User>('/api/users', u),
  updateUser: (id: string, u: UserInput) => put<User>(`/api/users/${id}`, u),
  setUserPassword: (id: string, password: string) => post<{ ok: boolean }>(`/api/users/${id}/password`, { password }),
  deleteUser: (id: string) => del<void>(`/api/users/${id}`),

  ipRules: () => get<{ rules: IpRule[]; yourIp: string }>('/api/ip-rules'),
  addIpRule: (r: { cidr: string; type: 'white' | 'black'; priority: number; comment: string }) =>
    post<{ rules: IpRule[]; yourIp: string }>('/api/ip-rules', r),
  deleteIpRule: (id: string) => del<{ rules: IpRule[]; yourIp: string }>(`/api/ip-rules/${id}`),

  logs: (q: LogQuery) => get<{ total: number; items: LogEntry[] }>(`/api/logs?${logQueryString(q)}`),
  logsExportUrl: (q: LogQuery) => `/api/logs/export?${logQueryString(q)}`,

  settings: () => get<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => put<Settings>('/api/settings', s),

  metrics: () => get<Metrics>('/api/metrics'),
  system: () => get<SystemInfo>('/api/system'),

  wallState: () => get<WallState>('/api/wall/state'),
  saveWallState: (s: WallState) => put<WallState>('/api/wall/state', s),
  wallConfigs: () => get<WallConfig[]>('/api/wall/configs'),
  addWallConfig: (c: Omit<WallConfig, 'id' | 'createdAt'>) => post<WallConfig[]>('/api/wall/configs', c),
  deleteWallConfig: (id: string) => del<WallConfig[]>(`/api/wall/configs/${id}`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Неизвестная ошибка';
}

/** Описание типа источника по URL (для подсказки в форме). */
export function protocolFromUrl(url: string): string | null {
  const s = url.trim().toLowerCase();
  if (s.startsWith('rtsp://') || s.startsWith('rtsps://')) return 'RTSP';
  if (s.startsWith('rtmp://') || s.startsWith('rtmps://')) return 'RTMP';
  if (s.startsWith('http://') || s.startsWith('https://')) return 'HLS';
  if (s.startsWith('srt://')) return 'SRT';
  if (s.startsWith('udp://') || s.startsWith('udp+mpegts://')) return 'UDP / MPEG-TS';
  return null;
}
