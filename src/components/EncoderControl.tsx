import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import type { EncoderCheck, Stream } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { useToast } from './Toast';
import { Button, Field, Notice, Toggle, inputCls } from './ui';


/**
 * Управление HDMI-энкодером потока через его веб-интерфейс: проверка, битрейт вручную
 * и автоподстройка битрейта под канал (панель снижает его при потерях кадров и поднимает, когда их нет).
 */
export function EncoderControl({ stream, onSaved }: { stream: Stream; onSaved: (s: Stream) => void }) {
  const { toast } = useToast();
  const e = stream.encoder;
  const [form, setForm] = useState({ host: '', login: 'admin', password: '', minKbps: 600, maxKbps: 2000, auto: false });
  const [check, setCheck] = useState<EncoderCheck | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'save' | 'rate'>('');
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!e) return;
    setForm({ host: e.host, login: e.login || 'admin', password: '', minKbps: e.minKbps, maxKbps: e.maxKbps, auto: e.auto });
    setCheck(null);
  }, [stream.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e) return null;
  const creds = { host: form.host, login: form.login, password: form.password || undefined };

  const doCheck = async () => {
    setBusy('check');
    try { setCheck(await api.checkEncoder(stream.id, creds)); } catch (err) { setCheck({ ok: false, error: errorMessage(err) }); } finally { setBusy(''); }
  };

  const save = async (auto = form.auto) => {
    setBusy('save');
    try {
      const s = await api.saveEncoder(stream.id, { enabled: true, ...creds, minKbps: form.minKbps, maxKbps: form.maxKbps, auto });
      setForm({ ...form, auto, password: '' });
      onSaved(s);
      toast('success', auto ? 'Автоподстройка включена' : 'Настройки энкодера сохранены');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const setRate = async () => {
    const kbps = parseInt(manual, 10);
    if (!kbps) return;
    setBusy('rate');
    try {
      if (form.password || form.host !== e.host || form.login !== e.login) {
        onSaved(await api.saveEncoder(stream.id, { enabled: true, ...creds }));
      }
      const r = await api.setEncoderBitrate(stream.id, kbps);
      toast('success', `Битрейт энкодера: ${r.bitrate} Кбит/с`);
      setManual('');
      doCheck();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const st = e.state;
  const num = (v: string, d: number) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

  return (
    <details className="group border border-line rounded-md" open={e.enabled}>
      <summary className="cursor-pointer select-none px-3 py-2 text-[13px] text-fg hover:bg-raised/60 rounded-md flex items-center gap-2">
        <Gauge className="w-4 h-4 text-muted" /> Энкодер: автоподстройка битрейта под канал
        {e.auto && <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded bg-raised text-ok">включена{st?.currentKbps ? ` · ${st.currentKbps} Кбит/с` : ''}</span>}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">
        <p className="text-[12.5px] text-muted">
          Панель следит за испорченными кадрами этого потока. При потерях она снижает битрейт энкодера на 20 % (не ниже минимума),
          а после 20 минут без потерь поднимает на 15 % (не выше максимума). Если подъём снова дал потери, 6 часов выше не идёт.
          При каждом изменении энкодер перезапускает поток — картинка пропадает на 2–3 секунды; изменения не чаще раза в 3 минуты.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Адрес энкодера"><input className={inputCls} value={form.host} placeholder="11.196.27.131" onChange={(ev) => setForm({ ...form, host: ev.target.value })} /></Field>
          <Field label="Логин веб-интерфейса"><input className={inputCls} value={form.login} autoComplete="off" onChange={(ev) => setForm({ ...form, login: ev.target.value })} /></Field>
          <Field label="Пароль веб-интерфейса">
            <input type="password" className={inputCls} value={form.password} autoComplete="new-password"
              placeholder={e.hasPassword ? 'без изменений' : ''} onChange={(ev) => setForm({ ...form, password: ev.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="button" busy={busy === 'check'} disabled={!form.host} onClick={doCheck}>Проверить энкодер</Button>
          {check && (check.ok || check.bitrate != null ? (
            <span className="text-[13px] text-ok">
              Выход {check.output}{check.rtspUri ? ` (${check.rtspUri})` : ''}{check.matched === false ? ' — RTSP-путь не совпал, взят первый' : ''}:
              {' '}{check.bitrate} Кбит/с, {check.framerate} к/с, GOP {check.gop}{check.rcMode != null ? `, режим кодирования ${check.rcMode}` : ''}
            </span>
          ) : (
            <span className="text-[13px] text-alarm">{check.error || 'Ответ энкодера не разобран'}</span>
          ))}
        </div>
        {check && !check.ok && check.missing && check.missing.length > 0 && (
          <Notice tone="warn">
            Энкодер не сообщил поля: {check.missing.join(', ')}. Менять настройки в таком случае опасно — панель их не тронет.
            Пришлите разработчику текст ниже:
            <textarea readOnly className="mt-2 w-full h-28 rounded bg-ink border border-line p-2 font-mono text-[11px] text-fg" value={check.raw || ''} />
          </Notice>
        )}
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Минимум, Кбит/с" hint="ниже не опускаться">
            <input type="number" min={100} max={32000} className={inputCls} value={form.minKbps} onChange={(ev) => setForm({ ...form, minKbps: num(ev.target.value, 600) })} />
          </Field>
          <Field label="Максимум, Кбит/с" hint="выше не поднимать">
            <input type="number" min={100} max={32000} className={inputCls} value={form.maxKbps} onChange={(ev) => setForm({ ...form, maxKbps: num(ev.target.value, 2000) })} />
          </Field>
          <div className="pb-6">
            <Toggle checked={form.auto} onChange={(v) => save(v)} label="Автоподстройка" />
          </div>
        </div>
        {st && (
          <p className="text-[12.5px] text-muted">
            Сейчас {st.currentKbps ?? '—'} Кбит/с{st.ceilingKbps ? `, потолок ${st.ceilingKbps} (подъём выше давал потери)` : ''}
            {st.lastChange ? `; последнее изменение ${new Date(st.lastChange).toLocaleTimeString('ru-RU')} — ${st.lastNote}` : ''}.
          </p>
        )}
        <div className="flex items-end gap-2 flex-wrap">
          <Button type="button" variant="subtle" busy={busy === 'save'} onClick={() => save()}>Сохранить доступ и пределы</Button>
          <span className="flex-1" />
          <input type="number" min={100} max={32000} className={`${inputCls} w-32`} placeholder="Кбит/с" value={manual} onChange={(ev) => setManual(ev.target.value)} aria-label="Битрейт вручную" />
          <Button type="button" busy={busy === 'rate'} disabled={!manual || !form.host} onClick={setRate}>Задать битрейт</Button>
        </div>
      </div>
    </details>
  );
}
