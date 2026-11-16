const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const settings = require('./settings');
const pages = require('./pages');
const telegram = require('./telegram');
const yookassa = require('./yookassa');
const admin = require('./admin');

const PORT = process.env.PORT || 3000;
const S = () => settings.load();
// Режим оплаты: yookassa — настоящие платежи (если в настройках есть ключи ЮKassa);
// dev — ссылка выдаётся сразу, без денег (для проверки); off — всё бесплатно.
const paymentMode = () => process.env.PAYMENT_MODE || (S().yookassa.shopId && S().yookassa.secretKey ? 'yookassa' : 'dev');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'invites.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- хранилище ----------
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = {}; }
for (const k of Object.keys(db)) if (!db[k] || !db[k].token || !db[k].config) delete db[k]; // записи старого формата
for (const inv of Object.values(db)) if (inv.paid && !inv.expiresAt) inv.expiresAt = new Date(Date.parse(inv.createdAt) + 30 * 86400e3).toISOString();
const byToken = new Map(Object.values(db).map((inv) => [inv.token, inv]));
const byTgCode = new Map();
const newTgCode = () => crypto.randomBytes(9).toString('base64url'); // 12 символов для t.me/бот?start=
for (const inv of Object.values(db)) { if (!inv.tgCode) inv.tgCode = newTgCode(); byTgCode.set(inv.tgCode, inv); }
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
function uploaded(name, exts) {
  if (typeof name !== 'string' || !FILE_RE.test(name)) return '';
  if (!exts.includes(name.split('.').pop())) return '';
  return fs.existsSync(path.join(UPLOAD_DIR, name)) ? name : '';
}
const s = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function normalizeConfig(raw) {
  const c = obj(raw), gate = obj(c.gate), ask = obj(c.ask), confirm = obj(c.confirm),
    date = obj(c.date), fin = obj(c.final);
  return {
    toName: s(c.toName, 40),
    fromName: s(c.fromName, 40),
    theme: THEMES.includes(c.theme) ? c.theme : 'pink',
    photo: uploaded(c.photo, ['jpg', 'png', 'webp', 'gif']),
    gate: { type: gate.type === 'button' ? 'button' : 'envelope', text: s(gate.text, 80) },
    ask: {
      title: s(ask.title, 140) || 'Пойдёшь со мной на свидание?',
      text: s(ask.text, 500),
      sticker: s(ask.sticker, 16),
      yes: s(ask.yes, 30) || 'Да 💖',
      noLines: arr(ask.noLines, 8).map((x) => s(x, 40)).filter(Boolean),
      noMode: ['run', 'shrink', 'kiss', 'turn', 'honest'].includes(ask.noMode) ? ask.noMode : 'run',
      yesFx: ['burst', 'rain', 'none'].includes(ask.yesFx) ? ask.yesFx : 'burst',
    },
    confirm: {
      enabled: confirm.enabled !== false,
      picture: ['sticker', 'photo', 'none'].includes(confirm.picture) ? confirm.picture : 'sticker',
      photo: uploaded(confirm.photo, ['jpg', 'png', 'webp', 'gif']),
      title: s(confirm.title, 120), text: s(confirm.text, 400), sticker: s(confirm.sticker, 16),
      button: s(confirm.button, 30),
    },
    date: {
      enabled: date.enabled !== false,
      mode: date.mode === 'fixed' && /^\d{4}-\d{2}-\d{2}$/.test(date.fixedDate || '') ? 'fixed' : 'ask',
      fixedDate: /^\d{4}-\d{2}-\d{2}$/.test(date.fixedDate || '') ? date.fixedDate : '',
      fixedTime: /^\d{2}:\d{2}$/.test(date.fixedTime || '') ? date.fixedTime : '',
      chat: date.chat !== false,
      picture: ['sticker', 'photo', 'none'].includes(date.picture) ? date.picture : 'sticker',
      photo: uploaded(date.photo, ['jpg', 'png', 'webp', 'gif']),
      title: s(date.title, 120), text: s(date.text, 300), sticker: s(date.sticker, 16),
    },
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
// ---------- HTML: Метрика, плашка cookie, общий подвал ----------
const PUB = path.join(__dirname, 'public');
// номер версии пишет автообновление в .deployed-sha
function version() {
  try { return fs.readFileSync(path.join(__dirname, '.deployed-sha'), 'utf8').trim().slice(0, 7); } catch { return ''; }
}
function inject(html, tracking = true, opts = {}) {
  const st = S();
  const id = st.site.metrikaId;
  // window.goal(...) есть всегда; без счётчика — пустышка. Секретный ключ владельца (/m/…) в Метрику не уходит.
  const goalStub = `<script>window.dataLayer=window.dataLayer||[];window.goal=window.goal||function(){};</script>`;
  const metrika = id ? `<script>(function(){
var clean=function(u){return String(u||'').replace(new RegExp('/m/[A-Za-z0-9]+'),'/m/').replace(new RegExp('([?&]edit=)[^&#]*'),'$1x')};
window.dataLayer=window.dataLayer||[];
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:${opts.webvisor === false ? 'false' : 'true'},ecommerce:"dataLayer",url:clean(location.href),referrer:clean(document.referrer)});
window.goal=function(g,p){try{ym(${id},"reachGoal",g,p||{})}catch(e){}};
})();</script><noscript><div><img src="https://mc.yandex.ru/watch/${id}" style="position:absolute;left:-9999px" alt=""></div></noscript>` : goalStub;
  const cookie = `<script>(function(){try{if(localStorage.getItem('cookie-ok'))return}catch(e){}document.addEventListener('DOMContentLoaded',function(){var b=document.createElement('div');b.className='cookie';b.innerHTML='<span>Мы используем cookie${id ? ' и Яндекс Метрику' : ''}, чтобы сайт работал лучше. <a href="/privacy">Подробнее</a></span><button type="button">Понятно</button>';b.querySelector('button').onclick=function(){try{localStorage.setItem('cookie-ok','1')}catch(e){}b.remove()};document.body.appendChild(b)})})();</script>`;
  if (!tracking) return html.replace('</head>', goalStub + '</head>').replace('<!--FOOTER-->', pages.footer(version()));
  return html.replace('</head>', metrika + '</head>').replace('</body>', cookie + '</body>').replace('<!--FOOTER-->', pages.footer(version()));
}
function sendHtml(res, file, status = 200, noindex = false, tracking = true, opts = {}) {
  fs.readFile(path.join(PUB, file), 'utf8', (err, html) => {
    if (err) return res.status(500).end();
    if (noindex) { res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('Cache-Control', 'no-store'); }
    res.status(status).type('html').send(inject(html, tracking, opts));
  });
}
app.get(['/', '/index.html'], (req, res) => sendHtml(res, 'index.html'));
app.get(['/create', '/create.html'], (req, res) => sendHtml(res, 'create.html', 200, true, true, { webvisor: false }));
for (const pg of pages.PAGES) app.get(pg.path, (req, res) => res.type('html').send(inject(pages.render(pg, S(), version()))));
app.get('/version', (req, res) => res.type('text/plain').send(version() || 'неизвестна'));
app.get('/robots.txt', (req, res) => {
  const base = S().site.url || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nDisallow: /i/\nDisallow: /m/\nDisallow: /api/\nDisallow: /u/\nDisallow: /create?\n\nSitemap: ${base}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const base = S().site.url || `${req.protocol}://${req.get('host')}`;
  const urls = ['/', '/create', ...pages.PAGES.map((p) => p.path)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${pages.esc(base + u)}</loc></url>`).join('\n')}\n</urlset>\n`);
});

app.use('/u', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use(express.static(PUB, { index: false }));

const meta = () => ({
  price: S().price, pay: paymentMode() !== 'off', days: S().linkDays, bot: telegram.username() || null,
  receipt: paymentMode() === 'yookassa' && Boolean(S().yookassa.receipt),
  version: version() || null,
});
app.get('/api/meta', (req, res) => res.json(meta()));
app.get('/api/config', (req, res) => res.json({ price: S().price, paymentRequired: paymentMode() !== 'off' })); // для главной

// ---- загрузка фото ----
const KINDS = {
  image: { exts: ['jpg', 'png', 'webp', 'gif'], max: 7 * 1024 * 1024, label: 'Фото: подходят JPG, PNG, WebP или GIF' },
};
function sniff(buf) {
  if (buf.length < 12) return null;
  const at = (o, str) => buf.slice(o, o + str.length).toString('latin1') === str;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'GIF8')) return 'gif';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (at(0, 'OggS')) return 'ogg';
  if (at(4, 'ftyp')) return 'mp4';
  if (at(0, 'ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  return null;
}
app.post('/api/upload', rate('upload', 40, 3600e3), express.raw({ type: () => true, limit: '8mb' }), (req, res) => {
  const kind = req.query.kind || 'image';
  const k = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!k) return res.status(400).json({ error: 'Неизвестный тип файла' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Файл не получен' });
  if (buf.length > k.max) return res.status(413).json({ error: `Файл больше ${Math.round(k.max / 1048576)} МБ` });
  const ext = sniff(buf);
  if (!ext || !k.exts.includes(ext)) return res.status(400).json({ error: k.label });
  const file = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  res.json({ file, kind });
});

// ---- создание и правка (владелец) ----
const DAY = 86400e3;
function markPaid(inv) {
  inv.paid = true;
  inv.paidAt = new Date().toISOString();
  inv.expiresAt = new Date(Date.now() + S().linkDays * DAY).toISOString();
}
const expired = (inv) => Boolean(inv.expiresAt && Date.parse(inv.expiresAt) < Date.now());
function ownerView(inv) {
  return {
    slug: inv.slug, config: inv.config, paid: inv.paid, createdAt: inv.createdAt,
    expiresAt: inv.expiresAt || null, expired: expired(inv),
    payment: inv.payment ? { status: inv.payment.status } : null,
    telegram: telegram.username() ? { link: `https://t.me/${telegram.username()}?start=${inv.tgCode}`, linked: (inv.tgChats || []).length } : null,
    stats: inv.stats, answer: inv.answer, price: S().price,
  };
}
app.post('/api/inv', rate('create', 20, 3600e3), (req, res) => {
  const config = normalizeConfig((req.body || {}).config);
  if (!config.toName) return res.status(400).json({ error: 'Укажите, кого приглашаете' });
  const inv = {
    slug: newSlug(), token: newToken(), config,
    paid: false, createdAt: new Date().toISOString(),
    stats: { opens: 0, noClicks: 0 }, answer: null, tgCode: newTgCode(), tgChats: [],
  };
  if (paymentMode() === 'off') markPaid(inv);
  db[inv.slug] = inv; byToken.set(inv.token, inv); byTgCode.set(inv.tgCode, inv); save();
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
// ---- оплата ----
const baseUrl = (req) => S().site.url || `${req.protocol}://${req.get('host')}`;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

// проверяет платёж в ЮKassa и, если он прошёл, открывает ссылку; данным из уведомления не доверяем
async function syncPayment(inv) {
  if (inv.paid || !inv.payment || !inv.payment.id) return inv.payment && inv.payment.status;
  const p = await yookassa.getPayment(inv.payment.id);
  inv.payment.status = p.status;
  const good = p.status === 'succeeded' && p.paid && p.amount && p.amount.currency === 'RUB'
    && Number(p.amount.value) === Number(inv.payment.amount) && p.metadata && p.metadata.slug === inv.slug;
  if (good) markPaid(inv);
  save();
  return p.status;
}

app.post('/api/m/:token/pay', rate('pay', 30, 3600e3), async (req, res) => {
  const inv = owned(req, res); if (!inv) return;
  if (inv.paid) return res.json({ paid: true });
  const mode = paymentMode();
  if (mode === 'dev' || mode === 'off') { markPaid(inv); save(); return res.json({ paid: true, dev: true }); }
  if (mode !== 'yookassa') return res.status(501).json({ error: 'Оплата пока не подключена' });
  try {
    // незавершённый платёж моложе часа — продолжаем его, а не создаём новый
    if (inv.payment && inv.payment.status === 'pending' && inv.payment.url && Date.now() - Date.parse(inv.payment.createdAt) < 3600e3) {
      const st = await syncPayment(inv);
      if (inv.paid) return res.json({ paid: true });
      if (st === 'pending') return res.json({ confirmationUrl: inv.payment.url });
    }
    const email = String((req.body || {}).email || '').trim().slice(0, 254);
    if (S().yookassa.receipt && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Укажите почту — на неё придёт чек' });
    const amount = S().price;
    const p = await yookassa.createPayment({
      amount,
      description: `Ссылка на приглашение «Только да» (${inv.slug})`,
      returnUrl: `${baseUrl(req)}/m/${inv.token}?paid=1`,
      metadata: { slug: inv.slug },
      email,
    });
    const url = p.confirmation && p.confirmation.confirmation_url;
    if (!url) throw new Error('ЮKassa не вернула ссылку на оплату');
    inv.payment = { id: p.id, status: p.status, amount, url, createdAt: new Date().toISOString() };
    save();
    res.json({ confirmationUrl: url });
  } catch (e) {
    console.error('ЮKassa:', e.message);
    res.status(502).json({ error: 'Не удалось создать платёж. Попробуйте ещё раз через минуту.' });
  }
});

// страница владельца после возврата с оплаты спрашивает статус
app.get('/api/m/:token/pay', rate('paycheck', 240, 3600e3), async (req, res) => {
  const inv = owned(req, res); if (!inv) return;
  if (inv.paid || paymentMode() !== 'yookassa' || !inv.payment) return res.json({ paid: inv.paid, status: inv.payment ? inv.payment.status : null });
  try { const status = await syncPayment(inv); res.json({ paid: inv.paid, status }); }
  catch (e) { console.error('ЮKassa:', e.message); res.json({ paid: inv.paid, status: inv.payment.status }); }
});

// уведомления ЮKassa (адрес в личном кабинете: https://домен/api/yookassa; /api/yk/notify — адрес прежнего сайта)
app.post(['/api/yookassa', '/api/yk/notify'], express.json({ limit: '64kb' }), async (req, res) => {
  res.status(200).end();
  try {
    const o = obj(obj(req.body).object);
    const slug = obj(o.metadata).slug;
    const inv = typeof slug === 'string' ? db[slug] : null;
    if (inv && inv.payment && inv.payment.id === o.id) await syncPayment(inv);
  } catch (e) { console.error('ЮKassa уведомление:', e.message); }
});

// ---- получатель ----
app.get('/api/i/:slug', (req, res) => {
  const inv = db[req.params.slug];
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  if (!inv.paid) return res.status(402).json({ error: 'Приглашение ещё не активировано' });
  if (expired(inv)) return res.status(410).json({ error: 'Срок действия приглашения истёк' });
  res.json({ config: inv.config, answered: Boolean(inv.answer && (inv.answer.finishedAt || inv.answer.declinedAt)), declined: Boolean(inv.answer && inv.answer.declinedAt) });
});
app.post('/api/i/:slug/event', rate('event', 300, 3600e3), (req, res) => {
  const inv = db[req.params.slug];
  if (!inv || !inv.paid || expired(inv)) return res.status(404).end();
  const { type, data } = obj(req.body), d = obj(data);
  const a = inv.answer || (inv.answer = { choices: [] });
  switch (type) {
    case 'open':
      inv.stats.opens += 1;
      if (inv.stats.opens === 1) telegram.notify(inv, `💌 <b>${telegram.esc(inv.config.toName)}</b> открывает ваше приглашение`);
      break;
    case 'no': inv.stats.noClicks += 1; break;
    case 'yes': a.yesAt = a.yesAt || new Date().toISOString(); break;
    case 'date': a.date = d.chat ? { chat: true } : { date: s(d.date, 10), time: s(d.time, 5) }; break;
    case 'choices': {
      const i = Number(d.index);
      if (Number.isInteger(i) && i >= 0 && i < 3) {
        a.choices[i] = { title: s(d.title, 120), picks: arr(d.picks, 8).map((x) => s(x, 40)).filter(Boolean) };
      }
      break;
    }
    case 'decline':
      // отказ возможен только в режиме «Честный ответ» и только один раз
      if (inv.config.ask.noMode !== 'honest' || a.finishedAt || a.declinedAt) break;
      a.declinedAt = new Date().toISOString();
      telegram.notify(inv, `🙂 Ответ от <b>${telegram.esc(inv.config.toName)}</b>: честное «нет»`);
      break;
    case 'final':
      if (!a.finishedAt && !a.declinedAt) {
        a.finishedAt = new Date().toISOString();
        const lines = [`💖 <b>${telegram.esc(inv.config.toName)}</b> — «да»!`];
        if (a.date && a.date.chat) lines.push('🗓 Время обсудите в чате');
        else if (a.date && a.date.date) {
          const [y, m, dd] = a.date.date.split('-').map(Number);
          const when = new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
          lines.push(`🗓 ${telegram.esc(when)}${a.date.time ? ', ' + telegram.esc(a.date.time) : ''}`);
        }
        for (const c of a.choices || []) if (c) lines.push(`✨ ${telegram.esc((c.title || 'Выбор').replace(/[?:.!]+$/, ''))} — ${telegram.esc(c.picks.join(', '))}`);
        lines.push(`🙈 Попыток нажать «Нет»: ${inv.stats.noClicks}`);
        if (S().site.url) lines.push(`\n<a href="${telegram.esc(S().site.url)}/m/${inv.token}">Открыть приглашение</a>`);
        telegram.notify(inv, lines.join('\n'));
      }
      break;
    default: return res.status(400).end();
  }
  save();
  res.status(204).end();
});

// ---- страницы ----
// ---- админка ----
admin.routes(app, {
  status: () => ({ bot: telegram.username() || null, payment: paymentMode(), version: version() || null }),
  onSaved: (patch) => { if (patch.telegram) telegram.kick(); },
});

const page = (name) => (req, res) => sendHtml(res, name, 200, true, true, { webvisor: false });
// личное приглашение: без Метрики и без плашки cookie поверх экрана
app.get('/i/:slug', (req, res) => sendHtml(res, 'invite.html', 200, true, false));
app.get('/m/:token', page('owner.html'));

app.use((req, res) => sendHtml(res, '404.html', 404));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой файл' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Некорректные данные' });
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

telegram.start({ findByCode: (code) => byTgCode.get(code) || null, save });
app.listen(PORT, () => console.log(`«Только да» запущен: http://localhost:${PORT} (оплата: ${paymentMode()})`));
