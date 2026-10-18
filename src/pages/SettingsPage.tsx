import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import type { IpRule, Settings } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../contexts/AuthContext';
import { hints } from '../lib/platform';
import { useToast } from '../components/Toast';
import { Button, Field, IconButton, Notice, PageHeader, Section, inputCls } from '../components/ui';

const TTL = [
  { v: 900, l: '15 минут' }, { v: 3600, l: '1 час' }, { v: 4 * 3600, l: '4 часа' },
  { v: 12 * 3600, l: '12 часов' }, { v: 86400, l: 'Сутки' }, { v: 7 * 86400, l: 'Неделя' },
];

export function SettingsPage() {
  const { toast } = useToast();
  const h = hints(useAuth().platform);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: sys } = usePolling(api.system, 10000);
  const { data: ipData, setData: setIpData } = usePolling(api.ipRules);
  const [rule, setRule] = useState({ cidr: '', type: 'white' as IpRule['type'], comment: '' });
  const [ruleError, setRuleError] = useState('');

  useEffect(() => {
    api.settings().then((s) => { setSettings(s); setSaved(s); }).catch((err) => toast('error', errorMessage(err)));
  }, [toast]);

  const dirty = settings && saved && JSON.stringify(settings) !== JSON.stringify(saved);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { tlsEnabled: _tls, ...values } = settings;
      const s = await api.saveSettings(values);
      setSettings(s);
      setSaved(s);
      toast('success', 'Настройки сохранены');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addRule = async () => {
    setRuleError('');
    if (!rule.cidr.trim()) return setRuleError('Укажите адрес или подсеть');
    if (!rule.comment.trim()) return setRuleError('Добавьте комментарий: чей это адрес');
    try {
      setIpData(await api.addIpRule({ ...rule, cidr: rule.cidr.trim(), priority: 1 }));
      setRule({ cidr: '', type: rule.type, comment: '' });
      toast('success', 'Правило добавлено');
    } catch (err) {
      setRuleError(errorMessage(err));
    }
  };

  const deleteRule = async (r: IpRule) => {
    try {
      setIpData(await api.deleteIpRule(r.id));
      toast('info', `Правило ${r.cidr} удалено`);
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  if (!settings) return <div className="px-6 py-8 text-muted">Загрузка настроек</div>;
  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const num = (v: string, d: number) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24">
      <PageHeader title="Настройки" />

      <Section title="Камеры" desc="Как сервер забирает видео">
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { v: true, t: 'Постоянно', d: 'Видео открывается сразу, состояние камер видно всегда' },
            { v: false, t: 'Только при просмотре', d: 'Камера подключается, когда её кто-то смотрит. Меньше нагрузка на сеть.' },
          ].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => set({ camerasAlwaysOn: o.v })} aria-pressed={settings.camerasAlwaysOn === o.v}
              className={`text-left px-3.5 py-3 rounded-md border transition-colors ${settings.camerasAlwaysOn === o.v ? 'border-steel bg-steel/10' : 'border-line hover:border-line-strong'}`}>
              <span className="block font-bold text-sm">{o.t}</span>
              <span className="block text-[13px] text-muted mt-0.5">{o.d}</span>
            </button>
          ))}
        </div>
        <span className="block text-[13px] text-muted mt-5 mb-1.5">Показ видео в браузере</span>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { v: true, t: 'Минимальная задержка', d: 'WebRTC, около 0,3 секунды. Нужен открытый порт видео (8189 UDP/TCP). Если он закрыт или кодек не подходит — автоматически HLS.' },
            { v: false, t: 'Совместимость', d: 'Только LL-HLS через порт панели. Задержка 1–3 секунды.' },
          ].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => set({ lowLatency: o.v })} aria-pressed={settings.lowLatency === o.v}
              className={`text-left px-3.5 py-3 rounded-md border transition-colors ${settings.lowLatency === o.v ? 'border-steel bg-steel/10' : 'border-line hover:border-line-strong'}`}>
              <span className="block font-bold text-sm">{o.t}</span>
              <span className="block text-[13px] text-muted mt-0.5">{o.d}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Одновременных просмотров, не больше" hint="Сумма по всем пользователям и камерам">
            <input type="number" min={1} max={1000} className={inputCls} value={settings.maxConnections}
              onChange={(e) => set({ maxConnections: num(e.target.value, 100) })} />
          </Field>
        </div>
      </Section>

      <Section title="Вход в систему" desc="Сеансы и защита от подбора пароля">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Выход при бездействии через">
            <select className={inputCls} value={settings.sessionTtl} onChange={(e) => set({ sessionTtl: Number(e.target.value) })}>
              {!TTL.some((t) => t.v === settings.sessionTtl) && <option value={settings.sessionTtl}>{Math.round(settings.sessionTtl / 60)} мин</option>}
              {TTL.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Field>
          <Field label="Ошибок входа до блокировки" hint="Блокировка адреса на 15 минут">
            <input type="number" min={1} max={50} className={inputCls} value={settings.rateLimitLogin}
              onChange={(e) => set({ rateLimitLogin: num(e.target.value, 5) })} />
          </Field>
          <Field label="Запросов в минуту с адреса">
            <input type="number" min={30} max={6000} className={inputCls} value={settings.rateLimitApi}
              onChange={(e) => set({ rateLimitApi: num(e.target.value, 600) })} />
          </Field>
        </div>
      </Section>

      <Section title="Доступ по адресам" desc="Кому вообще можно открыть панель">
        <p className="text-[13px] text-muted mb-3">
          Сначала проверяются запреты. Если есть хотя бы одно разрешение, панель открывается только с перечисленных адресов.
          С самого сервера доступ есть всегда. Ваш адрес: <span className="text-fg tabular">{ipData?.yourIp || '…'}</span>
        </p>
        <div className="border border-line rounded-md divide-y divide-line mb-3">
          <AnimatePresence initial={false}>
            {(ipData?.rules || []).map((r) => (
              <motion.div key={r.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 px-3 py-2 overflow-hidden">
                <span className={`text-[13px] w-24 shrink-0 ${r.type === 'white' ? 'text-ok' : 'text-alarm'}`}>{r.type === 'white' ? 'Разрешить' : 'Запретить'}</span>
                <span className="tabular w-40 shrink-0">{r.cidr}</span>
                <span className="text-muted truncate flex-1">{r.comment}</span>
                <IconButton icon={Trash2} label="Удалить правило" onClick={() => deleteRule(r)} />
              </motion.div>
            ))}
          </AnimatePresence>
          {ipData && ipData.rules.length === 0 && <p className="px-3 py-2.5 text-[13px] text-muted">Правил нет — панель открывается с любого адреса.</p>}
        </div>
        <form className="grid sm:grid-cols-[130px_180px_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); addRule(); }}>
          <select className={inputCls} value={rule.type} onChange={(e) => setRule({ ...rule, type: e.target.value as IpRule['type'] })} aria-label="Тип правила">
            <option value="white">Разрешить</option>
            <option value="black">Запретить</option>
          </select>
          <input className={inputCls} placeholder="192.168.1.0/24" value={rule.cidr} onChange={(e) => setRule({ ...rule, cidr: e.target.value })} aria-label="Адрес или подсеть" />
          <input className={inputCls} placeholder="Комментарий: пост охраны" value={rule.comment} onChange={(e) => setRule({ ...rule, comment: e.target.value })} aria-label="Комментарий" />
          <Button type="submit" icon={Plus}>Добавить</Button>
        </form>
        {ruleError && <p className="text-[13px] text-alarm mt-2">{ruleError}</p>}
      </Section>

      <Section title="Журнал" desc="Хранение и формат записей">
        <div className="grid sm:grid-cols-2 gap-4 max-w-lg">
          <Field label="Хранить записи, дней">
            <input type="number" min={1} max={3650} className={inputCls} value={settings.logRetentionDays}
              onChange={(e) => set({ logRetentionDays: num(e.target.value, 90) })} />
          </Field>
          <Field label="Формат системного журнала" hint={h.logs}>
            <select className={inputCls} value={settings.logFormat} onChange={(e) => set({ logFormat: e.target.value as Settings['logFormat'] })}>
              <option value="json">JSON</option>
              <option value="syslog">Syslog</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="О системе">
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Версия</dt><dd>RTSP Atom {sys?.version}</dd>
          <dt className="text-muted">Сервер</dt><dd>{sys ? `${sys.hostname}, ${sys.platform}` : '…'}</dd>
          <dt className="text-muted">Видеосервер</dt>
          <dd className={sys?.mediamtx.reachable ? '' : 'text-alarm'}>
            {sys ? (sys.mediamtx.reachable ? `MediaMTX ${sys.mediamtx.version || ''} работает` : `MediaMTX не отвечает (${h.mediamtxStatus})`) : '…'}
          </dd>
          <dt className="text-muted">HTTPS</dt>
          <dd>{settings.tlsEnabled ? 'Включён' : `Выключен. Включается при установке: ${h.installTls}`}</dd>
        </dl>
        {sys && !sys.mediamtx.reachable && sys.mediamtx.lastError && <div className="mt-3"><Notice tone="error">{sys.mediamtx.lastError}</Notice></div>}
      </Section>

      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            className="fixed bottom-0 inset-x-0 z-30 border-t border-line bg-panel">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-end gap-2">
              <span className="text-[13px] text-muted mr-auto">Есть несохранённые изменения</span>
              <Button variant="ghost" onClick={() => setSettings(saved)}>Отменить</Button>
              <Button variant="primary" busy={saving} onClick={save}>Сохранить настройки</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
