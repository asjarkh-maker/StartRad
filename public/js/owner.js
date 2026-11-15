// Страница владельца: ссылка для отправки, статистика, ответ, правка.
(function () {
  'use strict';
  const token = location.pathname.split('/').pop();
  const params = new URLSearchParams(location.search);
  const root = document.getElementById('own');
  let timer = 0;

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

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch (e2) { /* нет доступа */ } t.remove(); }
    const old = btn.textContent; btn.textContent = 'Скопировано ✓';
    setTimeout(() => { btn.textContent = old; }, 1800);
  }
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');

  function render(d) {
    const link = `${location.origin}/i/${d.slug}`;
    const a = d.answer, answered = Boolean(a && a.finishedAt);
    root.innerHTML = '';
    if (params.get('new')) root.append(h('div', { class: 'banner', text: 'Приглашение создано! Сохраните эту страницу в закладки — здесь появится ответ.' }));
    if (params.get('saved')) root.append(h('div', { class: 'banner', text: 'Изменения сохранены. Ссылка осталась прежней.' }));
    root.append(h('h1', { text: `Приглашение для ${d.config.toName}` }));

    // 1. превью
    const prev = h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '1' }), 'Посмотрите, как это увидят'),
      h('div', { class: 'own-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Открыть превью ▶', on: { click: openPreview } }),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/create?edit=${token}`, text: '✏️ Изменить' })));
    root.append(prev);

    // 2. ссылка / оплата
    if (!d.paid) {
      const err = h('div', { class: 'error' });
      const pay = h('button', { class: 'btn', type: 'button', text: `Получить ссылку — ${d.price} ₽` });
      pay.addEventListener('click', async () => {
        pay.disabled = true; err.textContent = '';
        try {
          const r = await fetch(`/api/m/${token}/pay`, { method: 'POST' });
          const j = await r.json().catch(() => ({}));
          if (j.confirmationUrl) { location.href = j.confirmationUrl; return; }
          if (!r.ok) throw new Error(j.error || 'Ошибка оплаты');
          load();
        } catch (e) { err.textContent = e.message; pay.disabled = false; }
      });
      root.append(h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '2' }), 'Получите ссылку для отправки'),
        h('p', { style: 'color:var(--muted);margin:0 0 16px', text: 'Ссылка работает, пока вы её не удалите. Отправьте её в любой мессенджер.' }), pay, err));
      return;
    }
    const input = h('input', { class: 'inp', readonly: true, value: link, 'aria-label': 'Ссылка для отправки' });
    const copyBtn = h('button', { class: 'btn btn-sm', type: 'button', text: 'Скопировать' });
    copyBtn.addEventListener('click', () => copy(link, copyBtn));
    root.append(h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '2' }), 'Отправьте ссылку'),
      h('div', { class: 'linkbox' }, input, copyBtn),
      h('p', { class: 'f-h', text: 'Сами ссылку не открывайте — просмотр засчитается как открытие. Для проверки есть превью.' })));

    // 3. ответ
    const box = h('div', { class: 'card' }, h('div', { class: 'step-title' }, h('span', { class: 'step-num', text: '3' }), 'Ответ'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: d.stats.opens }), h('span', { text: 'открытий' })),
        h('div', { class: 'stat' }, h('b', { text: d.stats.noClicks }), h('span', { text: 'попыток нажать «Нет»' })),
        h('div', { class: 'stat' }, h('b', { text: answered ? 'Да! 💖' : a && a.yesAt ? 'Отвечает…' : d.stats.opens ? 'Читает…' : 'Ждём' }), h('span', { text: 'статус' }))));
    if (a && a.yesAt) {
      const rows = [];
      if (a.date && a.date.date) rows.push(['Когда', Player.prettyDate(a.date.date, a.date.time)]);
      (a.choices || []).forEach((c) => { if (c) rows.push([c.title || 'Выбор', c.picks.join(', ')]); });
      box.append(h('div', { class: 'answer-box' }, h('h3', { text: `${d.config.toName} сказал(а) «да» 💖` }),
        rows.map(([k, v]) => h('p', {}, h('b', { text: k + ': ' }), v)),
        h('p', { class: 'f-h', text: fmtTime(a.finishedAt || a.yesAt) })));
    }
    root.append(box);
    clearTimeout(timer);
    if (!answered) timer = setTimeout(load, 10000);
  }

  function openPreview() {
    const wrap = h('div', { class: 'ed-preview open', style: 'display:flex' },
      h('button', { class: 'ed-close', style: 'display:block', type: 'button', text: '×', 'aria-label': 'Закрыть' }),
      h('div', { class: 'pv-phone' }, h('div', { class: 'pv-notch' }), h('div', { class: 'pv-screen', id: 'pv' })));
    wrap.querySelector('.ed-close').addEventListener('click', () => wrap.remove());
    document.body.append(wrap);
    Player.mount(wrap.querySelector('#pv'), window.__cfg, { mode: 'preview' });
  }

  async function load() {
    try {
      const r = await fetch(`/api/m/${encodeURIComponent(token)}`);
      if (!r.ok) { root.innerHTML = ''; root.append(h('h1', { text: 'Приглашение не найдено' }), h('p', { text: 'Проверьте ссылку — возможно, она скопирована не целиком.' })); return; }
      const d = await r.json();
      window.__cfg = d.config;
      render(d);
    } catch (e) { timer = setTimeout(load, 8000); }
  }
  load();
})();
