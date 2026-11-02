import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { hints } from '../lib/platform';
import { Button, Field, inputCls } from '../components/ui';

export function LoginPage() {
  const { login, setup, setupRequired, setupAllowedHere, platform } = useAuth();
  const h = hints(platform);
  const isFirstRun = setupRequired;
  const [loginStr, setLoginStr] = useState(isFirstRun ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isFirstRun) {
      if (password.length < 8) return setError('Пароль должен быть не короче 8 символов');
      if (password !== confirm) return setError('Пароли не совпадают');
    }
    setLoading(true);
    const r = isFirstRun ? await setup(loginStr, password) : await login(loginStr, password);
    if (!r.success) setError(r.error || 'Не удалось войти');
    setLoading(false);
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-sm"
      >
        <h1 className="text-3xl font-bold tracking-tight">RTSP Atom</h1>
        <p className="text-muted mt-1 mb-8">
          {isFirstRun ? 'Первый запуск: задайте пароль администратора' : 'Видеонаблюдение. Войдите, чтобы продолжить.'}
        </p>

        {isFirstRun && !setupAllowedHere ? (
          <div className="space-y-3 text-sm">
            <p>Администратор ещё не создан. Это делается на самом сервере:</p>
            <ul className="list-disc pl-5 space-y-1 text-muted">
              <li>откройте панель в браузере на сервере по адресу <span className="text-fg">http://127.0.0.1</span> с тем же портом;</li>
              <li>или выполните {h.adminShell}:</li>
            </ul>
            <pre className="bg-panel border border-line rounded-md px-3 py-2.5 text-fg overflow-x-auto">{h.createAdmin}</pre>
            <p className="text-muted">Затем обновите эту страницу.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Логин">
              <input className={inputCls} value={loginStr} onChange={(e) => setLoginStr(e.target.value)} autoFocus={!isFirstRun}
                autoComplete="username" required />
            </Field>
            <Field label="Пароль" hint={isFirstRun ? 'Не короче 8 символов' : undefined}>
              <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)}
                autoFocus={isFirstRun} autoComplete={isFirstRun ? 'new-password' : 'current-password'} required />
            </Field>
            {isFirstRun && (
              <Field label="Повторите пароль">
                <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password" required />
              </Field>
            )}
            {error && (
              <motion.p key={error} initial={{ x: -6 }} animate={{ x: [6, -4, 2, 0] }} transition={{ duration: 0.3 }}
                className="text-sm text-alarm">{error}</motion.p>
            )}
            <Button type="submit" variant="primary" busy={loading} className="w-full h-10">
              {isFirstRun ? 'Создать администратора' : 'Войти'}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
