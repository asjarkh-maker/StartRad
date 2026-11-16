// Telegram-бот: присылает владельцу приглашения уведомления об открытии и ответе.
// Работает через long polling (getUpdates), поэтому не нужен ни домен, ни вебхук.
// Токен берётся из data/settings.json (telegram.token) или TELEGRAM_BOT_TOKEN.
const crypto = require('crypto');
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

// ожидание, которое можно прервать: после сохранения настроек бот переподключается сразу
let wake = null;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(() => { wake = null; r(); }, ms); wake = () => { clearTimeout(t); wake = null; r(); }; });
function kick() { if (wake) wake(); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// адрес конструктора для мини-приложения; Telegram открывает только https
function createUrl() {
  const url = settings.load().site.url;
  return /^https:\/\//.test(url) ? `${url}/create` : '';
}
const createButton = () => (createUrl()
  ? { reply_markup: { inline_keyboard: [[{ text: '💌 Создать приглашение', web_app: { url: createUrl() } }]] } }
  : {});

async function setupMenu(tk) {
  const url = createUrl();
  const menu = url ? { type: 'web_app', text: 'Создать', web_app: { url } } : { type: 'default' };
  await call('setChatMenuButton', { menu_button: menu }, tk).catch((e) => console.error('Telegram: кнопка меню —', e.message));
}

// проверка данных мини-приложения (initData) по токену бота
function verifyInitData(initData, maxAgeSec = 86400) {
  const tk = token();
  if (!tk || typeof initData !== 'string' || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(tk).digest();
  const want = crypto.createHmac('sha256', secret).update(check).digest();
  const got = Buffer.from(hash, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date') || 0);
  if (!(age >= -60 && age <= maxAgeSec)) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && Number.isInteger(user.id) ? user : null;
  } catch { return null; }
}

// отправка файла (резервная копия)
async function sendDocument(chatId, filename, buffer, caption) {
  if (!me) throw new Error('бот не подключён');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
  form.append('document', new Blob([buffer], { type: 'application/zip' }), filename);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(`${API}/bot${activeToken}/sendDocument`, { method: 'POST', body: form, signal: ctrl.signal });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) { const e = new Error(d.description || `Telegram ${r.status}`); e.code = d.error_code || r.status; throw e; }
    return d.result;
  } finally { clearTimeout(t); }
}

// сообщение конкретному чату (например, после создания приглашения в мини-приложении)
async function sendTo(chatId, html, extra = {}) {
  if (!me) return false;
  try { await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); return true; }
  catch (e) { console.error('Telegram: не удалось отправить —', e.message); return false; }
}

async function handle(update) {
  const m = update.message;
  if (!m || !m.chat || typeof m.text !== 'string') return;
  const chatId = m.chat.id;
  const match = m.text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?/);
  if (!match) {
    await call('sendMessage', { chat_id: chatId, text: 'Я помогаю с приглашениями «Только да»: создайте приглашение кнопкой ниже — и я пришлю сюда, когда его откроют и ответят.', ...createButton() });
    return;
  }
  if (match[1] && match[1].startsWith('bk_')) {
    const okCode = hooks.onBackupCode ? hooks.onBackupCode(match[1].slice(3), chatId) : false;
    await call('sendMessage', { chat_id: chatId, text: okCode
      ? 'Готово! 🗂 Каждый день в 4:00 по Уфе буду присылать сюда резервную копию сайта: приглашения, ответы и фото. Храните этот чат — по архиву сайт восстанавливается за минуты.'
      : 'Код подключения устарел. Откройте админку и нажмите «Подключить» ещё раз.' });
    return;
  }
  const inv = match[1] ? hooks.findByCode(match[1]) : null;
  if (!inv) {
    await call('sendMessage', { chat_id: chatId, text: 'Привет! 💌 Здесь можно создать онлайн-приглашение на свидание, где ответ — только «да». Нажмите кнопку ниже — когда приглашение откроют и ответят, я напишу сюда.', ...createButton() });
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
        await setupMenu(tk);
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

module.exports = { start, notify, esc, kick, verifyInitData, sendTo, sendDocument, setupMenu: () => setupMenu(activeToken), username: () => (me ? me.username : '') };
