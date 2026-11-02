import fs from 'node:fs';
import path from 'node:path';

/**
 * Контроль работы панели, чтобы в журнале было видно, что случилось:
 *  - признак жизни в файле каждые 10 с; если прошлый запуск не завершился штатно — запись о сбое
 *    или выключении компьютера и о том, сколько панель не работала;
 *  - необработанные ошибки — в журнал до выхода процесса (служба перезапустится сама);
 *  - «замирания» (процесс не отвечал дольше 3 с: перегрузка компьютера, диск, сон) — в журнал.
 */
export function startHealth({ dataDir, log, version }) {
  const file = path.join(dataDir, 'heartbeat.json');
  const write = (clean) => {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, version, at: new Date().toISOString(), clean }));
    } catch { /* диск недоступен — не мешаем работе */ }
  };

  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prev && prev.clean === false && prev.at) {
      const at = Date.parse(prev.at);
      const gap = Math.round((Date.now() - at) / 1000);
      log.error('error', `Панель была остановлена не штатно: последний признак работы ${new Date(at).toLocaleString('ru-RU')}, ` +
        `перерыв около ${gap} с. Причина — сбой процесса (подробности в предыдущих записях журнала и в файлах служб) ` +
        'или выключение / перезагрузка компьютера.');
    }
  } catch { /* первый запуск */ }
  write(false);

  const beat = setInterval(() => write(false), 10_000);
  beat.unref?.();

  // Замирание процесса: интервал в 1 с пришёл заметно позже
  let last = Date.now();
  let lastReport = 0;
  const lag = setInterval(() => {
    const now = Date.now();
    const delay = now - last - 1000;
    last = now;
    if (delay > 3000 && now - lastReport > 60_000) {
      lastReport = now;
      log.warn('error', `Панель не отвечала ${Math.round(delay / 1000)} с (с ${new Date(now - delay).toLocaleTimeString('ru-RU')}): ` +
        'компьютер перегружен, диск не успевает или система засыпала.');
    }
  }, 1000);
  lag.unref?.();

  process.on('uncaughtException', (err) => {
    try { log.error('error', `Сбой панели: ${err?.stack || err}. Служба будет перезапущена.`); } catch { /* журнал недоступен */ }
    console.error(err);
    write(false);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    try { log.error('error', `Необработанная ошибка: ${err?.stack || err}`); } catch { /* журнал недоступен */ }
    console.error(err);
  });

  return {
    /** Штатная остановка — в следующий запуск сбоем не считается. */
    clean() {
      clearInterval(beat);
      clearInterval(lag);
      write(true);
    },
  };
}
