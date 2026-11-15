const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PRICE_RUB = Number(process.env.PRICE_RUB || 490);
// dev — оплата подтверждается сразу (для проверки);
// off — всё бесплатно, оплата не нужна;
// иное — оплата должна прийти от платёжной системы (см. README).
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'dev';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'invites.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- хранилище ----------
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = {}; }
for (const k of Object.keys(db)) if (!db[k] || !db[k].token || !db[k].config) delete db[k]; // записи старого формата
const byToken = new Map(Object.values(db).map((inv) => [inv.token, inv]));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  }, 150);
}
process.on('SIGTERM', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {} process.exit(0); });

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newSlug() {
  for (;;) {
    let s = '';
    const b = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) s += SLUG_ALPHABET[b[i] % SLUG_ALPHABET.length];
    if (!db[s]) return s;
  }
}
const newToken = () => crypto.randomBytes(18).toString('hex'); // 36 символов

// ---------- ограничение частоты ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();
const rate = (name, max, windowMs) => (req, res, next) =>
  limited(`${name}:${req.ip}`, max, windowMs) ? res.status(429).json({ error: 'Слишком часто, попробуйте позже' }) : next();

// ---------- проверка и очистка конфигурации ----------
const THEMES = ['pink', 'peach', 'mint', 'night', 'lilac'];
const FILE_RE = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;
const s = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function normalizeConfig(raw) {
  const c = obj(raw), gate = obj(c.gate), ask = obj(c.ask), confirm = obj(c.confirm),
    date = obj(c.date), fin = obj(c.final);
  const photo = typeof c.photo === 'string' && FILE_RE.test(c.photo) && fs.existsSync(path.join(UPLOAD_DIR, c.photo)) ? c.photo : '';
  return {
    toName: s(c.toName, 40),
    fromName: s(c.fromName, 40),
    theme: THEMES.includes(c.theme) ? c.theme : 'pink',
    photo,
    gate: { type: gate.type === 'button' ? 'button' : 'envelope', text: s(gate.text, 80) },
    ask: {
      title: s(ask.title, 140) || 'Пойдёшь со мной на свидание?',
      text: s(ask.text, 500),
      sticker: s(ask.sticker, 16),
      yes: s(ask.yes, 30) || 'Да 💖',
      noLines: arr(ask.noLines, 8).map((x) => s(x, 40)).filter(Boolean),
    },
    confirm: { title: s(confirm.title, 120), text: s(confirm.text, 400), sticker: s(confirm.sticker, 16) },
    date: { enabled: date.enabled !== false, title: s(date.title, 120), text: s(date.text, 300), sticker: s(date.sticker, 16) },
    choices: arr(c.choices, 3).map((q) => {
      q = obj(q);
      return {
        title: s(q.title, 120),
        multi: Boolean(q.multi),
        items: arr(q.items, 8).map((it) => {
          it = obj(it);
          return { name: s(it.name, 40), emoji: s(it.emoji, 16) };
        }).filter((it) => it.name),
      };
    }).filter((q) => q.items.length >= 2),
    final: { title: s(fin.title, 120), text: s(fin.text, 600), sticker: s(fin.sticker, 16) },
  };
}

// ---------- приложение ----------
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use('/api', express.json({ limit: '64kb' }));
app.use('/u', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const meta = () => ({ price: PRICE_RUB, pay: PAYMENT_MODE !== 'off', days: 30 });
app.get('/api/meta', (req, res) => res.json(meta()));
app.get('/api/config', (req, res) => res.json({ price: PRICE_RUB, paymentRequired: PAYMENT_MODE !== 'off' })); // для главной

// ---- загрузка фото ----
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}
app.post('/api/upload', rate('upload', 30, 3600e3), express.raw({ type: () => true, limit: '7mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Файл не получен' });
  const ext = sniff(buf);
  if (!ext) return res.status(400).json({ error: 'Подходят только фото JPG, PNG, WebP или GIF' });
  const file = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  res.json({ file });
});

