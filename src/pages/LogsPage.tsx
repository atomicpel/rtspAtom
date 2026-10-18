import React, { useCallback, useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { LogCategory, LogEntry, LogLevel } from '../lib/types';
import { api, errorMessage, LogQuery } from '../lib/api';
import { useToast } from '../components/Toast';
import { Button, PageHeader, inputCls } from '../components/ui';

const CATEGORIES: { id: LogCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'auth', label: 'Входы' },
  { id: 'access', label: 'Просмотр' },
  { id: 'stream', label: 'Камеры' },
  { id: 'admin', label: 'Изменения' },
  { id: 'error', label: 'Ошибки' },
];

const LEVEL: Record<LogLevel, { name: string; cls: string }> = {
  info: { name: 'инфо', cls: 'text-muted' },
  warning: { name: 'внимание', cls: 'text-warn' },
  error: { name: 'ошибка', cls: 'text-alarm' },
  debug: { name: 'отладка', cls: 'text-muted' },
};

const PAGE = 200;

export function LogsPage() {
  const { toast } = useToast();
  const [category, setCategory] = useState<LogCategory | 'all'>('all');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [q, setQ] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const query = useCallback((): LogQuery => ({
    category: category === 'all' ? undefined : category,
    level: level || undefined,
    q: q || undefined,
    user: userFilter || undefined,
    from: from || undefined,
    to: to || undefined,
  }), [category, level, q, userFilter, from, to]);

  const load = useCallback(async (append: boolean, offset = 0) => {
    setLoading(true);
    try {
      const r = await api.logs({ ...query(), limit: PAGE, offset });
      setTotal(r.total);
      setLogs((prev) => (append ? [...prev, ...r.items] : r.items));
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [query, toast]);

  useEffect(() => {
    const t = setTimeout(() => load(false), 250);
    return () => clearTimeout(t);
  }, [load]);

  const exportCsv = () => {
    const a = document.createElement('a');
    a.href = api.logsExportUrl(query());
    a.click();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Журнал" sub={loading ? 'Загрузка' : `Записей: ${total.toLocaleString('ru-RU')}`}>
        <Button icon={Download} onClick={exportCsv}>Выгрузить в CSV</Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1 mb-4 border-b border-line" role="tablist">
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)}
            className={`px-3 py-2 -mb-px text-sm border-b-2 transition-colors ${category === c.id ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input className={`${inputCls} pl-9`} placeholder="Поиск по тексту" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')} aria-label="Важность">
          <option value="">Любая важность</option>
          <option value="warning">Внимание</option>
          <option value="error">Ошибки</option>
          <option value="info">Информация</option>
        </select>
        <input className={inputCls} placeholder="Пользователь" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} />
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" />
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" />
      </div>

      <div className="border border-line rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="font-normal px-4 py-2.5 w-40">Время</th>
              <th className="font-normal px-4 py-2.5 w-24">Важность</th>
              <th className="font-normal px-4 py-2.5 w-32">Пользователь</th>
              <th className="font-normal px-4 py-2.5 w-32">Адрес</th>
              <th className="font-normal px-4 py-2.5">Событие</th>
            </tr>
          </thead>
          <tbody className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-b-0 bg-panel align-top">
                <td className="px-4 py-2 text-muted tabular whitespace-nowrap">
                  {new Date(l.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
                <td className={`px-4 py-2 ${LEVEL[l.level].cls}`}>{LEVEL[l.level].name}</td>
                <td className="px-4 py-2">{l.user}</td>
                <td className="px-4 py-2 text-muted tabular">{l.ip}</td>
                <td className="px-4 py-2">{l.message}</td>
              </tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">Записей с такими условиями нет</td></tr>
            )}
          </tbody>
        </table>
        {logs.length < total && (
          <div className="px-4 py-3 border-t border-line text-center">
            <Button variant="ghost" busy={loading} onClick={() => load(true, logs.length)}>
              Показать ещё (показано {logs.length} из {total})
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
