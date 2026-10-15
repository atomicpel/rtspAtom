import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Session } from '../lib/types';
import { 
  getUserByLogin, verifyPassword, generateToken, generateId, hashPassword,
  getSessions, saveSessions, saveUsers, setCurrentSession, clearCurrentSession,
  getCurrentSession, getUsers, isBlocked, recordFailedLogin, clearFailedLogin
} from '../lib/storage';
import { logger } from '../lib/logger';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  login: (login: string, password: string, ip: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isFirstRun: boolean;
  createFirstAdmin: (login: string, password: string) => Promise<boolean>;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isFirstRun, setIsFirstRun] = useState(false);

  // Восстановление сессии при загрузке
  useEffect(() => {
    const users = getUsers();
    if (users.length === 0) {
      setIsFirstRun(true);
      return;
    }
    
    const currentSession = getCurrentSession();
    if (currentSession) {
      const sessionUser = users.find(u => u.id === currentSession.userId);
      if (sessionUser && sessionUser.isActive) {
        setUser(sessionUser);
        setSession(currentSession);
      } else {
        // Сессия невалидна — очищаем
        clearCurrentSession();
      }
    }
  }, []);

  // Обновление данных пользователя из хранилища
  const refreshUser = useCallback(() => {
    if (!user) return;
    const freshUser = getUsers().find(u => u.id === user.id);
    if (freshUser) {
      setUser(freshUser);
    }
  }, [user]);

  const login = useCallback(async (loginStr: string, password: string, ip: string) => {
    if (isBlocked(ip)) {
      return { success: false, error: 'Превышено количество попыток. Подождите 15 минут.' };
    }

    const foundUser = getUserByLogin(loginStr);
    if (!foundUser) {
      recordFailedLogin(ip);
      logger.authError(`Неудачная попытка входа: пользователь "${loginStr}" не найден`, loginStr, ip);
      return { success: false, error: 'Неверный логин или пароль' };
    }

    if (!foundUser.isActive) {
      logger.authError(`Попытка входа деактивированного пользователя: ${loginStr}`, loginStr, ip);
      return { success: false, error: 'Пользователь деактивирован' };
    }

    if (!verifyPassword(password, foundUser.passwordHash)) {
      recordFailedLogin(ip);
      logger.authError(`Неудачная попытка входа: неверный пароль для ${loginStr}`, loginStr, ip);
      return { success: false, error: 'Неверный логин или пароль' };
    }

    // Создаём сессию
    const token = generateToken();
    const newSession: Session = {
      id: generateId(),
      userId: foundUser.id,
      token,
      ip,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };

    const sessions = getSessions();
    sessions.push(newSession);
    saveSessions(sessions);
    setCurrentSession(token);

    setUser(foundUser);
    setSession(newSession);
    clearFailedLogin(ip);
    logger.auth(`Успешный вход: ${loginStr}`, loginStr, ip);

    return { success: true };
  }, []);

  const logout = useCallback(() => {
    if (session) {
      const sessions = getSessions().filter(s => s.id !== session.id);
      saveSessions(sessions);
      logger.auth(`Выход: ${user?.login}`, user?.login);
    }
    clearCurrentSession();
    setUser(null);
    setSession(null);
  }, [session, user]);

  const createFirstAdmin = useCallback(async (loginStr: string, password: string) => {
    const users = getUsers();
    if (users.length > 0) return false;

    const admin: User = {
      id: generateId(),
      login: loginStr,
      passwordHash: hashPassword(password),
      role: 'admin',
      isAdmin: true,
      allowedCidrs: ['0.0.0.0/0'],
      allowedComputerIds: [],
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    saveUsers([admin]);
    setIsFirstRun(false);
    logger.admin(`Создан первый администратор: ${loginStr}`, loginStr);
    
    // Автоматический вход после создания первого админа
    const token = generateToken();
    const newSession: Session = {
      id: generateId(),
      userId: admin.id,
      token,
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    saveSessions([newSession]);
    setCurrentSession(token);
    setUser(admin);
    setSession(newSession);
    
    return true;
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, login, logout, isFirstRun, createFirstAdmin, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
