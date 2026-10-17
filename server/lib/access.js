import { parseJson } from './db.js';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

export function userFromRow(row) {
  const isAdmin = !!row.is_admin || row.role === 'admin';
  return {
    id: row.id,
    login: row.login,
    role: isAdmin ? 'admin' : row.role,
    isAdmin,
    allowedCidrs: parseJson(row.allowed_cidrs, []),
    allowedComputerIds: parseJson(row.allowed_computer_ids, []),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export function hasRole(user, needed) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return (ROLE_RANK[user.role] || 0) >= (ROLE_RANK[needed] || 99);
}

export function canAccessComputer(user, computerId) {
  if (!user) return false;
  if (user.isAdmin || user.allowedComputerIds.length === 0) return true;
  return user.allowedComputerIds.includes(computerId);
}
