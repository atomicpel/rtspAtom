import http from 'node:http';

/** Минимальная имитация Control API и HLS MediaMTX для тестов. */
export function startFakeMediaMtx() {
  const paths = new Map(); // name -> conf
  const ready = new Set();
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    calls.push({ method: req.method, path: url.pathname, body });
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    let m;
    if (url.pathname === '/v3/info') return json(200, { version: 'fake-1.0' });
    if (url.pathname === '/v3/config/paths/list') {
      return json(200, { items: [...paths].map(([name, c]) => ({ name, ...c })) });
    }
    if ((m = /^\/v3\/config\/paths\/(add|replace)\/(.+)$/.exec(url.pathname))) {
      if (body.rtspTransport && fake.legacyTransport) return json(400, { error: 'json: unknown field "rtspTransport"' });
      if (m[1] === 'add' && paths.has(m[2])) return json(400, { error: 'path already exists' });
      paths.set(m[2], body);
      if (m[2].startsWith('probe_') && fake.probeReady) ready.add(m[2]);
      return json(200);
    }
    if ((m = /^\/v3\/config\/paths\/delete\/(.+)$/.exec(url.pathname))) {
      paths.delete(m[1]);
      ready.delete(m[1]);
      return json(200);
    }
    if (url.pathname === '/v3/paths/list') {
      return json(200, {
        items: [...paths.keys()].map((name) => ({
          name, ready: ready.has(name), tracks: ready.has(name) ? ['H264'] : [], readers: [], bytesReceived: 0, bytesSent: 0,
        })),
      });
    }
    if ((m = /^\/v3\/paths\/get\/(.+)$/.exec(url.pathname))) {
      if (!paths.has(m[1])) return json(404, { error: 'not found' });
      return json(200, { name: m[1], ready: ready.has(m[1]), tracks: ready.has(m[1]) ? ['H264', 'MPEG-4 Audio'] : [] });
    }
    if ((m = /^\/(s_[^/]+)\/(.+)$/.exec(url.pathname))) {
      // Как MediaMTX 1.21: без секрета CDN — cookie-проверка через редирект.
      if (fake.cdnSecret && req.headers.authorization !== `Bearer ${fake.cdnSecret}`) {
        res.writeHead(302, { Location: `${url.pathname}?cookieCheck=1` });
        return res.end();
      }
      if (!ready.has(m[1])) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end(`#EXTM3U\n#FAKE ${m[1]} ${m[2]}${url.search}\n`);
    }
    json(404, { error: 'unknown' });
  });
  const fake = {
    paths, ready, calls, server, legacyTransport: false, probeReady: true, cdnSecret: 'test-cdn-secret',
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
  return fake;
}
