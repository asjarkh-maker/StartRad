// ЮKassa: создание платежа и проверка его статуса через API.
// Ключи — в data/settings.json (yookassa.shopId, yookassa.secretKey) или в переменных окружения.
const crypto = require('crypto');
const settings = require('./settings');

const API = (process.env.YOOKASSA_API || 'https://api.yookassa.ru/v3').replace(/\/+$/, '');

function auth() {
  const y = settings.load().yookassa;
  return 'Basic ' + Buffer.from(`${y.shopId}:${y.secretKey}`).toString('base64');
}

async function request(method, path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const headers = { authorization: auth(), 'content-type': 'application/json' };
    if (method === 'POST') headers['idempotence-key'] = crypto.randomUUID();
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.description || `ЮKassa ответила ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return d;
  } finally { clearTimeout(t); }
}

const money = (n) => Number(n).toFixed(2);

async function createPayment({ amount, description, returnUrl, metadata, email }) {
  const y = settings.load().yookassa;
  const body = {
    amount: { value: money(amount), currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: returnUrl },
    description: description.slice(0, 128),
    metadata,
  };
  if (y.receipt) {
    // без почты ЮKassa сама спросит её на странице оплаты
    body.receipt = {
      ...(email ? { customer: { email } } : {}),
      items: [{
        description: description.slice(0, 128),
        quantity: '1.00',
        amount: { value: money(amount), currency: 'RUB' },
        vat_code: Number(y.vatCode) || 1,
        payment_mode: y.paymentMode || 'full_payment',
        payment_subject: y.paymentSubject || 'service',
      }],
    };
  }
  return request('POST', '/payments', body);
}

const getPayment = (id) => request('GET', `/payments/${encodeURIComponent(id)}`);

module.exports = { createPayment, getPayment, money };
