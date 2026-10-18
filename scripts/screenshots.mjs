// Скриншоты интерфейса для проверки внешнего вида (запускается в CI после сквозного теста).
//   node scripts/screenshots.mjs <адрес панели> <логин> <пароль> <каталог>
// Нужен playwright и установленный Google Chrome (в Chromium из playwright нет H.264).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [base, login, password, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`снимок ${name}.png`);
};

async function session(viewport, prefix, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Europe/Moscow', ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`ошибка на странице: ${e.message}`));
  await page.goto(base);
  await page.getByLabel('Логин').waitFor();
  await wait(500);
  await shot(page, `${prefix}01-login`);
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('navigation').waitFor();
  return { ctx, page };
}

{
  const { ctx, page } = await session({ width: 1440, height: 900 }, '');
  await wait(9000); // видео успевает запуститься
  await shot(page, '02-wall');

  await page.getByRole('button', { name: /^9 камер/ }).click();
  await wait(5000);
  await shot(page, '03-wall-3x3');
  await page.getByRole('button', { name: /^4 камеры/ }).click();
  await wait(2500);

  await page.getByRole('button', { name: 'Раскладки' }).click();
  await wait(400);
  await shot(page, '04-presets');
  await page.keyboard.press('Escape');

  for (const [hash, name] of [['streams', '05-streams'], ['users', '07-users'], ['logs', '08-logs'], ['settings', '09-settings']]) {
    await page.goto(`${base}/#/${hash}`);
    await wait(1800);
    await shot(page, name);
    if (hash === 'streams') {
      await page.getByRole('button', { name: 'Изменить' }).first().click();
      await wait(4000);
      await shot(page, '06-stream-edit');
      await page.keyboard.press('Escape');
    }
  }
  await ctx.close();
}

{
  const { ctx, page } = await session({ width: 390, height: 844 }, 'm');
  await wait(6000);
  await shot(page, 'm02-wall');
  await ctx.close();
}

// Замер задержки «камера → экран». В кадре камеры — время UTC в момент кодирования,
// рядом с видео рисуем текущее время браузера; оба попадают в один снимок,
// разница между ними и есть полная задержка. Числа читаются tesseract.
const CLOCK = 'Замер задержки';
const ocrTimes = (file) => {
  try {
    const txt = execFileSync('tesseract', [file, 'stdout', '--psm', '6', '-c', 'tessedit_char_whitelist=0123456789:.'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...txt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3})/g)].map((m) => ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]);
  } catch {
    return [];
  }
};

async function measure(page, label, file) {
  const video = page.locator(`video[data-stream-name="${CLOCK}"]`).first();
  await video.waitFor({ timeout: 20000 });
  await page.waitForFunction((name) => {
    const v = document.querySelector(`video[data-stream-name="${name}"]`);
    return v && v.dataset.transport && v.readyState >= 2 && v.currentTime > 0;
  }, CLOCK, { timeout: 30000 });
  await wait(label === 'hls' ? 8000 : 3000); // HLS догоняет «живой край» не сразу
  const transport = await video.getAttribute('data-transport');
  await page.evaluate((name) => {
    const v = document.querySelector(`video[data-stream-name="${name}"]`);
    const r = v.getBoundingClientRect();
    const d = document.createElement('div');
    d.id = 'latency-clock';
    Object.assign(d.style, {
      position: 'fixed', left: `${r.left + 16}px`, top: `${r.top + r.height * 0.42}px`, zIndex: 99999,
      font: 'bold 44px "DejaVu Sans Mono", monospace', color: '#fff', background: '#000', padding: '6px 12px',
    });
    document.body.appendChild(d);
    const tick = () => { d.textContent = new Date().toISOString().slice(11, 23); requestAnimationFrame(tick); };
    tick();
  }, CLOCK);
  const results = [];
  for (let i = 0; i < 5; i++) {
    await wait(700);
    const box = await video.boundingBox();
    const f = path.join(out, `${file}-${i}.png`);
    // в кадре часы вверху слева, наши — под ними: берём левую половину видео
    await page.screenshot({ path: f, clip: { x: box.x, y: box.y, width: Math.min(box.width * 0.6, 760), height: box.height * 0.62 } });
    const t = ocrTimes(f);
    if (t.length >= 2) {
      let diff = t[1] - t[0];
      if (diff < -43_200_000) diff += 86_400_000; // переход через полночь
      if (diff >= 0 && diff < 30000) results.push(diff);
    }
    if (i > 0) fs.rmSync(f); // в ветку скриншотов — по одному снимку на способ
    else fs.renameSync(f, path.join(out, `${file}.png`));
  }
  const reported = await video.getAttribute('data-latency');
  await page.evaluate(() => document.getElementById('latency-clock')?.remove());
  results.sort((a, b) => a - b);
  const median = results.length ? results[Math.floor(results.length / 2)] : null;
  const msg = `${label}: показ через ${transport}, полная задержка камера→экран ${median === null ? 'не распознана' : `${median} мс`}` +
    ` (замеров ${results.length}: ${results.join(', ')}; оценка плеера ${reported ?? '—'} мс)`;
  console.log(`::notice title=Задержка ${label}::${msg}`);
  if (label === 'webrtc' && transport !== 'webrtc') console.log('::warning title=WebRTC::плеер не перешёл на WebRTC');
  return { transport, median, results, reported };
}

{
  // waitForFunction вычисляет строку, а CSP панели запрещает eval — для замера CSP отключаем
  const { ctx, page } = await session({ width: 1440, height: 900 }, 'lat-', { bypassCSP: true });
  fs.rmSync(path.join(out, 'lat-01-login.png'), { force: true });
  // камеру-часы — первой, стена на одну камеру
  await page.evaluate(async (name) => {
    const list = await (await fetch('/api/streams')).json();
    const arr = Array.isArray(list) ? list : list.streams;
    const ids = arr.map((s) => s.id);
    const clock = arr.find((s) => s.name === name);
    if (!clock) throw new Error('нет камеры-часов');
    const order = [clock.id, ...ids.filter((id) => id !== clock.id)];
    await fetch('/api/streams-order', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-RTSPAtom': '1' }, body: JSON.stringify({ ids: order }) });
  }, CLOCK);
  const toSingle = async () => {
    await page.reload();
    await page.getByRole('navigation').waitFor();
    await wait(1500);
    await page.keyboard.press('1');
    await wait(300);
    await page.getByRole('button', { name: 'Заполнить всеми камерами' }).click();
  };
  const summary = {};
  try {
    await toSingle();
    summary.webrtc = await measure(page, 'webrtc', '10-latency-webrtc');
    await page.evaluate(() => localStorage.setItem('rtspatom_transport', 'hls'));
    await toSingle();
    summary.hls = await measure(page, 'hls', '11-latency-hls');
    await page.evaluate(() => localStorage.removeItem('rtspatom_transport'));
  } catch (err) {
    console.log(`::warning title=Замер задержки::${String(err.message || err).split('\n')[0]}`);
  }
  fs.writeFileSync(path.join(out, 'latency.json'), JSON.stringify(summary, null, 2));
  await ctx.close();
}

await browser.close();
