// Утилита администрирования: rtspatom-admin <команда>
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from './lib/config.js';
import { openDb, nowIso } from './lib/db.js';
import { hashPassword, newId } from './lib/security.js';

const MIN_PASSWORD = 8;

const HELP = `Использование: rtspatom-admin <команда> [параметры]

Команды:
  create-admin [логин]        создать администратора (по умолчанию логин admin)
  reset-password <логин>      задать новый пароль пользователю
  list-users                  список пользователей
  unblock-ip [ip]             снять блокировку входа (без ip — со всех адресов)
  clear-ip-rules              удалить все правила IP-фильтра (если закрыли себе доступ)

Пароль запрашивается интерактивно; для скриптов: --password-stdin`;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(args) {
  if (args.includes('--password-stdin')) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  }
  if (!process.stdin.isTTY) throw new Error('Нет терминала: используйте --password-stdin');
  for (;;) {
    const p1 = await ask('Пароль: ', { hidden: true });
    if (p1.length < MIN_PASSWORD) {
      console.log(`Пароль должен быть не короче ${MIN_PASSWORD} символов.`);
      continue;
    }
    const p2 = await ask('Повторите пароль: ', { hidden: true });
    if (p1 !== p2) {
      console.log('Пароли не совпадают.');
      continue;
    }
    return p1;
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith('--'));
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }
  const config = loadConfig();
  const db = openDb(path.join(config.dataDir, 'rtspatom.db'));
  const logAdmin = (msg) =>
    db.prepare('INSERT INTO logs (ts, level, category, user, ip, stream, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nowIso(), 'info', 'admin', 'rtspatom-admin', '127.0.0.1', '', msg);

  switch (cmd) {
    case 'create-admin': {
      const login = args[0] || 'admin';
      if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) {
        throw new Error(`Пользователь ${login} уже существует. Для смены пароля: rtspatom-admin reset-password ${login}`);
      }
      const password = await readPassword(rest);
      if (password.length < MIN_PASSWORD) throw new Error(`Пароль должен быть не короче ${MIN_PASSWORD} символов`);
      db.prepare(
        `INSERT INTO users (id, login, password_hash, role, is_admin, allowed_cidrs, allowed_computer_ids, is_active, created_at)
         VALUES (?, ?, ?, 'admin', 1, '[]', '[]', 1, ?)`,
      ).run(newId(), login, await hashPassword(password), nowIso());
      logAdmin(`Создан администратор ${login} (из командной строки)`);
      console.log(`Администратор ${login} создан.`);
      break;
    }
    case 'reset-password': {
      const login = args[0];
      if (!login) throw new Error('Укажите логин');
      const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
      if (!user) throw new Error(`Пользователь ${login} не найден`);
      const password = await readPassword(rest);
      if (password.length < MIN_PASSWORD) throw new Error(`Пароль должен быть не короче ${MIN_PASSWORD} символов`);
      db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(await hashPassword(password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      logAdmin(`Сброшен пароль пользователя ${login} (из командной строки)`);
      console.log(`Пароль пользователя ${login} изменён, учётная запись активна.`);
      break;
    }
    case 'list-users': {
      const rows = db.prepare('SELECT login, role, is_admin, is_active, last_login_at FROM users ORDER BY login').all();
      if (rows.length === 0) console.log('Пользователей нет.');
      for (const r of rows) {
        const role = r.is_admin || r.role === 'admin' ? 'администратор' : r.role === 'operator' ? 'оператор' : 'наблюдатель';
        console.log(`${r.login.padEnd(24)} ${role.padEnd(14)} ${r.is_active ? 'активен ' : 'отключён'}  вход: ${r.last_login_at || '—'}`);
      }
      break;
    }
    case 'unblock-ip': {
      const n = args[0]
        ? db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(args[0]).changes
        : db.prepare('DELETE FROM login_attempts').run().changes;
      console.log(`Снято блокировок: ${n}`);
      break;
    }
    case 'clear-ip-rules': {
      const n = db.prepare('DELETE FROM ip_rules').run().changes;
      logAdmin(`Удалены все правила IP-фильтра (${n}) из командной строки`);
      console.log(`Удалено правил: ${n}`);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 2;
  }
  db.close();
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
