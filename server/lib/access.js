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
    allowedStreamIds: parseJson(row.allowed_stream_ids, []),
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

/** Пустой список разрешённых потоков означает доступ ко всем. */
export function canAccessStream(user, streamId) {
  if (!user) return false;
  if (user.isAdmin || user.allowedStreamIds.length === 0) return true;
  return user.allowedStreamIds.includes(streamId);
}
