import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

export const IS_WINDOWS = process.platform === 'win32';
export const PLATFORM = IS_WINDOWS ? 'windows' : 'linux';
export const DEFAULT_CONFIG_FILE = IS_WINDOWS
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'RTSPAtom', 'config.json')
  : '/etc/rtspatom/config.json';

function defaults() {
  // В пакете фронтенд лежит рядом с сервером (app/public),
  // при разработке — в dist/ корня репозитория.
  const bundled = path.resolve(serverRoot, '..', 'public');
  const dev = path.resolve(serverRoot, '..', 'dist');
  return {
    host: '0.0.0.0',
    port: 8080,
    dataDir: path.resolve(process.cwd(), 'data'),
    publicDir: fs.existsSync(bundled) ? bundled : dev,
    trustProxy: false,
    // Каталог архива видео; пусто — <dataDir>/archive
    archiveDir: '',
    // TLS: PEM-пара cert/key (Linux) или файл pfx + passphrase (Windows).
    tls: { enabled: false, cert: '', key: '', pfx: '', passphrase: '' },
    mediamtx: {
      apiUrl: 'http://127.0.0.1:9997',
      hlsUrl: 'http://127.0.0.1:8888',
      webrtcUrl: 'http://127.0.0.1:8890',
      // Сервер выдачи записей MediaMTX (playback), только 127.0.0.1
      playbackUrl: 'http://127.0.0.1:9996',
      // RTSP-сервер MediaMTX на 127.0.0.1: передача потока энкодера в путь архива
      rtspUrl: 'rtsp://127.0.0.1:8554',
      // Должен совпадать с hlsCDNSecret в mediamtx.yml (MediaMTX 1.21+).
      cdnSecret: '',
    },
  };
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(overrides = {}) {
  let cfg = defaults();
  const file = process.env.RTSPATOM_CONFIG || DEFAULT_CONFIG_FILE;
  if (fs.existsSync(file)) {
    try {
      // Блокнот Windows может сохранить файл с BOM — убираем его.
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      cfg = merge(cfg, JSON.parse(text));
      cfg.configFile = file;
    } catch (err) {
      throw new Error(`Не удалось прочитать конфигурацию ${file}: ${err.message}`);
    }
  }
  const env = process.env;
  if (env.RTSPATOM_PORT) cfg.port = Number(env.RTSPATOM_PORT);
  if (env.RTSPATOM_HOST) cfg.host = env.RTSPATOM_HOST;
  if (env.RTSPATOM_DATA_DIR) cfg.dataDir = env.RTSPATOM_DATA_DIR;
  if (env.RTSPATOM_PUBLIC_DIR) cfg.publicDir = env.RTSPATOM_PUBLIC_DIR;
  if (env.RTSPATOM_MEDIAMTX_API) cfg.mediamtx.apiUrl = env.RTSPATOM_MEDIAMTX_API;
  if (env.RTSPATOM_MEDIAMTX_HLS) cfg.mediamtx.hlsUrl = env.RTSPATOM_MEDIAMTX_HLS;
  if (env.RTSPATOM_MEDIAMTX_WEBRTC) cfg.mediamtx.webrtcUrl = env.RTSPATOM_MEDIAMTX_WEBRTC;
  if (env.RTSPATOM_MEDIAMTX_SECRET) cfg.mediamtx.cdnSecret = env.RTSPATOM_MEDIAMTX_SECRET;
  if (env.RTSPATOM_MEDIAMTX_PLAYBACK) cfg.mediamtx.playbackUrl = env.RTSPATOM_MEDIAMTX_PLAYBACK;
  if (env.RTSPATOM_MEDIAMTX_RTSP) cfg.mediamtx.rtspUrl = env.RTSPATOM_MEDIAMTX_RTSP;
  if (env.RTSPATOM_ARCHIVE_DIR) cfg.archiveDir = env.RTSPATOM_ARCHIVE_DIR;
  cfg = merge(cfg, overrides);
  cfg.dataDir = path.resolve(cfg.dataDir);
  cfg.publicDir = path.resolve(cfg.publicDir);
  cfg.archiveDir = path.resolve(cfg.archiveDir || path.join(cfg.dataDir, 'archive'));
  return cfg;
}
