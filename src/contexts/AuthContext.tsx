import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '../lib/types';
import { api, ApiError, errorMessage, UNAUTHORIZED_EVENT } from '../lib/api';
import { onReconnected } from '../lib/connection';
import type { Platform } from '../lib/platform';

interface AuthContextType {
  user: User | null;
  /** Идёт первичная проверка сессии. */
  checking: boolean;
  /** В системе ещё нет пользователей. */
  setupRequired: boolean;
  /** Первичную настройку можно выполнить с этого компьютера (localhost). */
  setupAllowedHere: boolean;
  /** ОС сервера — для подсказок с командами обслуживания. */
  platform: Platform;
  /** Показывать видео по WebRTC (минимальная задержка) с откатом на HLS. */
  lowLatency: boolean;
  login: (login: string, password: string) => Promise<{ success: boolean; error?: string }>;
  setup: (login: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupAllowedHere, setSetupAllowedHere] = useState(false);
  const [platform, setPlatform] = useState<Platform>('linux');
  const [lowLatency, setLowLatency] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const st = await api.authStatus();
      setSetupRequired(st.setupRequired);
      setSetupAllowedHere(st.setupAllowedHere);
      if (st.platform) setPlatform(st.platform);
      if (typeof st.lowLatency === 'boolean') setLowLatency(st.lowLatency);
      if (st.authenticated) {
        const { user: u } = await api.me();
        setUser(u);
      } else {
        setUser(null);
      }
    } catch (err) {
      // Нет связи (сервер перезапускается) — не выходим из системы, а ждём и проверяем снова
      if (err instanceof ApiError && err.status === 0) {
        setTimeout(checkStatus, 3000);
        return;
      }
      setUser(null);
    }
    setChecking(false);
  }, []);

  useEffect(() => onReconnected(() => { checkStatus(); }), [checkStatus]);

  useEffect(() => {
    checkStatus();
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [checkStatus]);

  const login = useCallback(async (loginStr: string, password: string) => {
    try {
      const { user: u } = await api.login(loginStr, password);
      setUser(u);
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }, []);

  const setup = useCallback(async (loginStr: string, password: string) => {
    try {
      const { user: u } = await api.setup(loginStr, password);
      setSetupRequired(false);
      setUser(u);
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* сессия уже недействительна */
    }
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, checking, setupRequired, setupAllowedHere, platform, lowLatency, login, setup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
