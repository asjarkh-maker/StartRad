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
    const list = ['gate', 'ask', 'confirm'];
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
    function videoCircle(file) {
      if (!file) return null;
      const v = h('video', { src: `/u/${file}`, playsinline: true, loop: true, autoplay: true, muted: true, preload: 'auto' });
      v.muted = true;
      const icon = h('span', { class: 'pl-circle-i', text: '🔇' });
      const wrap = h('button', { class: 'pl-circle', type: 'button', 'aria-label': 'Включить звук' }, v, icon);
      wrap.addEventListener('click', () => {
        if (v.muted) { v.muted = false; v.currentTime = 0; v.play().catch(() => {}); icon.textContent = '🔊'; }
        else { v.muted = true; icon.textContent = '🔇'; }
      });
      return wrap;
    }
    function voiceBubble(file) {
      if (!file) return null;
      const a = h('audio', { src: `/u/${file}`, preload: 'metadata' });
      const btn = h('span', { class: 'pl-voice-b', text: '▶' });
      const bar = h('i'), track = h('span', { class: 'pl-voice-t' }, bar);
      const time = h('span', { class: 'pl-voice-s', text: '0:00' });
      const fmt = (x) => (isFinite(x) ? `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}` : '');
      a.addEventListener('loadedmetadata', () => { time.textContent = fmt(a.duration) || ''; });
      a.addEventListener('timeupdate', () => { if (isFinite(a.duration) && a.duration) bar.style.width = (a.currentTime / a.duration * 100) + '%'; time.textContent = fmt(a.currentTime); });
      a.addEventListener('ended', () => { btn.textContent = '▶'; bar.style.width = '0'; });
      const wrap = h('button', { class: 'pl-voice', type: 'button', 'aria-label': 'Голосовое сообщение' }, btn, track, time, a);
      wrap.addEventListener('click', () => { if (a.paused) { a.play().catch(() => {}); btn.textContent = '❚❚'; } else { a.pause(); btn.textContent = '▶'; } });
      return wrap;
    }
    const names = () => cfg.toName || '';
    const fill = (t) => String(t || '')
      .replace(/\{имя\}|\{name\}/gi, names())
      .replace(/\{дата\}|\{date\}/gi, answers.date ? prettyDate(answers.date.date, answers.date.time) : '')
      .replace(/\{выбор\}|\{choice\}/gi, answers.picks.flat().filter(Boolean).join(', '));

    function show(id) {
      cur = order.indexOf(id);
      stopAnims();
      stage.querySelectorAll('audio,video').forEach((m) => { try { m.pause(); } catch (e) { /* пусто */ } });
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
      wrap.append(...[videoCircle(a.video), a.video ? null : photo(), a.video || cfg.photo ? null : sticker(a.sticker),
        h('h2', { class: 'pl-title', text: fill(a.title) }),
        a.text ? h('p', { class: 'pl-text', text: fill(a.text) }) : null, voiceBubble(a.voice), actions].filter(Boolean));

      const lines = a.noLines && a.noLines.length ? a.noLines : DEFAULT_NO;
      let tries = 0, scale = 1;
      function dodge(e) {
        if (e && e.cancelable) e.preventDefault();
        tries++; answers.noClicks++;
        emit('no', { n: answers.noClicks });
        no.textContent = lines[tries % lines.length];
        scale = Math.min(1 + tries * 0.06, 1.4);
        yes.style.transform = `scale(${scale})`;
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
      no.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') dodge(); });
      no.addEventListener('touchstart', dodge, { passive: false });
      no.addEventListener('click', dodge);
      yes.addEventListener('click', () => { emit('yes', { no: answers.noClicks }); next(); });
      return wrap;
    }

    function confirm() {
      const c = cfg.confirm || {};
      return h('div', { class: 'pl-screen pl-center' }, sticker(c.sticker || '🥰', 'big'),
        h('h2', { class: 'pl-title', text: fill(c.title) || 'Ура! Я так рад(а)!' }),
        c.text ? h('p', { class: 'pl-text', text: fill(c.text) }) : null,
        h('button', { class: 'pl-btn', type: 'button', text: 'Дальше', on: { click: next } }));
    }

    function date() {
      const d = cfg.date || {};
      const di = h('input', { type: 'date', class: 'pl-input', min: todayISO(), 'aria-label': 'Дата' });
      const ti = h('input', { type: 'time', class: 'pl-input', 'aria-label': 'Время' });
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Выбрать' });
      const err = h('div', { class: 'pl-err' });
      btn.addEventListener('click', () => {
        if (!di.value) { err.textContent = 'Выбери день'; di.focus(); return; }
        answers.date = { date: di.value, time: ti.value };
        emit('date', answers.date);
        next();
      });
      return h('div', { class: 'pl-screen pl-center' }, sticker(d.sticker || '🗓️', 'big'),
        h('h2', { class: 'pl-title', text: fill(d.title) || 'Когда тебе удобно?' }),
        d.text ? h('p', { class: 'pl-text', text: fill(d.text) }) : null,
        h('div', { class: 'pl-row' }, di, ti), err, btn);
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
      if (answers.date) rows.push(['🗓️', prettyDate(answers.date.date, answers.date.time)]);
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
