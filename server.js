const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PRICE_RUB = Number(process.env.PRICE_RUB || 490);
// dev  — оплата подтверждается сразу (для разработки и проверки);
// off  — ссылка выдаётся бесплатно, без оплаты;
// любое другое значение — оплата должна прийти от платёжной системы (см. README).
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'dev';
const DATA_FILE = path.join(__dirname, 'data', 'invites.json');

// ---------- хранилище ----------
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = {}; }
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const newId = (n) => crypto.randomBytes(n).toString('base64url');

// ---------- валидация ----------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max, itemMax) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, itemMax)).filter(Boolean).slice(0, max);

function publicView(inv) {
  return {
    id: inv.id,
    fromName: inv.fromName,
    toName: inv.toName,
    message: inv.message,
    question: inv.question,
    dates: inv.dates,
    places: inv.places,
    theme: inv.theme,
    paid: inv.paid,
  };
}

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/config', (req, res) => {
  res.json({ price: PRICE_RUB, paymentRequired: PAYMENT_MODE !== 'off' });
});

// создать приглашение (бесплатно — собрать и посмотреть)
app.post('/api/invites', (req, res) => {
  const b = req.body || {};
  const inv = {
    id: newId(6),
    key: newId(12), // секретный ключ создателя: смотреть ответ
    fromName: str(b.fromName, 40),
    toName: str(b.toName, 40),
    message: str(b.message, 600),
    question: str(b.question, 120) || 'Пойдёшь со мной на свидание?',
    dates: list(b.dates, 6, 40),
    places: list(b.places, 6, 60),
    theme: ['pink', 'peach', 'night'].includes(b.theme) ? b.theme : 'pink',
    paid: PAYMENT_MODE === 'off',
    createdAt: new Date().toISOString(),
    opened: 0,
    noAttempts: 0,
    answer: null,
  };
  if (!inv.toName) return res.status(400).json({ error: 'Укажи, кого приглашаешь' });
  db[inv.id] = inv;
  save();
  res.json({ id: inv.id, key: inv.key });
});

// данные приглашения для страницы получателя
app.get('/api/invites/:id', (req, res) => {
  const inv = db[req.params.id];
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  const preview = req.query.key && req.query.key === inv.key;
  if (!inv.paid && !preview) return res.status(402).json({ error: 'Приглашение ещё не активировано' });
  if (!preview) { inv.opened += 1; save(); }
  res.json({ ...publicView(inv), preview, answered: Boolean(inv.answer) });
});

// попытки нажать «Нет» — для статистики создателю
app.post('/api/invites/:id/no', (req, res) => {
  const inv = db[req.params.id];
  if (!inv || !inv.paid) return res.status(404).end();
  inv.noAttempts += 1;
  save();
  res.status(204).end();
});

// ответ получателя
app.post('/api/invites/:id/answer', (req, res) => {
  const inv = db[req.params.id];
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  if (!inv.paid) return res.status(402).json({ error: 'Приглашение ещё не активировано' });
  const b = req.body || {};
  inv.answer = {
    yes: true,
    date: str(b.date, 60),
    place: str(b.place, 80),
    note: str(b.note, 300),
    at: new Date().toISOString(),
  };
  save();
  res.json({ ok: true });
});

// результат для создателя
app.get('/api/invites/:id/result', (req, res) => {
  const inv = db[req.params.id];
  if (!inv || req.query.key !== inv.key) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ...publicView(inv), opened: inv.opened, noAttempts: inv.noAttempts, answer: inv.answer, price: PRICE_RUB });
});

// оплата ссылки
app.post('/api/invites/:id/pay', (req, res) => {
  const inv = db[req.params.id];
  if (!inv || (req.body || {}).key !== inv.key) return res.status(404).json({ error: 'Не найдено' });
  if (inv.paid) return res.json({ paid: true });
  if (PAYMENT_MODE === 'dev') {
    inv.paid = true;
    save();
    return res.json({ paid: true, dev: true });
  }
  // Здесь подключается платёжная система (например, ЮKassa):
  // создать платёж на PRICE_RUB, вернуть confirmation_url, а paid = true
  // выставлять в обработчике уведомления (webhook) от платёжной системы.
  res.status(501).json({ error: 'Оплата пока не подключена' });
});

// короткие ссылки
app.get('/i/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invite.html')));
app.get('/r/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'result.html')));

app.listen(PORT, () => {
  console.log(`«Только да» запущен: http://localhost:${PORT} (оплата: ${PAYMENT_MODE})`);
});
