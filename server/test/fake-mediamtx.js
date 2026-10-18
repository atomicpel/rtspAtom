import http from 'node:http';

/** Минимальная имитация Control API и HLS MediaMTX для тестов. */
export function startFakeMediaMtx() {
  const paths = new Map(); // name -> conf
  const ready = new Set();
  const calls = [];
  const whep = new Map(); // сеанс -> путь
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const body = chunks.length ? (/json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : raw) : null;
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
    if ((m = /^\/(s_[^/]+|live\/[^/]+)\/whep(?:\/([^/]+))?$/.exec(url.pathname))) {
      if (!m[2] && req.method === 'POST') {
        if (!ready.has(m[1])) return json(404, { error: 'no stream is available on path' });
        const id = `sess${whep.size + 1}${Date.now()}`;
        whep.set(id, m[1]);
        res.writeHead(201, { 'Content-Type': 'application/sdp', Location: `/${m[1]}/whep/${id}`, ETag: '"x"' });
        return res.end(`v=0 answer for ${body ? 'offer' : 'nothing'}\r\n`);
      }
      if (m[2] && req.method === 'DELETE') { whep.delete(m[2]); res.writeHead(200); return res.end(); }
      if (m[2] && req.method === 'PATCH') { res.writeHead(204); return res.end(); }
      return json(405, { error: 'method' });
    }
    if (url.pathname === '/v3/paths/list') {
      return json(200, {
        items: [...paths.keys()].map((name) => ({
          name, ready: ready.has(name), tracks: ready.has(name) ? ['H264'] : [],
          readers: [...whep.values()].filter((p) => p === name).map(() => ({ type: 'webRTCSession', id: 'x' })),
          bytesReceived: 0, bytesSent: 0,
        })),
      });
    }
    if ((m = /^\/v3\/paths\/get\/(.+)$/.exec(url.pathname))) {
      if (!paths.has(m[1])) return json(404, { error: 'not found' });
      return json(200, { name: m[1], ready: ready.has(m[1]), tracks: ready.has(m[1]) ? ['H264', 'MPEG-4 Audio'] : [] });
    }
    if ((m = /^\/(s_[^/]+|live\/[^/]+)\/(.+)$/.exec(url.pathname))) {
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
    paths, ready, calls, server, whep, legacyTransport: false, probeReady: true, cdnSecret: 'test-cdn-secret',
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
  return fake;
}
