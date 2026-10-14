import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Monitor, AlertTriangle, Loader2 } from 'lucide-react';

export function LoginPage() {
  const { login, isFirstRun, createFirstAdmin } = useAuth();
  const [loginStr, setLoginStr] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isFirstRun) {
        if (password !== confirmPassword) {
          setError('Пароли не совпадают');
          setLoading(false);
          return;
        }
        if (password.length < 4) {
          setError('Пароль должен быть не менее 4 символов');
          setLoading(false);
          return;
        }
        const success = await createFirstAdmin(loginStr, password);
        if (!success) {
          setError('Ошибка создания администратора');
        }
      } else {
        const result = await login(loginStr, password, '127.0.0.1');
        if (!result.success) {
          setError(result.error || 'Ошибка входа');
        }
      }
    } catch {
      setError('Внутренняя ошибка');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-600/30 mb-4">
            <Monitor className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-white">RTSP Сервер</h1>
          <p className="text-lg font-bold text-blue-400 mt-1">115 обрОсН</p>
          <p className="text-sm text-gray-500 mt-2">
            {isFirstRun ? 'Первичная настройка — создайте администратора' : 'Панель управления видеотрансляцией'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-900/50 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Логин</label>
            <input
              type="text"
              value={loginStr}
              onChange={e => setLoginStr(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="Введите логин"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="Введите пароль"
              required
            />
          </div>

          {isFirstRun && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Подтвердите пароль</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                placeholder="Повторите пароль"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isFirstRun ? 'Создать администратора' : 'Войти'}
          </button>

          {!isFirstRun && (
            <p className="text-xs text-gray-500 text-center">
              5 неудачных попыток → блокировка на 15 минут
            </p>
          )}
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-6">
          Изолированная локальная сеть • Astra Linux
        </p>
      </div>
    </div>
  );
}
