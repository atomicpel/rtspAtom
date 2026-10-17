import { badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/security.js';
import { nowIso, parseJson } from '../lib/db.js';

const LAYOUTS = ['1x1', '2x2', '3x3', '4x4'];
const MAX_CELLS = 16;

function cleanCells(cells) {
  if (!Array.isArray(cells)) throw badRequest('cells должен быть списком');
  return cells.slice(0, MAX_CELLS).map((c) => ({
    computerId: c?.computerId ? String(c.computerId) : null,
    streamId: c?.streamId ? String(c.streamId) : null,
  }));
}

export function registerWall(router, app) {
  const { db } = app;

  router.get('/api/wall/state', (ctx) => {
    const row = db.prepare('SELECT state FROM wall_state WHERE user_id = ?').get(ctx.user.id);
    return parseJson(row?.state, null) || { layout: '2x2', cells: [], refreshInterval: 0 };
  });

  router.put('/api/wall/state', async (ctx) => {
    const b = await ctx.json();
    const state = {
      layout: LAYOUTS.includes(b.layout) ? b.layout : '2x2',
      cells: cleanCells(b.cells || []),
      refreshInterval: Math.max(0, Math.min(86400, Number(b.refreshInterval) || 0)),
    };
    db.prepare(
      'INSERT INTO wall_state (user_id, state) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state',
    ).run(ctx.user.id, JSON.stringify(state));
    return state;
  });

  const list = (userId) => db.prepare('SELECT * FROM wall_configs WHERE user_id = ? ORDER BY created_at').all(userId)
    .map((r) => ({ id: r.id, name: r.name, layout: r.layout, cells: parseJson(r.cells, []), createdAt: r.created_at }));

  router.get('/api/wall/configs', (ctx) => list(ctx.user.id));

  router.post('/api/wall/configs', async (ctx) => {
    const b = await ctx.json();
    const name = String(b.name || '').trim().slice(0, 100);
    if (!name) throw badRequest('Укажите название конфигурации');
    if (!LAYOUTS.includes(b.layout)) throw badRequest('Неизвестная раскладка');
    db.prepare('INSERT INTO wall_configs (id, user_id, name, layout, cells, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), ctx.user.id, name, b.layout, JSON.stringify(cleanCells(b.cells || [])), nowIso());
    return list(ctx.user.id);
  });

  router.delete('/api/wall/configs/:id', (ctx) => {
    const r = db.prepare('DELETE FROM wall_configs WHERE id = ? AND user_id = ?').run(ctx.params.id, ctx.user.id);
    if (r.changes === 0) throw notFound('Конфигурация не найдена');
    return list(ctx.user.id);
  });
}