// ---- создание и правка (владелец) ----
function ownerView(inv) {
  return {
    slug: inv.slug, config: inv.config, paid: inv.paid, createdAt: inv.createdAt,
    stats: inv.stats, answer: inv.answer, price: PRICE_RUB,
  };
}
app.post('/api/inv', rate('create', 20, 3600e3), (req, res) => {
  const config = normalizeConfig((req.body || {}).config);
  if (!config.toName) return res.status(400).json({ error: 'Укажите, кого приглашаете' });
  const inv = {
    slug: newSlug(), token: newToken(), config,
    paid: PAYMENT_MODE === 'off', createdAt: new Date().toISOString(),
    stats: { opens: 0, noClicks: 0 }, answer: null,
  };
  db[inv.slug] = inv; byToken.set(inv.token, inv); save();
  res.json({ slug: inv.slug, owner: inv.token });
});

const TOKEN_RE = /^[a-f0-9]{36}$/;
function owned(req, res) {
  const inv = TOKEN_RE.test(req.params.token) ? byToken.get(req.params.token) : null;
  if (!inv) { res.status(404).json({ error: 'Приглашение не найдено' }); return null; }
  return inv;
}
app.get('/api/m/:token', (req, res) => { const inv = owned(req, res); if (inv) res.json(ownerView(inv)); });
app.put('/api/m/:token', rate('edit', 60, 3600e3), (req, res) => {
  const inv = owned(req, res); if (!inv) return;
  const config = normalizeConfig((req.body || {}).config);
  if (!config.toName) return res.status(400).json({ error: 'Укажите, кого приглашаете' });
  inv.config = config; save();
  res.json({ ok: true });
});
app.post('/api/m/:token/pay', rate('pay', 30, 3600e3), (req, res) => {
  const inv = owned(req, res); if (!inv) return;
  if (inv.paid) return res.json({ paid: true });
  if (PAYMENT_MODE === 'dev') { inv.paid = true; save(); return res.json({ paid: true, dev: true }); }
  // Здесь подключается платёжная система (например, ЮKassa): создать платёж на PRICE_RUB,
  // вернуть confirmationUrl, а paid = true выставлять в обработчике уведомления (webhook).
  res.status(501).json({ error: 'Оплата пока не подключена' });
});

// ---- получатель ----
app.get('/api/i/:slug', (req, res) => {
  const inv = db[req.params.slug];
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  if (!inv.paid) return res.status(402).json({ error: 'Приглашение ещё не активировано' });
  res.json({ config: inv.config, answered: Boolean(inv.answer && inv.answer.finishedAt) });
});
app.post('/api/i/:slug/event', rate('event', 300, 3600e3), (req, res) => {
  const inv = db[req.params.slug];
  if (!inv || !inv.paid) return res.status(404).end();
  const { type, data } = obj(req.body), d = obj(data);
  const a = inv.answer || (inv.answer = { choices: [] });
  switch (type) {
    case 'open': inv.stats.opens += 1; break;
    case 'no': inv.stats.noClicks += 1; break;
    case 'yes': a.yesAt = a.yesAt || new Date().toISOString(); break;
    case 'date': a.date = { date: s(d.date, 10), time: s(d.time, 5) }; break;
    case 'choices': {
      const i = Number(d.index);
      if (Number.isInteger(i) && i >= 0 && i < 3) {
        a.choices[i] = { title: s(d.title, 120), picks: arr(d.picks, 8).map((x) => s(x, 40)).filter(Boolean) };
      }
      break;
    }
    case 'final': a.finishedAt = new Date().toISOString(); break;
    default: return res.status(400).end();
  }
  save();
  res.status(204).end();
});

// ---- страницы ----
const page = (name) => (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', name));
};
app.get('/i/:slug', page('invite.html'));
app.get('/m/:token', page('owner.html'));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой файл' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Некорректные данные' });
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

app.listen(PORT, () => console.log(`«Только да» запущен: http://localhost:${PORT} (оплата: ${PAYMENT_MODE})`));
