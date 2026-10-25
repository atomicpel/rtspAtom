import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Eye, GripVertical, Pencil, Plus, Trash2, Video } from 'lucide-react';
import type { Stream, StreamTransport } from '../lib/types';
import { api, errorMessage, protocolFromUrl } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { codecHints } from '../lib/codecs';
import { useToast } from '../components/Toast';
import { VideoPlayer } from '../components/VideoPlayer';
import { EncoderInfo, EncoderTips } from '../components/EncoderInfo';
import {
  Button, Empty, Field, IconButton, Modal, Notice, PageHeader, STATUS_TEXT, StatusDot, Toggle, inputCls,
} from '../components/ui';

const emptyForm = {
  mode: 'pull' as 'pull' | 'push', name: '', description: '', url: '', transport: 'auto' as StreamTransport, sourceLogin: '', sourcePassword: '',
  record: undefined as boolean | undefined, // не задано — как в настройках архива
};

const MODES = [
  { v: 'pull' as const, t: 'Забирать по адресу', d: 'Камера или энкодер с RTSP-сервером, SRT listener, UDP, HLS' },
  { v: 'push' as const, t: 'Энкодер отправляет сам', d: 'Энкодер передаёт поток на сервер по RTMP или SRT (caller)' },
];
type Check = { state: 'idle' | 'checking' | 'ok' | 'warn' | 'error'; text: string };

