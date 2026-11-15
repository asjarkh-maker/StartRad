// Настройки сайта: data/settings.json (на сервере, не в git). Пример — settings.example.json.
// Файл перечитывается автоматически, если его изменить; перезапуск не нужен.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'settings.json');

const DEFAULTS = {
  site: {
    name: 'Только да',
    url: '',            // https://onlyda.ru — для ссылок в письмах, боте и sitemap
    email: '',
    phone: '',
    telegram: '',       // @username поддержки
    metrikaId: '',      // номер счётчика Яндекс Метрики
  },
  seller: {
    status: '',         // «самозанятый» или «ИП»
    name: '',           // ФИО полностью
    inn: '',
    ogrnip: '',         // для ИП
    address: '',        // для ИП — адрес регистрации
  },
  price: 490,
  linkDays: 30,
  telegram: { token: '' },
  yookassa: {
    shopId: '',
    secretKey: '',
    receipt: false,     // отправлять чек (54-ФЗ) через ЮKassa
    vatCode: 1,         // 1 — без НДС
    paymentSubject: 'service',
    paymentMode: 'full_payment',
  },
};

let cache = null;
let mtime = 0;

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  let st = null;
  try { st = fs.statSync(FILE); } catch { /* нет файла */ }
  const m = st ? st.mtimeMs : -1;
  if (cache && m === mtime) return cache;
  let user = {};
  if (st) {
    try { user = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')); }
    catch (e) { console.error('Ошибка в data/settings.json:', e.message); user = {}; }
  }
  const s = merge(DEFAULTS, user);
  // переменные окружения важнее файла
  const env = process.env;
  if (env.PRICE_RUB) s.price = Number(env.PRICE_RUB);
  if (env.TELEGRAM_BOT_TOKEN) s.telegram.token = env.TELEGRAM_BOT_TOKEN;
  if (env.YOOKASSA_SHOP_ID) s.yookassa.shopId = env.YOOKASSA_SHOP_ID;
  if (env.YOOKASSA_SECRET_KEY) s.yookassa.secretKey = env.YOOKASSA_SECRET_KEY;
  if (env.SITE_URL) s.site.url = env.SITE_URL;
  s.price = Number(s.price) > 0 ? Math.round(Number(s.price)) : 490;
  s.linkDays = Number(s.linkDays) > 0 ? Math.round(Number(s.linkDays)) : 30;
  s.site.url = String(s.site.url || '').replace(/\/+$/, '');
  s.site.metrikaId = String(s.site.metrikaId || '').replace(/\D/g, '');
  cache = s; mtime = m;
  return s;
}

module.exports = { load, FILE };
