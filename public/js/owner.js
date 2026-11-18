// Страница владельца: ссылка для отправки, статистика, ответ, правка.
(function () {
  'use strict';
  const token = location.pathname.split('/').pop();
  const params = new URLSearchParams(location.search);
  const root = document.getElementById('own');
  let timer = 0, checks = 0, meta = { receipt: false, days: 30 };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  const goal = (g, p) => { try { window.goal && window.goal(g, p); } catch (e) { /* без Метрики */ } };
  // цель — один раз на приглашение в этом браузере
  function goalOnce(g, slug, p) {
    const k = `tolkoda:goal:${g}:${slug}`;
    try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) { /* приватный режим */ }
    goal(g, p);
  }
  // «Мои приглашения»: запоминаем в этом браузере, чтобы не потерять ссылку владельца
  function remember(d) {
    try {
      const list = JSON.parse(localStorage.getItem('tolkoda:mine') || '[]').filter((x) => x.token !== token);
      list.unshift({ token, toName: d.config.toName, t: Date.now() });
      localStorage.setItem('tolkoda:mine', JSON.stringify(list.slice(0, 20)));
    } catch (e) { /* приватный режим */ }
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (e2) { /* нет доступа */ } t.remove(); }
    const old = btn.textContent; btn.textContent = 'Скопировано ✓';
    setTimeout(() => { btn.textContent = old; }, 1800);
  }
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');

  function render(d) {
    const link = `${location.origin}/i/${d.slug}`;
    const a = d.answer, declined = Boolean(a && a.declinedAt), answered = Boolean(a && (a.finishedAt || a.declinedAt));
    root.innerHTML = '';
    if (d.paid && d.payment && d.payment.status === 'succeeded') {
      // оплата прошла: цель и электронная коммерция (один раз)
      try {
        const k = `tolkoda:goal:paid:${d.slug}`;
        if (!localStorage.getItem(k)) {
          localStorage.setItem(k, '1');
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ ecommerce: { currencyCode: 'RUB', purchase: { actionField: { id: d.slug, revenue: d.price },
            products: [{ id: 'invite-link', name: 'Ссылка на приглашение', price: d.price, quantity: 1 }] } } });
          goal('paid', { order_price: d.price, currency: 'RUB' });
        }
      } catch (e) { /* приватный режим */ }
    }
    if (params.get('paid') && d.paid) root.append(h('div', { class: 'banner', text: 'Оплата прошла — ссылка готова 💌' }));
    if (params.get('new')) root.append(h('div', { class: 'banner', text: 'Приглашение создано! Сохраните эту страницу в закладки — здесь появится ответ.' }));
    if (params.get('saved')) root.append(h('div', { class: 'banner', text: 'Изменения сохранены. Ссылка осталась прежней.' }));
    root.append(h('h1', { text: `Приглашение · ${d.config.toName}` }));

    // 1. превью
    const prev = h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '1' }), 'Посмотрите, как это увидят'),
      h('div', { class: 'own-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Открыть превью ▶', on: { click: openPreview } }),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/create?edit=${token}`, text: '✏️ Изменить' })));
    root.append(prev);

    // 2. ссылка / оплата
    if (!d.paid) {
      const err = h('div', { class: 'error' });
      const checking = Boolean(params.get('paid')) && d.payment && d.payment.status === 'pending' && checks < 20;
      if (d.payment && d.payment.status === 'canceled') err.textContent = 'Оплата не прошла. Можно попробовать ещё раз.';
      // поле почты показываем, только если ЮKassa сама не смогла её спросить
      const email = h('input', { class: 'inp', type: 'email', placeholder: 'Почта для чека', autocomplete: 'email', style: 'margin-bottom:12px', hidden: true });
      const pay = h('button', { class: 'btn', type: 'button', text: checking ? 'Проверяем оплату…' : `Получить ссылку — ${d.price} ₽`, disabled: checking });
      goalOnce('checkout_view', d.slug);
      pay.addEventListener('click', async () => {
        goal('pay_click');
        pay.disabled = true; err.textContent = '';
        try {
          const r = await fetch(`/api/m/${token}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.hidden ? '' : email.value.trim() }) });
          const j = await r.json().catch(() => ({}));
          if (j.confirmationUrl) { location.href = j.confirmationUrl; return; }
          if (j.needEmail) { email.hidden = false; email.focus(); }
          if (!r.ok) throw new Error(j.error || 'Ошибка оплаты');
          load();
        } catch (e) { err.textContent = e.message; pay.disabled = false; }
      });
      root.append(h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '2' }), 'Получите ссылку для отправки'),
        h('p', { style: 'color:var(--muted);margin:0 0 16px', text: `Ссылка будет работать ${meta.days || 30} дней. Отправьте её в любой мессенджер.` }),
        meta.bot ? h('div', { class: 'bot-note' }, h('span', { class: 'bot-note-e', text: '🤖', 'aria-hidden': 'true' }),
          h('span', {}, h('b', { text: 'Сразу после оплаты подключите бота — ' }),
            (d.telegram && d.telegram.linked) ? `он уже подключён и пришлёт ответ в Telegram: дату, время и выбор.` : `до отправки ссылки, кнопка появится здесь. Бот @${meta.bot} сообщит, когда приглашение откроют, и пришлёт ответ: дату, время и выбор.`)) : null,
        email, pay,
        h('p', { class: 'coffee', text: 'Сюрприз по цене чашки кофе ☕️' }),
        err,
        h('p', { class: 'f-h' }, 'Нажимая кнопку, вы принимаете ', h('a', { href: '/oferta', target: '_blank', text: 'оферту' }), ' и ',
          h('a', { href: '/privacy', target: '_blank', text: 'политику конфиденциальности' }), '.')));
      if (checking) { checks++; clearTimeout(timer); timer = setTimeout(checkPayment, 3000); }
      return;
    }
    // 2. сначала Telegram — тогда бот сообщит и об открытии ссылки
    let n = 2;
    if (d.telegram) {
      const linked = d.telegram.linked;
      root.append(h('div', { class: 'card' + (linked ? '' : ' card-accent') }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: String(n) }), linked ? 'Ответ придёт в Telegram' : 'Подключите Telegram — до отправки ссылки'),
        linked
          ? h('p', { style: 'margin:0', text: '✅ Бот подключён: напишет, когда приглашение откроют, и пришлёт ответ — дату, время и выбор.' })
          : [h('p', { style: 'color:var(--muted);margin:0 0 14px', text: 'Займёт 10 секунд: откроется бот — нажмите «Запустить». Тогда вы узнаете, когда приглашение откроют, и сразу получите ответ.' }),
            h('a', { class: 'btn btn-sm', href: d.telegram.link, target: '_blank', rel: 'noopener', text: '🤖 Получать ответ в Telegram' })]));
      n++;
    }
    const input = h('input', { class: 'inp', readonly: true, value: link, 'aria-label': 'Ссылка для отправки' });
    const copyBtn = h('button', { class: 'btn btn-sm', type: 'button', text: 'Скопировать' });
    copyBtn.addEventListener('click', () => { copy(link, copyBtn); goal('link_share'); });
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Тебе письмо 💌')}`;
    const shareBtn = h('a', { class: 'btn btn-ghost btn-sm', href: shareUrl, target: '_blank', rel: 'noopener', text: '✈️ Отправить в Telegram' });
    shareBtn.addEventListener('click', (e) => { goal('link_share'); if (window.TG && window.TG.inside) { e.preventDefault(); window.TG.openTg(shareUrl); } });
    if (d.stats.opens || a) root.append(h('div', { class: 'card card-accent' },
      h('p', { style: 'margin:0', html: false, text: `👀 Ссылку уже открывали${a && a.yesAt ? ' и ответили' : ''}. Если это были вы (проверяли) — сбросьте ответ перед отправкой, иначе ${d.config.toName} увидит «ответ уже отправлен».` }),
      resetBtn()));
    root.append(h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: String(n++) }), 'Отправьте ссылку'),
      h('div', { class: 'linkbox' }, input, copyBtn),
      h('div', { class: 'own-actions' }, shareBtn),
      d.expiresAt ? h('p', { class: d.expired ? 'error' : 'f-h', text: d.expired ? `Срок действия ссылки истёк ${fmtTime(d.expiresAt)}. Получатель её больше не откроет.` : `Ссылка работает до ${fmtTime(d.expiresAt)}.` }) : null,
      h('p', { class: 'f-h', text: 'Сами ссылку не открывайте — просмотр засчитается как открытие. Для проверки есть превью.' })));

    // 3. ответ
    const box = h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: String(n) }), 'Ответ'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: d.stats.opens }), h('span', { text: 'открытий' })),
        h('div', { class: 'stat' }, h('b', { text: d.stats.noClicks }), h('span', { text: 'попыток нажать «Нет»' })),
        h('div', { class: 'stat' }, h('b', { text: declined ? 'Нет' : answered ? 'Да! 💖' : a && a.yesAt ? 'Отвечает…' : d.stats.opens ? 'Читает…' : 'Ждём' }), h('span', { text: 'статус' }))));
    if (declined) {
      box.append(h('div', { class: 'answer-box' }, h('h3', { text: `Ответ от ${d.config.toName}: честное «нет»` }),
        h('p', { text: 'Не расстраивайтесь — честный ответ лучше неопределённости.' }),
        h('p', { class: 'f-h', text: fmtTime(a.declinedAt) })));
    } else if (a && a.yesAt) {
      const rows = [];
      if (a.date && a.date.chat) rows.push(['Когда', 'решите в чате 💬']);
      else if (a.date && a.date.date) rows.push(['Когда', Player.prettyDate(a.date.date, a.date.time)]);
      (a.choices || []).forEach((c) => { if (c) rows.push([(c.title || 'Выбор').replace(/[?:.!]+$/, ''), c.picks.join(', ')]); });
      box.append(h('div', { class: 'answer-box' }, h('h3', { text: `${d.config.toName} — «да»! 💖` }),
        rows.map(([k, v]) => h('p', {}, h('b', { text: k + ': ' }), v)),
        h('p', { class: 'f-h', text: fmtTime(a.finishedAt || a.yesAt) })));
    }
    if (d.stats.opens || a) box.append(resetBtn(), h('p', { class: 'f-h', text: 'Проверяли приглашение сами? Сбросьте ответ перед отправкой — иначе получатель увидит «ответ уже отправлен».' }));
    root.append(box);
    clearTimeout(timer);
    if (!answered) timer = setTimeout(load, 10000);
  }

  function resetBtn() {
    const rb = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '🔄 Сбросить ответ', style: 'margin-top:14px' });
    rb.addEventListener('click', async () => {
      if (!confirm('Сбросить ответ и счётчики? Пригодится, если вы проходили приглашение сами. Получатель сможет ответить заново, бот снова пришлёт уведомления.')) return;
      rb.disabled = true;
      const r = await fetch(`/api/m/${token}/reset`, { method: 'POST' });
      if (r.ok) load(); else { rb.disabled = false; alert('Не получилось, попробуйте ещё раз'); }
    });
    return rb;
  }

  function openPreview() {
    const wrap = h('div', { class: 'ed-preview open', style: 'display:flex' },
      h('button', { class: 'ed-close', style: 'display:block', type: 'button', text: '×', 'aria-label': 'Закрыть' }),
      h('div', { class: 'pv-phone' }, h('div', { class: 'pv-notch' }), h('div', { class: 'pv-screen', id: 'pv' })));
    wrap.querySelector('.ed-close').addEventListener('click', () => wrap.remove());
    document.body.append(wrap);
    Player.mount(wrap.querySelector('#pv'), window.__cfg, { mode: 'preview' });
  }

  // после возврата с оплаты: спросить сервер, прошёл ли платёж
  async function checkPayment() {
    try { await fetch(`/api/m/${encodeURIComponent(token)}/pay`); } catch (e) { /* повторим */ }
    load();
  }

  async function load() {
    try {
      const r = await fetch(`/api/m/${encodeURIComponent(token)}`);
      if (!r.ok) { root.innerHTML = ''; root.append(h('h1', { text: 'Приглашение не найдено' }), h('p', { text: 'Проверьте ссылку — возможно, она скопирована не целиком.' })); return; }
      const d = await r.json();
      window.__cfg = d.config;
      remember(d);
      render(d);
    } catch (e) { timer = setTimeout(load, 8000); }
  }
  fetch('/api/meta').then((r) => r.json()).then((m) => { meta = m; }).catch(() => {}).finally(() => {
    if (params.get('paid')) checkPayment(); else load();
  });
})();