export function StreamsPage() {
  const { toast } = useToast();
  const { data, setData, reload, error } = usePolling(api.streams, 5000);
  const { data: sys } = usePolling(api.system, 60000);
  const streams = data || [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Stream | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle', text: '' });
  const [dragId, setDragId] = useState<string | null>(null);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setCheck({ state: 'idle', text: '' });
    setOpen(true);
  };

  const openEdit = (s: Stream) => {
    setEditing(s);
    setForm({ mode: s.mode, name: s.name, description: s.description, url: s.url, transport: s.transport, sourceLogin: s.sourceLogin, sourcePassword: '', record: s.record });
    setCheck({ state: 'idle', text: '' });
    setOpen(true);
  };

  const save = async () => {
    const push = form.mode === 'push';
    if (!form.name.trim() || (!push && !form.url.trim())) {
      toast('error', push ? 'Укажите название потока' : 'Укажите название и адрес потока');
      return;
    }
    setBusy(true);
    try {
      const body = push ? { mode: 'push' as const, name: form.name, description: form.description, record: form.record } : form;
      const saved = editing ? await api.updateStream(editing.id, body) : await api.createStream(body);
      toast('success', editing ? `Поток «${form.name}» сохранён` : `Поток «${form.name}» добавлен`);
      reload();
      // Новый поток от энкодера: окно остаётся открытым, чтобы скопировать адреса в энкодер
      if (push && (!editing || editing.mode !== 'push')) {
        setEditing(saved);
        setForm({ ...form, mode: 'push' });
        return;
      }
      setOpen(false);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const probe = async () => {
    setCheck({ state: 'checking', text: 'Подключаюсь к камере, это займёт до 12 секунд' });
    try {
      const r = await api.probeStream({ ...form, streamId: editing?.id });
      if (!r.ok) setCheck({ state: 'error', text: 'Видео не получено. Проверьте адрес, логин и пароль, доступность камеры по сети.' });
      else {
        const hints = codecHints(r.tracks).map((h) => h.text).join(' ');
        if (hints) setCheck({ state: 'warn', text: `Видео получено (${r.tracks.join(', ')}). ${hints}` });
        else setCheck({ state: 'ok', text: `Видео получено: ${r.tracks.join(', ')}. Кодеки подходят для показа с минимальной задержкой.` });
      }
    } catch (err) {
      setCheck({ state: 'error', text: errorMessage(err) });
    }
  };

  const newKey = async () => {
    if (!editing || !confirm('Выдать новый ключ? Энкодер со старым ключом перестанет передавать видео, пока его не перенастроят.')) return;
    setBusy(true);
    try {
      const s = await api.newPushKey(editing.id);
      setEditing(s);
      toast('success', 'Выдан новый ключ — перенастройте энкодер');
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: Stream) => {
    setData((prev) => prev?.map((x) => (x.id === s.id ? { ...x, isActive: !s.isActive } : x)) || prev);
    try {
      await api.updateStream(s.id, { isActive: !s.isActive });
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
      reload();
    }
  };

  const toggleRecord = async (s: Stream) => {
    setData((prev) => prev?.map((x) => (x.id === s.id ? { ...x, record: !s.record } : x)) || prev);
    try {
      await api.updateStream(s.id, { record: !s.record });
      toast('info', !s.record ? `Запись «${s.name}» в архив включена` : `Запись «${s.name}» в архив выключена — сохранённое остаётся до конца срока хранения`);
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
      reload();
    }
  };

  const remove = async (s: Stream) => {
    if (!confirm(`Удалить поток «${s.name}»? Его архив тоже будет удалён.`)) return;
    try {
      await api.deleteStream(s.id);
      toast('info', `Поток «${s.name}» удалён`);
      reload();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  // Перетаскивание строк меняет порядок камер (он же — порядок автозаполнения стены)
  const onDropRow = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = streams.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setData(ids.map((id) => streams.find((s) => s.id === id)!));
    setDragId(null);
    try {
      await api.reorderStreams(ids);
    } catch (err) {
      toast('error', errorMessage(err));
      reload();
    }
  };

  const detected = protocolFromUrl(form.url);
  const online = streams.filter((s) => s.status === 'online').length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Потоки" sub={data ? `${streams.length} всего, в сети ${online}` : 'Загрузка'}>
        <Button variant="primary" icon={Plus} onClick={openNew}>Добавить поток</Button>
      </PageHeader>

      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}

      {data && streams.length === 0 ? (
        <Empty icon={Video} title="Потоков пока нет">
          Добавьте камеру по её RTSP-адресу — она сразу появится на видеостене.
        </Empty>
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <AnimatePresence initial={false}>
            {streams.map((s) => (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: s.isActive ? 1 : 0.55 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                draggable
                onDragStart={() => setDragId(s.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropRow(s.id)}
                className={`group flex items-center gap-3 px-3 py-3 border-b border-line last:border-b-0 bg-panel hover:bg-raised/60 transition-colors ${dragId === s.id ? 'opacity-40' : ''}`}
              >
                <GripVertical className="w-4 h-4 text-line-strong cursor-grab shrink-0" aria-hidden />
                <StatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-bold truncate">{s.name}</span>
                    {s.description && <span className="text-[13px] text-muted truncate">{s.description}</span>}
                  </div>
                  <div className="text-[13px] text-muted truncate">
                    {s.mode === 'push' && s.status !== 'online' ? 'Ждёт поток от энкодера' : STATUS_TEXT[s.status]}
                    {s.tracks.length > 0 && `, ${s.tracks.join(', ')}`}
                    {', '}{s.mode === 'push' ? 'энкодер отправляет сам (RTMP / SRT)' : s.url}
                  </div>
                </div>
                {codecHints(s.tracks).length > 0 && (
                  <span className="text-warn shrink-0" title={codecHints(s.tracks).map((h) => h.text).join('\n')}>
                    <AlertTriangle className="w-4 h-4" aria-label="Кодек мешает минимальной задержке" />
                  </span>
                )}
                {s.viewers > 0 && (
                  <span className="hidden sm:flex items-center gap-1 text-[13px] text-muted tabular" title="Смотрят сейчас">
                    <Eye className="w-3.5 h-3.5" /> {s.viewers}
                  </span>
                )}
                <button type="button" onClick={() => toggleRecord(s)} aria-pressed={s.record}
                  title={s.record ? 'Запись в архив включена — выключить' : 'Запись в архив выключена — включить'}
                  className={`hidden sm:inline-flex items-center gap-1.5 h-7 px-2 rounded text-[12px] transition-colors ${s.record ? 'text-fg hover:bg-raised' : 'text-muted hover:text-fg hover:bg-raised'}`}>
                  <span className={`w-2 h-2 rounded-full ${s.record ? (s.status === 'online' ? 'bg-alarm animate-pulse' : 'bg-alarm/60') : 'border border-line-strong'}`} />
                  Запись
                </button>
                <Toggle checked={s.isActive} onChange={() => toggle(s)} />
                <IconButton icon={Pencil} label="Изменить" onClick={() => openEdit(s)} />
                <IconButton icon={Trash2} label="Удалить" onClick={() => remove(s)} className="hover:!text-alarm" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {streams.length > 1 && <p className="text-[13px] text-muted mt-3">Порядок меняется перетаскиванием строк. В этом порядке камеры расставляются на видеостене.</p>}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Изменить поток' : 'Новый поток'} wide
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="primary" busy={busy} onClick={save}>{editing ? (editing.mode === 'push' && form.mode === 'push' ? 'Готово' : 'Сохранить') : 'Добавить поток'}</Button>
        </>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {editing?.isActive && (
            <div className="aspect-video h-[min(28vh,200px)] mx-auto bg-black rounded-md overflow-hidden">
              <VideoPlayer streamId={editing.id} name={editing.name} className="w-full h-full" />
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Название">
              <input className={inputCls} value={form.name} autoFocus placeholder="Въезд, ворота 1"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Примечание">
              <input className={inputCls} value={form.description} placeholder="Необязательно: место, объект"
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-2" role="group" aria-label="Откуда берётся видео">
            {MODES.map((o) => (
              <button key={o.v} type="button" onClick={() => { setForm({ ...form, mode: o.v }); setCheck({ state: 'idle', text: '' }); }}
                aria-pressed={form.mode === o.v}
                className={`text-left px-3.5 py-2.5 rounded-md border transition-colors ${form.mode === o.v ? 'border-steel bg-steel/10' : 'border-line hover:border-line-strong'}`}>
                <span className="block font-bold text-sm">{o.t}</span>
                <span className="block text-[13px] text-muted mt-0.5">{o.d}</span>
              </button>
            ))}
          </div>
          {form.mode === 'push' ? (
            editing?.mode === 'push' && editing.push ? (
              <EncoderInfo stream={editing} addresses={sys?.addresses} onNewKey={newKey} busy={busy} />
            ) : (
              <Notice>После сохранения здесь появятся адрес сервера и ключ потока — их нужно вписать в энкодер.</Notice>
            )
          ) : (<>
          <Field label={detected ? `Адрес потока (${detected})` : 'Адрес потока'}
            hint="rtsp://, rtsps://, rtmp://, srt://host:порт (энкодер в режиме Listener), udp+mpegts://0.0.0.0:порт или адрес мультикаста, http(s):// (HLS). Логин и пароль из адреса перенесутся в поля ниже.">
            <input className={inputCls} value={form.url} placeholder="rtsp://192.168.1.64:554/Streaming/Channels/101"
              onChange={(e) => { setForm({ ...form, url: e.target.value }); setCheck({ state: 'idle', text: '' }); }} />
          </Field>
          {detected === 'HLS' && (() => {
            // у HDMI-энкодеров рядом с HLS обычно есть RTSP с тем же номером потока: …/0.m3u8 → rtsp://…:554/0
            const m = /^https?:\/\/([^/:]+)(?::\d+)?\/(\w+)\.m3u8/i.exec(form.url.trim());
            const guess = m ? `rtsp://${m[1]}:554/${m[2]}` : '';
            return (
              <Notice tone="warn">
                HLS — самый ненадёжный и медленный способ забирать видео (задержка 2–10 с, некоторые энкодеры обрывают его
                через несколько секунд, хотя VLC показывает). Включите в энкодере RTSP-адрес потока
                {guess ? <> (обычно <span className="font-mono text-fg">{guess}</span>)</> : null} или отправку RTMP
                («Энкодер отправляет сам»).
              </Notice>
            );
          })()}
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Логин камеры">
              <input className={inputCls} value={form.sourceLogin} autoComplete="off"
                onChange={(e) => setForm({ ...form, sourceLogin: e.target.value })} />
            </Field>
            <Field label="Пароль камеры">
              <input type="password" className={inputCls} value={form.sourcePassword} autoComplete="new-password"
                placeholder={editing?.hasPassword ? 'без изменений' : ''}
                onChange={(e) => setForm({ ...form, sourcePassword: e.target.value })} />
            </Field>
            <Field label="Транспорт RTSP" hint="UDP — только если камера не умеет TCP: в обычной сети он теряет пакеты">
              <select className={inputCls} value={form.transport} disabled={detected !== null && detected !== 'RTSP'}
                onChange={(e) => setForm({ ...form, transport: e.target.value as StreamTransport })}>
                <option value="auto">Автоматически (TCP)</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button type="button" busy={check.state === 'checking'} disabled={!form.url} onClick={probe}>Проверить подключение</Button>
            <AnimatePresence mode="wait">
              {check.text && (
                <motion.p key={check.state + check.text} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className={`text-[13px] flex-1 min-w-[200px] ${check.state === 'ok' ? 'text-ok' : check.state === 'warn' ? 'text-warn' : check.state === 'error' ? 'text-alarm' : 'text-muted'}`}>
                  {check.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          </>)}
          <div className="flex items-center gap-2 flex-wrap">
            <Toggle checked={form.record ?? true} onChange={(v) => setForm({ ...form, record: v })} label="Записывать в архив" />
            <span className="text-muted text-[13px]">срок хранения и запас места — в настройках</span>
          </div>
          <EncoderTips />
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
