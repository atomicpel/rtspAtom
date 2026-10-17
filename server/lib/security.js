import crypto from 'node:crypto';
import net from 'node:net';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

// Хеш-заглушка для выравнивания времени ответа, когда пользователя нет.
let dummyHash = null;
export async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password');
  await verifyPassword(password, dummyHash);
  return false;
}

export const newId = () => crypto.randomBytes(9).toString('base64url');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- IP / CIDR ----------

export function normalizeIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  return s;
}

export function parseCidr(cidr) {
  const s = String(cidr || '').trim();
  const [addr, maskStr] = s.split('/');
  const family = net.isIP(addr);
  if (!family) return null;
  const max = family === 4 ? 32 : 128;
  let prefix = max;
  if (maskStr !== undefined) {
    if (!/^\d{1,3}$/.test(maskStr)) return null;
    prefix = Number(maskStr);
    if (prefix < 0 || prefix > max) return null;
  }
  return { addr, prefix, type: family === 4 ? 'ipv4' : 'ipv6' };
}

export const isValidCidr = (cidr) => parseCidr(cidr) !== null;

export function cidrContains(cidr, ip) {
  const c = parseCidr(cidr);
  const addr = normalizeIp(ip);
  const fam = net.isIP(addr);
  if (!c || !fam) return false;
  const list = new net.BlockList();
  list.addSubnet(c.addr, c.prefix, c.type);
  return list.check(addr, fam === 4 ? 'ipv4' : 'ipv6');
}

export function isLoopback(ip) {
  const a = normalizeIp(ip);
  return a === '::1' || a.startsWith('127.');
}

/**
 * Глобальные правила: сначала чёрный список, затем белый
 * (если белых правил нет — доступ разрешён). Loopback разрешён всегда,
 * чтобы администратор не мог полностью отрезать себе доступ к серверу.
 */
export function checkIpRules(rules, ip) {
  if (isLoopback(ip)) return { allowed: true, reason: 'Локальный доступ' };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted.filter((r) => r.type === 'black')) {
    if (cidrContains(r.cidr, ip)) {
      return { allowed: false, reason: `Заблокировано правилом ${r.cidr}` };
    }
  }
  const white = sorted.filter((r) => r.type === 'white');
  if (white.length === 0) return { allowed: true, reason: 'Нет ограничивающих правил' };
  for (const r of white) {
    if (cidrContains(r.cidr, ip)) return { allowed: true, reason: `Разрешено правилом ${r.cidr}` };
  }
  return { allowed: false, reason: 'IP не входит в белый список' };
}

/** Персональные ограничения пользователя: пустой список — без ограничений. */
export function userIpAllowed(allowedCidrs, ip) {
  if (!allowedCidrs || allowedCidrs.length === 0) return true;
  if (isLoopback(ip)) return true;
  return allowedCidrs.some((c) => cidrContains(c, ip));
}
