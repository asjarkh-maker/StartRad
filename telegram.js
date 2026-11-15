// Telegram-бот: присылает владельцу приглашения уведомления об открытии и ответе.
// Работает через long polling (getUpdates), поэтому не нужен ни домен, ни вебхук.
// Токен берётся из data/settings.json (telegram.token) или TELEGRAM_BOT_TOKEN.
const settings = require('./settings');

const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
let hooks = { findByCode: () => null, save: () => {} };
let me = null;          // { username } после getMe
let activeToken = '';
let offset = 0;
let running = false;

const token = () => settings.load().telegram.token || '';

async function call(method, body, tk = activeToken, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}/bot${tk}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) { const e = new Error(d.description || `Telegram ${r.status}`); e.code = d.error_code || r.status; throw e; }
    return d.result;
  } finally { clearTimeout(t); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function handle(update) {
  const m = update.message;
  if (!m || !m.chat || typeof m.text !== 'string') return;
  const chatId = m.chat.id;
  const match = m.text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?/);
  if (!match) {
    await call('sendMessage', { chat_id: chatId, text: 'Я присылаю ответы на приглашения «Только да». Чтобы подключить приглашение, нажмите кнопку «Получать ответ в Telegram» на его странице.' });
    return;
  }
  const inv = match[1] ? hooks.findByCode(match[1]) : null;
  if (!inv) {
    await call('sendMessage', { chat_id: chatId, text: 'Привет! Я присылаю ответы на приглашения «Только да». Откройте страницу своего приглашения и нажмите «Получать ответ в Telegram».' });
    return;
  }
  inv.tgChats = Array.isArray(inv.tgChats) ? inv.tgChats : [];
  if (!inv.tgChats.includes(chatId)) inv.tgChats = [...inv.tgChats, chatId].slice(-3);
  hooks.save();
  await call('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `Готово! Пришлю сюда, когда <b>${esc(inv.config.toName)}</b> откроет приглашение и ответит 💌`,
  });
}

async function loop() {
  running = true;
  for (;;) {
    const tk = token();
    if (!tk) { me = null; activeToken = ''; await sleep(30000); continue; }
    if (tk !== activeToken || !me) {
      try {
        activeToken = tk;
        me = await call('getMe', {}, tk);
        await call('deleteWebhook', {}, tk).catch(() => {});
        console.log(`Telegram-бот подключён: @${me.username}`);
      } catch (e) {
        me = null;
        console.error('Telegram: не удалось подключить бота —', e.message);
        await sleep(e.code === 401 ? 60000 : 10000);
        continue;
      }
    }
    try {
      const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, tk, 35000);
      for (const u of updates) {
        offset = u.update_id + 1;
        try { await handle(u); } catch (e) { console.error('Telegram: ошибка обработки —', e.message); }
      }
    } catch (e) {
      if (e.code === 401 || e.code === 404) { me = null; console.error('Telegram: токен не подходит'); await sleep(60000); }
      else if (e.code === 409) await sleep(5000); // запущен второй экземпляр бота
      else await sleep(5000);
    }
  }
}

async function notify(inv, html) {
  if (!me || !Array.isArray(inv.tgChats) || !inv.tgChats.length) return;
  for (const chatId of inv.tgChats.slice()) {
    try { await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }); }
    catch (e) {
      if (e.code === 403 || e.code === 400) { inv.tgChats = inv.tgChats.filter((c) => c !== chatId); hooks.save(); }
      else console.error('Telegram: не удалось отправить —', e.message);
    }
  }
}

function start(h) {
  hooks = { ...hooks, ...h };
  if (!running) loop().catch((e) => console.error('Telegram: остановлен —', e));
}

module.exports = { start, notify, esc, username: () => (me ? me.username : '') };
