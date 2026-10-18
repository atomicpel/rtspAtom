// Скриншоты интерфейса для проверки внешнего вида (запускается в CI после сквозного теста).
//   node scripts/screenshots.mjs <адрес панели> <логин> <пароль> <каталог>
// Нужен playwright и установленный Google Chrome (в Chromium из playwright нет H.264).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [base, login, password, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`снимок ${name}.png`);
};

async function session(viewport, prefix) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
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

await browser.close();
