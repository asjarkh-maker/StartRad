// Админка: вход по паролю и правка настроек сайта через браузер.
// Пароль по умолчанию — хеш в admin.json (репозиторий); после смены в админке — хеш в data/settings.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const SESSION_MS = 12 * 3600e3;
const sessions = new Map(); // id -> истекает
const fails = new Map();    // ip -> [время неудачных попыток]

function storedHash() {
  const own = settings.load().admin;
  if (own && own.hash && own.salt) return own;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'admin.json'), 'utf8')); } catch { return null; }
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function check(password) {
  if (typeof password === 'string') password = password.trim(); // пробелы и переносы при копировании не считаются
  const h = storedHash();
  if (!h || typeof password !== 'string' || !password || password.length > 200) return false;
  const got = Buffer.from(hashPassword(password, h.salt).hash, 'hex');
  const want = Buffer.from(h.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const cookieOf = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)adm=([a-f0-9]{64})/) || [])[1];
function authed(req) {
  const id = cookieOf(req);
  const exp = id && sessions.get(id);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(id); return false; }
  return true;
}
// защита от подделки запросов с чужих сайтов: изменения — только со своего адреса
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

function view() {
  const s = settings.load();
  return {
    site: s.site, seller: s.seller, price: s.price, linkDays: s.linkDays,
    telegram: { tokenSet: Boolean(s.telegram.token) },
    yookassa: { shopId: s.yookassa.shopId, secretKeySet: Boolean(s.yookassa.secretKey), receipt: Boolean(s.yookassa.receipt) },
    passwordChanged: Boolean(s.admin && s.admin.hash),
  };
}

function patchFrom(b) {
  const p = {};
  if (b.site && typeof b.site === 'object') {
    p.site = {};
    for (const [k, m] of [['url', 200], ['email', 200], ['phone', 40], ['telegram', 64], ['metrikaId', 20]]) {
      const v = str(b.site[k], m); if (v !== undefined) p.site[k] = v;
    }
    if (p.site.url && !/^https?:\/\/[^\s/]+$/.test(p.site.url.replace(/\/+$/, ''))) throw new Error('Адрес сайта: например https://onlyda.ru');
    if (p.site.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.site.email)) throw new Error('Почта указана неверно');
  }
  if (b.seller && typeof b.seller === 'object') {
    p.seller = {};
    for (const [k, m] of [['status', 40], ['name', 200], ['inn', 12], ['ogrnip', 15], ['address', 300]]) {
      const v = str(b.seller[k], m); if (v !== undefined) p.seller[k] = v;
    }
    if (p.seller.inn && !/^\d{10}(\d{2})?$/.test(p.seller.inn)) throw new Error('ИНН — 10 или 12 цифр');
  }
  if (b.price !== undefined) {
    const n = Math.round(Number(b.price));
    if (!(n >= 1 && n <= 100000)) throw new Error('Цена — от 1 до 100000 ₽');
    p.price = n;
  }
  // секреты: пустое поле — оставить как есть; clear — удалить
  if (b.telegram && typeof b.telegram === 'object') {
    const t = str(b.telegram.token, 100);
    if (b.telegram.clear) p.telegram = { token: '' };
    else if (t) {
      if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error('Токен бота выглядит не так: 123456789:AA…');
      p.telegram = { token: t };
    }
  }
  if (b.yookassa && typeof b.yookassa === 'object') {
    p.yookassa = {};
    const shop = str(b.yookassa.shopId, 20);
    if (shop !== undefined) {
      if (shop && !/^\d{3,12}$/.test(shop)) throw new Error('shopId — только цифры');
      p.yookassa.shopId = shop;
    }
    const key = str(b.yookassa.secretKey, 200);
    if (b.yookassa.clearKey) p.yookassa.secretKey = '';
    else if (key) {
      if (!/^(live|test)_[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error('Секретный ключ ЮKassa начинается с live_ или test_');
      p.yookassa.secretKey = key;
    }
    if (b.yookassa.receipt !== undefined) p.yookassa.receipt = Boolean(b.yookassa.receipt);
  }
  return p;
}

function routes(app, { status, onSaved = () => {} }) {
  const sendFile = (res) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  };
  app.get('/admin', (req, res) => sendFile(res));

  app.post('/api/admin/login', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос с чужого сайта' });
    const ip = req.ip, now = Date.now();
    const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60e3);
    if (list.length >= 8) return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
    if (!check((req.body || {}).password)) {
      list.push(now); fails.set(ip, list);
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    fails.delete(ip);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, now + SESSION_MS);
    res.setHeader('Set-Cookie', `adm=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    const id = cookieOf(req); if (id) sessions.delete(id);
    res.setHeader('Set-Cookie', 'adm=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({ ok: true });
  });

  const guard = (req, res, next) => {
    if (!authed(req)) return res.status(401).json({ error: 'Нужно войти' });
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Запрос с чужого сайта' });
    next();
  };

  app.get('/api/admin/settings', guard, (req, res) => res.json({ settings: view(), status: status() }));

  app.put('/api/admin/settings', guard, (req, res) => {
    let patch;
    try { patch = patchFrom(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
    settings.save(patch);
    onSaved(patch);
    // дать боту время переподключиться с новым токеном
    setTimeout(() => res.json({ ok: true, settings: view(), status: status() }), patch.telegram ? 3000 : 0);
  });

  app.post('/api/admin/password', guard, (req, res) => {
    const { current, next } = req.body || {};
    if (!check(current)) return res.status(400).json({ error: 'Текущий пароль неверный' });
    const np = typeof next === 'string' ? next.trim() : '';
    if (np.length < 10 || np.length > 200) return res.status(400).json({ error: 'Новый пароль — не короче 10 символов' });
    settings.save({ admin: hashPassword(np) });
    // все прочие входы закрываем
    const keep = cookieOf(req); for (const id of sessions.keys()) if (id !== keep) sessions.delete(id);
    res.json({ ok: true });
  });
}

module.exports = { routes, hashPassword };
