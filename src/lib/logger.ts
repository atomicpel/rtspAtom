import { addLog } from './storage';
import { LogCategory, LogLevel } from './types';

export function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  options: { user?: string; ip?: string; stream?: string } = {}
): void {
  addLog({
    level,
    category,
    message,
    user: options.user || 'system',
    ip: options.ip || '127.0.0.1',
    stream: options.stream || '',
  });
}

export const logger = {
  auth: (message: string, user?: string, ip?: string) =>
    log('info', 'auth', message, { user, ip }),
  
  authError: (message: string, user?: string, ip?: string) =>
    log('warning', 'auth', message, { user, ip }),
  
  access: (message: string, user?: string, ip?: string) =>
    log('info', 'access', message, { user, ip }),
  
  stream: (message: string, stream?: string) =>
    log('info', 'stream', message, { stream }),
  
  streamError: (message: string, stream?: string) =>
    log('error', 'stream', message, { stream }),
  
  error: (message: string, user?: string) =>
    log('error', 'error', message, { user }),
  
  admin: (message: string, user?: string, ip?: string) =>
    log('info', 'admin', message, { user, ip }),
  
  debug: (message: string) =>
    log('debug', 'access', message),
};
