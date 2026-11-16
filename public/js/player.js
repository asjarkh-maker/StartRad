// Плеер приглашения: конверт → вопрос → подтверждение → дата → выбор → финал.
// Один и тот же код показывает превью в редакторе и настоящее приглашение.
(function () {
  'use strict';

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

  const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.3 2.9 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.7 0 5.8 3.8 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>';
  const DEFAULT_NO = ['Нет', 'Точно?', 'Подумай ещё', 'Не-а 🙈', 'Не поймаешь', 'Ну пожалуйста'];
  const KISS_LINES = ['Нет', 'Ну пожалуйста 🥺', 'Подумай ещё разок 💋', 'А если с мороженым? 🍦', 'Я буду очень ждать 💞', 'Ну скажи «да» 😚'];
  const NO_MODES = ['run', 'shrink', 'kiss', 'turn', 'honest'];

  // ---------- анимированные стикеры (Noto Animated Emoji, CC BY 4.0) ----------
  const stCode = (e) => Array.from(e).map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16)).join('_');
  let stList = null;
  const stData = new Map();
  function stickerList() {
    if (!stList) stList = fetch('/st/list.json').then((r) => (r.ok ? r.json() : [])).then((l) => new Set(l)).catch(() => new Set());
    return stList;
  }
  function stickerData(code) {
    if (!stData.has(code)) stData.set(code, fetch(`/st/${code}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return stData.get(code);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function prettyDate(date, time) {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return '';
    const txt = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return time ? `${txt}, ${time}` : txt;
  }
  function screensOf(cfg) {
    const list = ['gate', 'ask'];
    if (!cfg.confirm || cfg.confirm.enabled !== false) list.push('confirm');
    if (cfg.date && cfg.date.enabled) list.push('date');
    (cfg.choices || []).forEach((_, i) => list.push('choice' + i));
    list.push('final');
    return list;
  }

  function mount(root, cfg, opts = {}) {
    const live = opts.mode === 'live';
    const emit = opts.onEvent || (() => {});
    const order = screensOf(cfg);
    const answers = { noClicks: 0, date: null, picks: [] };
    const seed = () => { answers.noClicks = 0; answers.date = opts.demo ? opts.demo.date || null : null; answers.picks = opts.demo ? (opts.demo.picks || []).slice() : []; };
    seed();
    let cur = -1, timers = [];

    root.innerHTML = '';
    root.classList.add('pl');
    if (live) root.classList.add('pl-live');
    root.dataset.theme = cfg.theme || 'pink';
    const bg = h('div', { class: 'pl-bg', 'aria-hidden': 'true' });
    for (let i = 0; i < 9; i++) {
      bg.append(h('span', { text: '♥', style: `left:${(i * 37 + 8) % 92}%;top:${(i * 53 + 6) % 90}%;font-size:${14 + (i % 4) * 6}px;animation-delay:${(i % 5) * 0.8}s` }));
    }
    const stage = h('div', { class: 'pl-stage' });
    root.append(bg, stage);

    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const anims = [];
    function sticker(e, cls = '') {
      if (!e) return null;
      const el = h('div', { class: 'pl-sticker ' + cls, text: e, 'aria-hidden': 'true' });
      if (window.lottie) {
        const code = stCode(e);
        stickerList().then((set) => (set.has(code) ? stickerData(code) : null)).then((data) => {
          if (!data || !el.isConnected) return;
          el.textContent = '';
          el.classList.add('anim');
          anims.push(window.lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: true, animationData: JSON.parse(JSON.stringify(data)) }));
        });
      }
      return el;
    }
    const stopAnims = () => { while (anims.length) { try { anims.pop().destroy(); } catch (e) { /* уже удалена */ } } };
    const photo = () => (cfg.photo ? h('img', { class: 'pl-photo', src: `/u/${cfg.photo}`, alt: '' }) : null);
    const names = () => cfg.toName || '';
    const fill = (t) => String(t || '')
      .replace(/\{имя\}|\{name\}/gi, names())
      .replace(/\{дата\}|\{date\}/gi, answers.date ? (answers.date.chat ? 'обсудим в чате' : prettyDate(answers.date.date, answers.date.time)) : '')
      .replace(/\{выбор\}|\{choice\}/gi, answers.picks.flat().filter(Boolean).join(', '));

    function show(id) {
      cur = order.indexOf(id);
      stopAnims();
      stage.innerHTML = '';
      stage.scrollTop = 0;
      const el = ({ gate, ask, confirm, date, final })[id] ? ({ gate, ask, confirm, date, final })[id]() : choice(Number(id.slice(6)));
      stage.append(el);
    }
    const next = () => { if (cur < order.length - 1) show(order[cur + 1]); };

    // ----- экраны -----
    function gate() {
      const g = cfg.gate || {};
      const wrap = h('div', { class: 'pl-screen pl-center' });
      if (g.type === 'button') {
        wrap.append(sticker('💌', 'big'), h('h2', { class: 'pl-title', text: fill(g.text) || `${names()}, тебе письмо` }),
          h('button', { class: 'pl-btn', type: 'button', text: 'Открыть', on: { click: () => { emit('open'); next(); } } }));
        return wrap;
      }
      const env = h('div', { class: 'pl-env', role: 'button', tabindex: '0', 'aria-label': 'Открыть конверт' },
        h('div', { class: 'pl-env-body' }), h('div', { class: 'pl-env-flap' }), h('div', { class: 'pl-env-seal', html: HEART }));
      const go = () => {
        if (env.classList.contains('open')) return;
        env.classList.add('open'); emit('open');
        later(next, 800);
      };
      env.addEventListener('click', go);
      env.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      wrap.append(env, h('p', { class: 'pl-hint', text: fill(g.text) || `${names()}, тебе письмо. Нажми на конверт 💌` }));
      return wrap;
    }

    function ask() {
      const a = cfg.ask || {};
      const wrap = h('div', { class: 'pl-screen pl-center' });
      const yes = h('button', { class: 'pl-btn pl-yes', type: 'button', text: a.yes || 'Да 💖' });
      const no = h('button', { class: 'pl-btn pl-no', type: 'button', text: (a.noLines && a.noLines[0]) || DEFAULT_NO[0] });
      const actions = h('div', { class: 'pl-actions' }, yes, no);
      wrap.append(...[photo(), cfg.photo ? null : sticker(a.sticker),
        h('h2', { class: 'pl-title', text: fill(a.title) }),
        a.text ? h('p', { class: 'pl-text', text: fill(a.text) }) : null, actions].filter(Boolean));

      const mode = NO_MODES.includes(a.noMode) ? a.noMode : 'run';
      const own = a.noLines && a.noLines.length ? a.noLines : null;
      const lines = own || (mode === 'kiss' ? KISS_LINES : DEFAULT_NO);
      let tries = 0, scale = 1, said = false, turned = false, sure = false;
      const countNo = () => { tries++; answers.noClicks++; emit('no', { n: answers.noClicks }); };
      const grow = (max = 1.4, step = 0.06) => { scale = Math.min(1 + tries * step, max); yes.style.transform = `scale(${scale})`; };
      function sayYes() {
        if (said) return; said = true;
        emit('yes', { no: answers.noClicks });
        playYes(yes, next);
      }

      function dodge(e) {
        if (e && e.cancelable) e.preventDefault();
        countNo();
        no.textContent = lines[tries % lines.length];
        grow();
        const sr = stage.getBoundingClientRect();
        if (!no.classList.contains('away')) {
          const r = no.getBoundingClientRect();
          no.style.left = r.left - sr.left + 'px'; no.style.top = r.top - sr.top + 'px';
          no.classList.add('away'); stage.append(no);
        }
        const pad = 10, gap = 22, w = no.offsetWidth, hgt = no.offsetHeight;
        const yr = yes.getBoundingClientRect();
        const cx = yr.left - sr.left + yr.width / 2, cy = yr.top - sr.top + yr.height / 2;
        const hw = yes.offsetWidth * scale / 2 + gap, hh = yes.offsetHeight * scale / 2 + gap;
        const maxX = Math.max(pad, sr.width - w - pad), maxY = Math.max(pad, sr.height - hgt - pad);
        const cur_ = { x: parseFloat(no.style.left) || 0, y: parseFloat(no.style.top) || 0 };
        // не закрываем заголовок, текст, фото и стикер — если на экране хватает места
        const solid = [...stage.querySelectorAll('.pl-title, .pl-text, .pl-photo, .pl-sticker')].map((e) => {
          const r = e.getBoundingClientRect();
          return { l: r.left - sr.left - 6, r: r.right - sr.left + 6, t: r.top - sr.top - 6, b: r.bottom - sr.top + 6 };
        });
        const hitsYes = (x, y) => x < cx + hw && x + w > cx - hw && y < cy + hh && y + hgt > cy - hh;
        const hitsText = (x, y) => solid.some((o) => x < o.r && x + w > o.l && y < o.b && y + hgt > o.t);
        let best = null, bestD = -1;
        for (const strict of [true, false]) {
          for (let i = 0; i < 250; i++) {
            const x = pad + Math.random() * (maxX - pad), y = pad + Math.random() * (maxY - pad);
            if (hitsYes(x, y) || (strict && hitsText(x, y))) continue;
            const d = Math.hypot(x - cur_.x, y - cur_.y);
            if (d > bestD) { best = { x, y }; bestD = d; }
            if (d > 120) break;
          }
          if (best) break;
        }
        if (!best) {
          best = [[pad, pad], [maxX, pad], [pad, maxY], [maxX, maxY]]
            .map(([x, y]) => ({ x, y, d: Math.hypot(x + w / 2 - cx, y + hgt / 2 - cy) })).sort((p, q) => q.d - p.d)[0];
        }
        no.style.left = best.x + 'px'; no.style.top = best.y + 'px';
      }

      // «Нет» уменьшается, «Да» растёт
      function shrink(e) {
        if (e && e.cancelable) e.preventDefault();
        countNo(); grow(1.6, 0.12);
        const k = Math.max(0, 1 - tries * 0.2);
        no.style.transform = `scale(${k})`;
        if (k <= 0.05) { no.style.visibility = 'hidden'; no.disabled = true; }
      }
      // уговаривает: поцелуи и «ну пожалуйста»
      function kiss(e) {
        if (e && e.cancelable) e.preventDefault();
        countNo(); grow();
        no.textContent = lines[tries % lines.length];
        no.classList.remove('pl-shake'); void no.offsetWidth; no.classList.add('pl-shake');
        particles(no, ['💋', '😘', '💕'], 9, 'pl-float-up');
      }
      // с первого нажатия превращается в «Да»
      function turn(e) {
        if (e && e.cancelable) e.preventDefault();
        if (turned) { sayYes(); return; }
        countNo(); turned = true;
        no.classList.add('pl-flip');
        later(() => { no.textContent = a.yes || 'Да 💖'; no.classList.remove('pl-no'); no.classList.add('pl-yes'); }, 200);
      }
      // честный ответ: можно отказаться, после подтверждения
      function honest(e) {
        if (e && e.cancelable) e.preventDefault();
        if (!sure) { sure = true; no.textContent = 'Да, точно нет'; return; }
        emit('decline', {});
        stopAnims(); stage.innerHTML = '';
        stage.append(h('div', { class: 'pl-screen pl-center' }, sticker('😊', 'big'),
          h('h2', { class: 'pl-title', text: 'Спасибо за честный ответ' }),
          h('p', { class: 'pl-text', text: cfg.fromName ? `${cfg.fromName} узнает твой ответ.` : 'Твой ответ отправлен.' }),
          live ? h('a', { class: 'pl-link', href: '/', text: 'Создать своё приглашение' }) : null));
      }

      const handler = { run: dodge, shrink, kiss, turn, honest }[mode];
      if (mode === 'run') no.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') dodge(); });
      if (mode === 'run' || mode === 'kiss' || mode === 'shrink') no.addEventListener('touchstart', handler, { passive: false });
      no.addEventListener('click', handler);
      yes.addEventListener('click', sayYes);
      return wrap;
    }

    // картинка экрана: стикер, своё фото или ничего
    function picture(c, def) {
      const pic = c.picture || 'sticker';
      if (pic === 'photo') return c.photo ? h('img', { class: 'pl-photo', src: `/u/${c.photo}`, alt: '' }) : null;
      return pic === 'sticker' ? sticker(c.sticker || def, 'big') : null;
    }

    function confirm() {
      const c = cfg.confirm || {};
      return h('div', { class: 'pl-screen pl-center' }, picture(c, '🥰'),
        h('h2', { class: 'pl-title', text: fill(c.title) || 'Ура! Лучший ответ на свете 💖' }),
        c.text ? h('p', { class: 'pl-text', text: fill(c.text) }) : null,
        h('button', { class: 'pl-btn', type: 'button', text: c.button || 'Дальше', on: { click: next } }));
    }

    function date() {
      const d = cfg.date || {};
      const pick = (val) => { answers.date = val; emit('date', val); next(); };
      const chatBtn = d.chat !== false
        ? h('button', { class: 'pl-btn pl-btn-soft', type: 'button', text: 'Решим в чате 💬', on: { click: () => pick({ chat: true }) } })
        : null;
      if (d.mode === 'fixed' && d.fixedDate) {
        return h('div', { class: 'pl-screen pl-center' }, picture(d, '💘'),
          h('h2', { class: 'pl-title', text: fill(d.title) || 'Как тебе такое время?' }),
          d.text ? h('p', { class: 'pl-text', text: fill(d.text) }) : null,
          h('div', { class: 'pl-when' }, prettyDate(d.fixedDate, d.fixedTime)),
          h('button', { class: 'pl-btn', type: 'button', text: 'Подходит 👍', on: { click: () => pick({ date: d.fixedDate, time: d.fixedTime || '' }) } }),
          chatBtn);
      }
      const di = h('input', { type: 'date', class: 'pl-input', min: todayISO(), 'aria-label': 'Дата' });
      const ti = h('input', { type: 'time', class: 'pl-input', 'aria-label': 'Время' });
      const err = h('div', { class: 'pl-err' });
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Выбрать это время' });
      btn.addEventListener('click', () => {
        if (!di.value) { err.textContent = 'Выбери день'; di.focus(); return; }
        pick({ date: di.value, time: ti.value });
      });
      return h('div', { class: 'pl-screen pl-center' }, picture(d, '💘'),
        h('h2', { class: 'pl-title', text: fill(d.title) || 'Когда тебе удобно?' }),
        d.text ? h('p', { class: 'pl-text', text: fill(d.text) }) : null,
        h('div', { class: 'pl-row' }, di, ti), err, btn, chatBtn);
    }

    function choice(i) {
      const q = (cfg.choices || [])[i] || { items: [] };
      const picked = new Set();
      const grid = h('div', { class: 'pl-grid' });
      const err = h('div', { class: 'pl-err' });
      q.items.forEach((it, idx) => {
        const card = h('button', { class: 'pl-card', type: 'button', 'aria-pressed': 'false' },
          h('span', { class: 'pl-card-e', text: it.emoji || '✨' }), h('span', { class: 'pl-card-n', text: it.name }));
        card.addEventListener('click', () => {
          if (picked.has(idx)) picked.delete(idx);
          else { if (!q.multi) { picked.clear(); grid.querySelectorAll('.pl-card').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }); } picked.add(idx); }
          card.classList.toggle('on', picked.has(idx));
          card.setAttribute('aria-pressed', String(picked.has(idx)));
          err.textContent = '';
        });
        grid.append(card);
      });
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Готово' });
      btn.addEventListener('click', () => {
        if (!picked.size) { err.textContent = q.multi ? 'Выбери хотя бы один вариант' : 'Выбери вариант'; return; }
        const names_ = [...picked].map((k) => q.items[k].name);
        answers.picks[i] = names_;
        emit('choices', { index: i, title: q.title, picks: names_ });
        next();
      });
      return h('div', { class: 'pl-screen' }, h('h2', { class: 'pl-title', text: fill(q.title) || 'Что выберешь?' }),
        q.multi ? h('p', { class: 'pl-hint', text: 'Можно выбрать несколько' }) : null, grid, err, btn);
    }

    function final() {
      const f = cfg.final || {};
      const rows = [];
      if (answers.date) rows.push(['🗓️', answers.date.chat ? 'Время обсудим в чате' : prettyDate(answers.date.date, answers.date.time)]);
      (cfg.choices || []).forEach((q, i) => { if (answers.picks[i]) rows.push([q.items.find((it) => answers.picks[i].includes(it.name))?.emoji || '✨', answers.picks[i].join(', ')]); });
      const sum = rows.length ? h('div', { class: 'pl-sum' }, rows.map(([e, t]) => h('div', { class: 'pl-sum-row' }, h('span', { text: e }), h('span', { text: t })))) : null;
      emit('final');
      later(confetti, 150);
      return h('div', { class: 'pl-screen pl-center' }, sticker(f.sticker || '🥳', 'big'),
        h('h2', { class: 'pl-title', text: fill(f.title) || 'Это свидание!' }),
        f.text ? h('p', { class: 'pl-text', text: fill(f.text) }) : null, sum,
        h('p', { class: 'pl-hint', text: cfg.fromName ? `${cfg.fromName} уже знает ответ 😊` : 'Ответ уже отправлен 😊' }),
        live ? h('a', { class: 'pl-link', href: '/', text: 'Создать своё приглашение' }) : null);
    }

    // частицы из точки элемента: сердечки, поцелуи
    function particles(fromEl, chars, count, cls) {
      const rr = root.getBoundingClientRect(), r = fromEl.getBoundingClientRect();
      const box = h('div', { class: 'pl-fx', 'aria-hidden': 'true' });
      const cx = r.left - rr.left + r.width / 2, cy = r.top - rr.top + r.height / 2;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 70 + Math.random() * 90;
        box.append(h('span', { class: cls, text: chars[i % chars.length],
          style: `left:${cx}px;top:${cy}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist - (cls === 'pl-float-up' ? 60 : 0)}px;font-size:${16 + Math.random() * 14}px;animation-delay:${Math.random() * 0.08}s` }));
      }
      root.append(box);
      later(() => box.remove(), 1400);
    }
    function playYes(btn, done) {
      const fx = ['burst', 'rain', 'none'].includes(cfg.ask && cfg.ask.yesFx) ? cfg.ask.yesFx : 'burst';
      if (fx === 'none') return done();
      if (fx === 'burst') particles(btn, ['💖', '💕', '❤️', '✨'], 18, 'pl-burst');
      else confetti();
      later(done, fx === 'burst' ? 750 : 900);
    }

    function confetti() {
      const box = h('div', { class: 'pl-confetti', 'aria-hidden': 'true' });
      for (let i = 0; i < 28; i++) {
        box.append(h('span', { text: ['♥', '💖', '✨', '💕'][i % 4], style: `left:${(i * 37) % 100}%;animation-delay:${(i % 7) * 0.15}s;font-size:${14 + (i % 5) * 4}px` }));
      }
      root.append(box);
      later(() => box.remove(), 4200);
    }

    const api = {
      screens: order,
      goto(id) { timers.forEach(clearTimeout); timers = []; if (order.includes(id)) show(id); },
      restart() { answers.noClicks = 0; answers.date = null; answers.picks = []; api.goto(order[0]); },
      destroy() { timers.forEach(clearTimeout); stopAnims(); root.innerHTML = ''; root.classList.remove('pl', 'pl-live'); },
    };
    show(order.includes(opts.startAt) ? opts.startAt : order[0]);
    return api;
  }

  window.Player = { mount, screensOf, prettyDate };
})();
