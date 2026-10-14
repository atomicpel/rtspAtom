import { IpRule } from './types';
import { getIpRules } from './storage';

/**
 * Проверка IP по правилам whitelist/blacklist
 * Поддерживает CIDR нотацию (192.168.1.0/24)
 */

function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) + 
          (parseInt(parts[1]) << 16) + 
          (parseInt(parts[2]) << 8) + 
          parseInt(parts[3])) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [network, maskStr] = cidr.split('/');
  const mask = parseInt(maskStr || '32');
  
  const networkNum = ipToNumber(network);
  const ipNum = ipToNumber(ip);
  
  const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  
  return (networkNum & maskBits) === (ipNum & maskBits);
}

export function checkIpAccess(ip: string): { allowed: boolean; reason: string } {
  const rules = getIpRules();
  
  if (rules.length === 0) {
    return { allowed: true, reason: 'Нет правил — доступ разрешён' };
  }
  
  // Sort by priority
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  
  // Check black list first (higher priority)
  const blackRules = sortedRules.filter(r => r.type === 'black');
  for (const rule of blackRules) {
    if (cidrContains(rule.cidr, ip)) {
      return { allowed: false, reason: `Заблокировано правилом: ${rule.cidr} (${rule.comment})` };
    }
  }
  
  // Check white list
  const whiteRules = sortedRules.filter(r => r.type === 'white');
  if (whiteRules.length > 0) {
    for (const rule of whiteRules) {
      if (cidrContains(rule.cidr, ip)) {
        return { allowed: true, reason: `Разрешено правилом: ${rule.cidr}` };
      }
    }
    return { allowed: false, reason: 'IP не в белом списке' };
  }
  
  return { allowed: true, reason: 'Доступ разрешён' };
}

export function validateCidr(cidr: string): boolean {
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/);
  if (!match) return false;
  
  const [, a, b, c, d, , mask] = match;
  const nums = [parseInt(a), parseInt(b), parseInt(c), parseInt(d)];
  
  if (nums.some(n => n < 0 || n > 255)) return false;
  if (mask !== undefined && (parseInt(mask) < 0 || parseInt(mask) > 32)) return false;
  
  return true;
}
