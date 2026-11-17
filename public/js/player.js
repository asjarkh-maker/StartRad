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
    const list = cfg.gate && cfg.gate.type === 'none' ? ['ask'] : ['gate', 'ask'];
    if (!cfg.confirm || cfg.confirm.enabled !== false) list.push('confirm');
    // сначала «куда», потом «когда» — время зависит от места
    (cfg.choices || []).forEach((_, i) => list.push('choice' + i));
    if (cfg.date && cfg.date.enabled) list.push('date');
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
    let cur = -1, timers = [], opened = false;

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
    let demoFx = null;
    function sticker(e, cls = '') {
      if (!e) return null;
      if (/^pic:[a-z]+$/.test(e)) return h('div', { class: 'pl-sticker pl-pic ' + cls, 'aria-hidden': 'true' }, h('img', { src: `/pics/${e.slice(4)}.svg`, alt: '' }));
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
      const open = () => { emit('open'); opened = true; next(); };
      if (g.type === 'code') return gateCode(g, wrap, open);
      if (g.type === 'scratch') return gateScratch(g, wrap, open);
      if (g.type === 'timer') return gateTimer(g, wrap, open);
      if (g.type === 'button') {
        wrap.append(sticker('💌', 'big'), h('h2', { class: 'pl-title', text: fill(g.text) || `${names()}, тебе письмо` }),
          h('button', { class: 'pl-btn', type: 'button', text: 'Открыть', on: { click: open } }));
        return wrap;
      }
      const env = h('div', { class: 'pl-env', role: 'button', tabindex: '0', 'aria-label': 'Открыть конверт' },
        h('div', { class: 'pl-env-body' }), h('div', { class: 'pl-env-flap' }), h('div', { class: 'pl-env-seal', html: HEART }));
      const go = () => {
        if (env.classList.contains('open')) return;
        env.classList.add('open'); emit('open'); opened = true;
        later(next, 800);
      };
      env.addEventListener('click', go);
      env.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      wrap.append(env, h('p', { class: 'pl-hint', text: fill(g.text) || `${names()}, тебе письмо. Нажми на конверт 💌` }));
      return wrap;
    }

    // код из цифр: в превью код известен, у получателя — только его хеш
    async function codeOk(g, val) {
      if (g.code) return val === g.code;
      if (!g.codeHash) return true;
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(val));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') === g.codeHash;
      } catch (e) { return true; }
    }
    function gateCode(g, wrap, open) {
      const len = g.code ? g.code.length : g.codeLen || 4;
      const inp = h('input', { class: 'pl-input pl-code', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: len, placeholder: '•'.repeat(len), 'aria-label': 'Код' });
      const msg = h('p', { class: 'pl-hint pl-code-msg', role: 'status' });
      const check = async () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, len);
        if (inp.value.length < len) { msg.textContent = ''; return; }
        if (await codeOk(g, inp.value)) { inp.classList.add('ok'); msg.textContent = 'Верно! 💖'; later(open, 500); }
        else { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); msg.textContent = 'Не тот код — попробуй ещё 🙈'; inp.select(); }
      };
      inp.addEventListener('input', check);
      wrap.append(sticker('🔐', 'big'), h('h2', { class: 'pl-title', text: fill(g.text) || `${names()}, введи код` }),
        ...(g.hint ? [h('p', { class: 'pl-text', text: 'Подсказка: ' + fill(g.hint) })] : []), inp, msg);
      return wrap;
    }
    // стереть фон пальцем
    function gateScratch(g, wrap, open) {
      const box = h('div', { class: 'pl-scratch' }, h('div', { class: 'pl-scratch-under' }, sticker('💌', 'big'), h('b', { text: 'Тебе приглашение!' })));
      const cv = h('canvas', { class: 'pl-scratch-cv', 'aria-label': 'Сотри, чтобы открыть', role: 'button', tabindex: '0' });
      box.append(cv);
      let ctx, W = 0, H = 0, done = false, moves = 0;
      const paint = () => {
        const r = box.getBoundingClientRect(); if (!r.width) return;
        const k = window.devicePixelRatio || 1; W = cv.width = Math.round(r.width * k); H = cv.height = Math.round(r.height * k);
        ctx = cv.getContext('2d');
        const st = getComputedStyle(root), gr = ctx.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, st.getPropertyValue('--a2').trim() || '#ff8fab'); gr.addColorStop(1, st.getPropertyValue('--a1').trim() || '#ff4d6d');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `800 ${Math.round(16 * k)}px Manrope, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('Сотри меня ✨', W / 2, H / 2 + 6 * k);
        ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 34 * k;
      };
      later(paint, 30);
      const cleared = () => { const d = ctx.getImageData(0, 0, W, H).data; let n = 0, all = 0; for (let i = 3; i < d.length; i += 64) { all++; if (d[i] < 40) n++; } return n / all; };
      const finish = () => { if (done) return; done = true; cv.classList.add('gone'); later(open, 700); };
      let last = null;
      const pt = (e) => { const r = cv.getBoundingClientRect(), k = W / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
      cv.addEventListener('pointerdown', (e) => { if (!ctx) paint(); last = pt(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last[0], last[1], 17 * (W / cv.getBoundingClientRect().width), 0, 7); ctx.fill(); });
      cv.addEventListener('pointermove', (e) => {
        if (!last || done) return; const p = pt(e);
        ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p;
        if (++moves % 8 === 0 && cleared() > 0.45) finish();
      });
      const up = () => { last = null; if (ctx && !done && cleared() > 0.45) finish(); };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } });
      wrap.append(h('h2', { class: 'pl-title', text: fill(g.text) || `${names()}, сотри, чтобы открыть` }), box);
      return wrap;
    }
    // откроется в выбранное время
    function gateTimer(g, wrap, open) {
      const at = Date.parse(g.at || '') || 0;
      const clock = h('div', { class: 'pl-clock', 'aria-live': 'polite' });
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Открыть', on: { click: open } });
      const sub = h('p', { class: 'pl-text' });
      const when = at ? new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
      const tick = () => {
        if (cur >= 0 && order[cur] !== 'gate') return;
        const left = at - Date.now();
        if (left <= 0) { clock.hidden = true; sub.textContent = 'Время пришло 💖'; btn.hidden = false; return; }
        btn.hidden = true;
        const d = Math.floor(left / 864e5), hh = Math.floor(left / 36e5) % 24, mm = Math.floor(left / 6e4) % 60, ss = Math.floor(left / 1e3) % 60;
        const two = (n) => String(n).padStart(2, '0');
        clock.textContent = (d ? `${d} д ` : '') + `${two(hh)}:${two(mm)}:${two(ss)}`;
        sub.textContent = `Откроется ${when}`;
        later(tick, 1000);
      };
      tick();
      wrap.append(sticker('⏰', 'big'), h('h2', { class: 'pl-title', text: fill(g.text) || `${names()}, для тебя кое-что есть` }), clock, sub, btn);
      if (!live && at > Date.now()) wrap.append(h('button', { class: 'pl-link', type: 'button', text: 'Открыть сейчас (только в превью)', on: { click: open } }));
      return wrap;
    }

    function ask() {
      if (!opened && cfg.gate && cfg.gate.type === 'none') { opened = true; emit('open'); }
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
      // для превью в редакторе: показать эффект «Да» или поведение «Нет», не уходя с экрана
      demoFx = {
        yes() {
          const fx = ['burst', 'rain', 'none'].includes(a.yesFx) ? a.yesFx : 'burst';
          if (fx === 'burst') particles(yes, ['💖', '💕', '❤️', '✨'], 18, 'pl-burst');
          else if (fx === 'rain') confetti();
          else if (yes.animate) yes.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 350 });
        },
        no() { handler(); if (mode === 'kiss' || mode === 'run') later(() => handler(), 650); },
      };
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
      // дни: сегодня, завтра и ещё три; время — популярные часы; всё можно поменять
      const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const days = [];
      for (let k = 0; k < 5; k++) { const dt = new Date(); dt.setDate(dt.getDate() + k); days.push({ iso: isoOf(dt), label: k === 0 ? 'Сегодня' : k === 1 ? 'Завтра' : `${WD[dt.getDay()]}, ${dt.getDate()}` }); }
      const TIMES = ['12:00', '15:00', '18:00', '19:00', '20:00', '21:00'];
      let selDate = days[1].iso, selTime = '19:00';
      const when = h('div', { class: 'pl-when' });
      const showWhen = () => { when.textContent = prettyDate(selDate, selTime); };
      function chips(list, cur, onPick, otherLabel, input) {
        const row = h('div', { class: 'pl-chips' });
        const all = [];
        const mark = (btn) => all.forEach((b) => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
        list.forEach(([val, label]) => {
          const b = h('button', { class: 'pl-chip' + (val === cur ? ' on' : ''), type: 'button', text: label, 'aria-pressed': String(val === cur) });
          b.addEventListener('click', () => { mark(b); input.hidden = true; onPick(val); });
          all.push(b); row.append(b);
        });
        const other = h('button', { class: 'pl-chip', type: 'button', text: otherLabel, 'aria-pressed': 'false' });
        other.addEventListener('click', () => { mark(other); input.hidden = false; try { input.showPicker && input.showPicker(); } catch (e) { input.focus(); } if (input.value) onPick(input.value); });
        all.push(other); row.append(other);
        return row;
      }
      const di = h('input', { type: 'date', class: 'pl-input pl-input-full', min: todayISO(), value: selDate, 'aria-label': 'Другая дата', hidden: true });
      const ti = h('input', { type: 'time', class: 'pl-input pl-input-full', value: selTime, 'aria-label': 'Другое время', hidden: true });
      di.addEventListener('change', () => { if (di.value) { selDate = di.value; showWhen(); } });
      ti.addEventListener('change', () => { if (ti.value) { selTime = ti.value; showWhen(); } });
      const dayRow = chips(days.map((x) => [x.iso, x.label]), selDate, (v) => { selDate = v; showWhen(); }, 'Другая дата', di);
      const timeRow = chips(TIMES.map((t) => [t, t]), selTime, (v) => { selTime = v; showWhen(); }, 'Другое', ti);
      showWhen();
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Выбрать это время' });
      btn.addEventListener('click', () => pick({ date: selDate, time: selTime }));
      return h('div', { class: 'pl-screen pl-center' }, picture(d, '💘'),
        h('h2', { class: 'pl-title', text: fill(d.title) || 'Когда тебе удобно?' }),
        d.text ? h('p', { class: 'pl-text', text: fill(d.text) }) : null,
        h('div', { class: 'pl-pick' }, h('div', { class: 'pl-pick-l', text: 'День' }), dayRow, di,
          h('div', { class: 'pl-pick-l', text: 'Время' }), timeRow, ti),
        when, btn, chatBtn);
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
      // свой вариант: если ничего из предложенного не подошло
      const OWN = 'own';
      const ownInp = h('input', { class: 'pl-input pl-input-full pl-own-inp', type: 'text', maxlength: 60, placeholder: 'Напиши своё место или идею', 'aria-label': 'Свой вариант', hidden: true });
      if (q.own !== false) {
        const card = h('button', { class: 'pl-card pl-card-own', type: 'button', 'aria-pressed': 'false' },
          h('span', { class: 'pl-card-e', text: '✏️' }), h('span', { class: 'pl-card-n', text: 'Свой вариант' }));
        card.addEventListener('click', () => {
          if (picked.has(OWN)) picked.delete(OWN);
          else { if (!q.multi) { picked.clear(); grid.querySelectorAll('.pl-card').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }); } picked.add(OWN); }
          card.classList.toggle('on', picked.has(OWN)); card.setAttribute('aria-pressed', String(picked.has(OWN)));
          ownInp.hidden = !picked.has(OWN); if (!ownInp.hidden) ownInp.focus();
          err.textContent = '';
        });
        grid.append(card);
        // выбор обычной карточки в режиме «одно» прячет поле своего варианта
        grid.addEventListener('click', () => { if (!picked.has(OWN)) ownInp.hidden = true; });
      }
      const btn = h('button', { class: 'pl-btn', type: 'button', text: 'Готово' });
      btn.addEventListener('click', () => {
        if (!picked.size) { err.textContent = q.multi ? 'Выбери хотя бы один вариант' : 'Выбери вариант'; return; }
        const own = ownInp.value.trim();
        if (picked.has(OWN) && !own) { err.textContent = 'Напиши свой вариант'; ownInp.focus(); return; }
        const names_ = [...picked].map((k) => (k === OWN ? own : q.items[k].name));
        answers.picks[i] = names_;
        emit('choices', { index: i, title: q.title, picks: names_ });
        next();
      });
      return h('div', { class: 'pl-screen' }, h('h2', { class: 'pl-title', text: fill(q.title) || 'Что выберешь?' }),
        q.multi ? h('p', { class: 'pl-hint', text: 'Можно выбрать несколько' }) : null, grid, ownInp, err, btn);
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
        h('h2', { class: 'pl-title', text: fill(f.title) || 'Ура, встречаемся!' }),
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
      demo(kind) { if (demoFx && demoFx[kind] && stage.querySelector('.pl-yes')) demoFx[kind](); },
      goto(id) { timers.forEach(clearTimeout); timers = []; if (order.includes(id)) show(id); },
      restart() { answers.noClicks = 0; answers.date = null; answers.picks = []; api.goto(order[0]); },
      destroy() { timers.forEach(clearTimeout); stopAnims(); root.innerHTML = ''; root.classList.remove('pl', 'pl-live'); },
    };
    show(order.includes(opts.startAt) ? opts.startAt : order[0]);
    return api;
  }

  window.Player = { mount, screensOf, prettyDate };
})();
