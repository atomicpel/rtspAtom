import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';
import { onReconnected } from './connection';

/**
 * Загружает данные и (если intervalMs > 0) периодически обновляет их,
 * пока вкладка видима. reload() — принудительное обновление.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      setData(d);
      setError('');
      return d;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // после восстановления связи — сразу свежие данные
  useEffect(() => onReconnected(() => { reload(); }), [reload]);

  useEffect(() => {
    reload();
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, intervalMs);
    return () => clearInterval(id);
  }, [reload, intervalMs]);

  return { data, setData, error, loading, reload };
}
