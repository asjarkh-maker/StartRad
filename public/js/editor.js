// Редактор приглашения: пошаговый мастер и живое превью в телефоне.
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
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

  const params = new URLSearchParams(location.search);
  const editToken = /^[a-f0-9]{36}$/.test(params.get('edit') || '') ? params.get('edit') : null;
  const DRAFT_KEY = 'tolkoda:draft';

  const THEMES = [
    ['pink', 'Розовое', '#ff3d6e'], ['peach', 'Персик', '#ff8a5c'], ['mint', 'Мята', '#14b87a'],
    ['lilac', 'Сирень', '#8b5cf6'], ['night', 'Вечер', '#2b1830'],
  ];
  const STICKERS = ['🥺', '🥰', '😍', '😳', '🤭', '🙈', '😘', '😻', '🥳', '😊', '🤗', '😎', '🤩', '😇', '💘', '💖', '💝', '💞', '💕', '💌', '💋', '🌹', '💐', '🌷', '🎉', '🎁', '⏰', '🍷', '🥂', '✨', '🔥', '🦋', '💃', '🐱', '🐻', '🦄', '🍿', '🎬', '☕', '🎂', '🌈'];
  const PRESETS = {
    'Куда пойдём': { title: 'Куда пойдём?', items: [['Кино', '🎬'], ['Кофейня', '☕'], ['Прогулка', '🌳'], ['Выставка', '🎨'], ['Каток', '⛸️'], ['Набережная', '🌅']] },
    'Что поедим': { title: 'Что будем есть?', items: [['Пицца', '🍕'], ['Суши', '🍣'], ['Паста', '🍝'], ['Бургеры', '🍔'], ['Десерты', '🍰'], ['Стейк', '🥩']] },
    'Чем займёмся': { title: 'Чем займёмся?', items: [['Боулинг', '🎳'], ['Квест', '🧩'], ['Караоке', '🎤'], ['Настолки', '🎮'], ['Танцы', '💃'], ['Пикник', '🧺']] },
  };

  const defaults = () => ({
    toName: '', fromName: '', theme: 'pink', photo: '',
    gate: { type: 'envelope', text: '' },
    ask: { title: 'Пойдёшь со мной на свидание?', text: '', sticker: '🥺', yes: 'Да 💖', noLines: [], voice: '', video: '' },
    confirm: { title: 'Ура! Я так рад(а)!', text: '', sticker: '🥰' },
    date: { enabled: true, title: 'Когда тебе удобно?', text: 'Выбери день и время — я подстроюсь.', sticker: '🗓️' },
    choices: [{ title: 'Куда пойдём?', multi: false, items: [{ name: 'Кино', emoji: '🎬' }, { name: 'Кофейня', emoji: '☕' }, { name: 'Прогулка', emoji: '🌳' }] }],
    final: { title: 'Это свидание!', text: 'Жду нашей встречи 💞', sticker: '🥳' },
  });

  const STEPS = [
    { id: 'who', name: 'Кого зовём' },
    { id: 'gate', name: 'Открытие' },
    { id: 'ask', name: 'Вопрос' },
    { id: 'confirm', name: 'После «Да»' },
    { id: 'date', name: 'Дата и время' },
    { id: 'choices', name: 'Выбор' },
    { id: 'final', name: 'Финал' },
    { id: 'done', name: 'Готово' },
  ];

  let cfg = defaults(), stepIdx = 0, player = null, activeChoice = 0, submitting = false, meta = { price: 490, pay: true };
  let previewTimer = 0;

  // ---------- состояние ----------
  function get(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), cfg); }
  function set(path, val, rerender) {
    const keys = path.split('.');
    let o = cfg;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = val;
    changed(rerender);
  }
  function changed(rerender) {
    saveDraft();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => refreshPreview(), rerender ? 0 : 200);
    if (rerender) renderPanel();
  }
  function saveDraft() {
    if (editToken) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ cfg, step: stepIdx })); } catch (e) { /* приватный режим */ }
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }
  function toast(text) {
    const t = h('div', { class: 'toast', text });
    document.body.append(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ---------- элементы формы ----------
  function field(label, input, hint) {
    return h('label', { class: 'f' }, h('span', { class: 'f-l', text: label }), input, hint ? h('span', { class: 'f-h', text: hint }) : null);
  }
  function textInput(path, label, o = {}) {
    const input = h('input', { type: 'text', class: 'inp', maxlength: o.max || 60, placeholder: o.ph || '', value: get(path) || '' });
    input.addEventListener('input', () => set(path, input.value));
    return field(label, input, o.hint);
  }
  function textArea(path, label, o = {}) {
    const input = h('textarea', { class: 'inp', maxlength: o.max || 400, rows: o.rows || 3, placeholder: o.ph || '' });
    input.value = get(path) || '';
    input.addEventListener('input', () => set(path, input.value));
    return field(label, input, o.hint);
  }
  function switchRow(path, label, small) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!get(path);
    input.addEventListener('change', () => set(path, input.checked, true));
    return h('label', { class: 'sw' }, input, h('span', { class: 'sw-ui' }), h('span', { class: 'sw-t' }, label, small ? h('small', { text: small }) : null));
  }
  function tabs(list, cur, onPick) {
    return h('div', { class: 'tabs' }, list.map(([val, label]) => h('button', { type: 'button', class: 'tab' + (cur === val ? ' on' : ''), text: label, on: { click: () => onPick(val) } })));
  }
  function emojiPicker(label, cur, onPick) {
    const own = h('input', { type: 'text', class: 'inp inp-emoji', maxlength: 8, placeholder: 'своё', value: STICKERS.includes(cur) ? '' : cur || '' });
    own.addEventListener('input', () => onPick(own.value.trim()));
    return h('div', { class: 'f' }, h('span', { class: 'f-l', text: label }),
      h('div', { class: 'emojis' }, STICKERS.map((e) => h('button', { type: 'button', class: 'emo' + (cur === e ? ' on' : ''), text: e, 'aria-label': e, on: { click: () => onPick(e) } })), own));
  }
  const panelHead = (title, sub) => [h('h2', { class: 'p-title', text: title }), sub ? h('p', { class: 'p-sub', text: sub }) : null];

  // ---------- загрузка фото ----------
  async function prepareImage(file) {
    if (file.type === 'image/gif') {
      if (file.size > 5 * 1024 * 1024) throw new Error('GIF больше 5 МБ');
      return file;
    }
    if (file.size > 25 * 1024 * 1024) throw new Error('Фото слишком большое');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { throw new Error('Не получилось открыть фото. Попробуйте JPG или PNG'); }
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Не получилось обработать фото'))), 'image/jpeg', 0.86));
  }
  async function uploadBlob(blob, kind) {
    const r = await fetch(`/api/upload?kind=${kind}`, { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Не удалось загрузить');
    return d.file;
  }
  async function uploadPhoto(file) {
    const blob = await prepareImage(file);
    const r = await fetch('/api/upload?kind=image', { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Не удалось загрузить');
    return d.file;
  }
  function photoField() {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
    const status = h('span', { class: 'f-h' });
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      status.textContent = 'Загружаю…';
      try { set('photo', await uploadPhoto(f), true); } catch (e) { status.textContent = e.message; }
    });
    return h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Фото (необязательно)' }),
      cfg.photo
        ? h('div', { class: 'photo-row' }, h('img', { class: 'photo-thumb', src: `/u/${cfg.photo}`, alt: '' }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Убрать', on: { click: () => set('photo', '', true) } }))
        : h('label', { class: 'btn btn-ghost btn-sm upload' }, '📷 Добавить фото', input),
      status);
  }

  // ---------- голосовое и кружок ----------
  const canRecord = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder;
  const pickMime = (list) => list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  let rec = null; // текущая запись

  function stopRecording(save) {
    if (!rec) return;
    rec.save = save;
    clearInterval(rec.tick);
    if (rec.mr.state !== 'inactive') rec.mr.stop(); else rec.finish();
  }

  function mediaField(kind) {
    const isVideo = kind === 'video';
    const path = isVideo ? 'ask.video' : 'ask.voice';
    const label = isVideo ? 'Видео-кружок (необязательно)' : 'Голосовое (необязательно)';
    const maxSec = isVideo ? 30 : 60;
    const status = h('span', { class: 'f-h' });
    const cur = get(path);
    const box = h('div', { class: 'f' }, h('span', { class: 'f-l', text: label }));

    if (cur) {
      const media = isVideo
        ? h('video', { class: 'media-thumb round', src: `/u/${cur}`, controls: true, playsinline: true, preload: 'metadata' })
        : h('audio', { src: `/u/${cur}`, controls: true, preload: 'metadata' });
      box.append(h('div', { class: 'photo-row' }, media,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Убрать', on: { click: () => set(path, '', true) } })));
      return box;
    }

    const file = h('input', { type: 'file', accept: isVideo ? 'video/*' : 'audio/*', class: 'sr-only' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      status.textContent = 'Загружаю…';
      try { set(path, await uploadBlob(f, isVideo ? 'video' : 'audio'), true); } catch (e) { status.textContent = e.message; }
    });
    const row = h('div', { class: 'media-row' });
    const live = h('div', { class: 'media-live' });

    async function start() {
      if (rec) stopRecording(false);
      status.textContent = '';
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(isVideo
          ? { audio: true, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } }
          : { audio: true });
      } catch (e) { status.textContent = 'Нет доступа к ' + (isVideo ? 'камере' : 'микрофону') + '. Разрешите его в браузере или загрузите файл.'; return; }
      const mime = pickMime(isVideo ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']);
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const t0 = Date.now();
      const timer = h('b', { text: '0:00' });
      const stopBtn = h('button', { type: 'button', class: 'btn btn-sm', text: '■ Готово', on: { click: () => stopRecording(true) } });
      const cancel = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Отмена', on: { click: () => stopRecording(false) } });
      live.innerHTML = '';
      if (isVideo) { const v = h('video', { class: 'media-thumb round', playsinline: true, muted: true, autoplay: true }); v.muted = true; v.srcObject = stream; live.append(v); }
      live.append(h('div', { class: 'media-rec' }, h('span', { class: 'rec-dot' }), timer, ` / ${maxSec} с`), stopBtn, cancel);
      row.hidden = true;
      rec = {
        mr, save: false,
        tick: setInterval(() => {
          const sec = Math.floor((Date.now() - t0) / 1000);
          timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
          if (sec >= maxSec) stopRecording(true);
        }, 250),
        finish: async () => {
          stream.getTracks().forEach((t) => t.stop());
          const save = rec && rec.save;
          rec = null;
          live.innerHTML = ''; row.hidden = false;
          if (!save || !chunks.length) return;
          status.textContent = 'Загружаю…';
          try { set(path, await uploadBlob(new Blob(chunks, { type: (mr.mimeType || mime || '').split(';')[0] }), isVideo ? 'video' : 'audio'), true); }
          catch (e) { status.textContent = e.message; }
        },
      };
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => rec && rec.finish();
      mr.start(1000);
    }

    if (canRecord()) row.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: isVideo ? '🎥 Записать кружок' : '🎙 Записать голосовое', on: { click: start } }));
    row.append(h('label', { class: 'btn btn-ghost btn-sm upload' }, '📎 Загрузить файл', file));
    box.append(row, live, status);
    if (!canRecord()) box.append(h('span', { class: 'f-h', text: 'Запись с микрофона и камеры работает, когда сайт открыт по https. Пока можно загрузить готовый файл.' }));
    else box.append(h('span', { class: 'f-h', text: `До ${maxSec} секунд.` }));
    return box;
  }

  // ---------- шаги ----------
  const PANELS = {
    who() {
      return [...panelHead('Кого зовём?', 'Имя увидит получатель — оно подставится в текст.'),
        textInput('toName', 'Кого приглашаете', { max: 40, ph: 'Аня' }),
        textInput('fromName', 'Ваше имя (необязательно)', { max: 40, ph: 'Саша' }),
        h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Оформление' }),
          h('div', { class: 'themes' }, THEMES.map(([id, name, color]) => h('button', {
            type: 'button', class: 'theme' + (cfg.theme === id ? ' on' : ''), on: { click: () => set('theme', id, true) },
          }, h('i', { style: `background:${color}` }), name)))),
        emojiPicker('Стикер на приглашении', cfg.ask.sticker, (e) => set('ask.sticker', e, true))];
    },
    gate() {
      return [...panelHead('Как откроется приглашение', 'Первое, что увидит получатель.'),
        tabs([['envelope', '💌 Конверт'], ['button', '🔘 Кнопка']], cfg.gate.type, (v) => set('gate.type', v, true)),
        textInput('gate.text', 'Подпись (необязательно)', { max: 80, ph: 'Тебе письмо. Нажми на конверт 💌' })];
    },
    ask() {
      return [...panelHead('Главный вопрос', 'Кнопка «Нет» будет убегать — останется только «Да».'),
        textInput('ask.title', 'Вопрос', { max: 140 }),
        textArea('ask.text', 'Тёплые слова', { max: 500, ph: 'Давно хотел позвать тебя куда-нибудь вдвоём…', hint: 'Можно писать {имя} — подставится имя получателя' }),
        textInput('ask.yes', 'Текст кнопки «Да»', { max: 30 }),
        emojiPicker('Стикер', cfg.ask.sticker, (e) => set('ask.sticker', e, true)),
        photoField(),
        mediaField('voice'),
        mediaField('video'),
        textArea('ask.noLinesText', 'Фразы на кнопке «Нет» (по одной в строке)', { max: 400, rows: 4, ph: 'Нет\nТочно?\nПодумай ещё', hint: 'Пусто — будут стандартные' })];
    },
    confirm() {
      return [...panelHead('Экран после «Да»'),
        textInput('confirm.title', 'Заголовок', { max: 120 }),
        textArea('confirm.text', 'Текст', { max: 400 }),
        emojiPicker('Стикер', cfg.confirm.sticker, (e) => set('confirm.sticker', e, true))];
    },
    date() {
      const list = [...panelHead('Дата и время', 'Получатель сам выберет, когда ему удобно.'),
        switchRow('date.enabled', 'Спрашивать дату и время')];
      if (cfg.date.enabled) list.push(textInput('date.title', 'Заголовок', { max: 120 }), textArea('date.text', 'Текст', { max: 300 }),
        emojiPicker('Стикер', cfg.date.sticker, (e) => set('date.sticker', e, true)));
      return list;
    },
    choices() {
      const out = [...panelHead('Варианты на выбор', 'Куда пойти, что поесть — получатель выберет из ваших вариантов.')];
      if (!cfg.choices.length) out.push(h('p', { class: 'f-h', text: 'Вопросов пока нет. Это необязательно — можно пропустить.' }));
      else {
        out.push(tabs(cfg.choices.map((_, i) => [i, `Вопрос ${i + 1}`]), activeChoice, (v) => { activeChoice = v; renderPanel(); refreshPreview(); }));
        const i = Math.min(activeChoice, cfg.choices.length - 1), q = cfg.choices[i], base = `choices.${i}`;
        out.push(textInput(`${base}.title`, 'Вопрос', { max: 120 }), switchRow(`${base}.multi`, 'Можно выбрать несколько'));
        q.items.forEach((it, k) => {
          const emo = h('input', { class: 'inp inp-emoji', maxlength: 8, value: it.emoji || '' });
          emo.addEventListener('input', () => set(`${base}.items.${k}.emoji`, emo.value.trim()));
          const name = h('input', { class: 'inp', maxlength: 40, placeholder: 'Название', value: it.name || '' });
          name.addEventListener('input', () => set(`${base}.items.${k}.name`, name.value));
          out.push(h('div', { class: 'item-row' }, emo, name,
            h('button', { type: 'button', class: 'x', 'aria-label': 'Удалить', text: '×', on: { click: () => { q.items.splice(k, 1); changed(true); } } })));
        });
        if (q.items.length < 8) out.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '＋ Вариант', on: { click: () => { q.items.push({ name: '', emoji: '✨' }); changed(true); } } }));
        out.push(h('button', { type: 'button', class: 'link-btn', text: 'Удалить этот вопрос', on: { click: () => { cfg.choices.splice(i, 1); activeChoice = 0; changed(true); } } }));
      }
      if (cfg.choices.length < 3) {
        out.push(h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Добавить вопрос из готовых' }),
          h('div', { class: 'chips' }, Object.entries(PRESETS).map(([name, p]) => h('button', {
            type: 'button', class: 'chip', text: name,
            on: { click: () => { cfg.choices.push({ title: p.title, multi: false, items: p.items.slice(0, 4).map(([n, e]) => ({ name: n, emoji: e })) }); activeChoice = cfg.choices.length - 1; changed(true); } },
          })), h('button', { type: 'button', class: 'chip', text: '＋ Свой', on: { click: () => { cfg.choices.push({ title: '', multi: false, items: [{ name: '', emoji: '✨' }, { name: '', emoji: '✨' }] }); activeChoice = cfg.choices.length - 1; changed(true); } } }))));
      }
      return out;
    },
    final() {
      return [...panelHead('Финал', 'Последний экран. Дату и выбор получатель увидит списком.'),
        textInput('final.title', 'Заголовок', { max: 120 }),
        textArea('final.text', 'Текст', { max: 600, hint: 'Можно писать {дата} и {выбор} — подставятся ответы получателя' }),
        emojiPicker('Стикер', cfg.final.sticker, (e) => set('final.sticker', e, true))];
    },
    done() {
      const err = validateAll();
      return [...panelHead('Готово!', 'Пройдите приглашение в превью целиком — так его увидит получатель.'),
        h('div', { class: 'sum-card' },
          h('div', { text: `Для: ${cfg.toName || '—'}` }),
          h('div', { text: `Вопрос: ${cfg.ask.title}` }),
          h('div', { text: `Экранов: ${Player.screensOf(cfg).length}` })),
        h('p', { class: 'f-h', text: editToken ? 'Изменения сохранятся в той же ссылке.' : `Сделать приглашение и посмотреть — бесплатно. Ссылку для отправки получите на следующем шаге${meta.pay ? ` (${meta.price} ₽)` : ''}.` }),
        err ? h('div', { class: 'error', text: err }) : null,
        h('button', { type: 'button', class: 'btn', id: 'create', text: editToken ? 'Сохранить изменения' : 'Создать приглашение 💌', on: { click: submit } }),
        h('div', { class: 'error', id: 'create-err' })];
    },
  };

  // ---------- проверка и отправка ----------
  function validateAll() {
    if (!cfg.toName.trim()) return 'Напишите, кого приглашаете (шаг «Кого зовём»).';
    if (!cfg.ask.title.trim()) return 'Напишите главный вопрос.';
    for (const [i, q] of cfg.choices.entries()) {
      if (q.items.filter((it) => it.name.trim()).length < 2) return `В вопросе ${i + 1} нужно хотя бы 2 варианта с названием.`;
    }
    return null;
  }
  async function submit() {
    const err = validateAll();
    if (err) { toast(err); return; }
    if (submitting) return;
    submitting = true;
    const btn = $('#create'), box = $('#create-err');
    btn.disabled = true; btn.textContent = 'Сохраняю…';
    const out = JSON.parse(JSON.stringify(cfg));
    out.ask.noLines = (cfg.ask.noLinesText || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8);
    delete out.ask.noLinesText;
    for (const q of out.choices) q.items = q.items.filter((it) => it.name.trim());
    try {
      const r = await fetch(editToken ? `/api/m/${editToken}` : '/api/inv', {
        method: editToken ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: out }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Не удалось сохранить');
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* пусто */ }
      location.href = `/m/${editToken || d.owner}${editToken ? '?saved=1' : '?new=1'}`;
    } catch (e) {
      box.textContent = e.message; submitting = false; btn.disabled = false; btn.textContent = editToken ? 'Сохранить изменения' : 'Создать приглашение 💌';
    }
  }

  // ---------- превью ----------
  const previewScreen = () => {
    const id = STEPS[stepIdx].id;
    if (id === 'who' || id === 'ask') return 'ask';
    if (id === 'gate' || id === 'done') return 'gate';
    if (id === 'confirm') return 'confirm';
    if (id === 'date') return cfg.date.enabled ? 'date' : 'confirm';
    if (id === 'choices') return cfg.choices.length ? 'choice' + Math.min(activeChoice, cfg.choices.length - 1) : 'confirm';
    return 'final';
  };
  function effectiveConfig() {
    const c = JSON.parse(JSON.stringify(cfg));
    c.ask.noLines = (cfg.ask.noLinesText || '').split('\n').map((x) => x.trim()).filter(Boolean);
    c.choices = c.choices.map((q) => ({ ...q, items: q.items.filter((it) => it.name.trim()) })).filter((q) => q.items.length >= 2);
    return c;
  }
  function refreshPreview(startAt) {
    const c = effectiveConfig();
    const tomorrow = new Date(Date.now() + 86400e3);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const target = startAt || (STEPS[stepIdx].id === 'choices' && cfg.choices.length ? 'choice' + Math.min(activeChoice, c.choices.length - 1) : previewScreen());
    if (player) player.destroy();
    player = Player.mount($('#phone'), c, {
      mode: 'preview', startAt: c.choices.some(() => true) || !String(target).startsWith('choice') ? target : 'confirm',
      demo: { date: c.date.enabled ? { date: iso, time: '19:00' } : null, picks: c.choices.map((q) => [q.items[0].name]) },
    });
  }

  // ---------- каркас ----------
  function renderDots() {
    const dots = $('#dots');
    dots.innerHTML = '';
    STEPS.forEach((s, i) => dots.append(h('button', {
      type: 'button', class: 'dot' + (i === stepIdx ? ' cur' : i < stepIdx ? ' done' : ''), title: s.name, 'aria-label': s.name, on: { click: () => goStep(i) },
    })));
    $('#stepname').textContent = `Шаг ${stepIdx + 1} из ${STEPS.length} · ${STEPS[stepIdx].name}`;
    $('#back').style.visibility = stepIdx === 0 ? 'hidden' : 'visible';
    $('#next').style.display = stepIdx === STEPS.length - 1 ? 'none' : '';
  }
  function renderPanel() {
    stopRecording(false);
    const panel = $('#panel');
    const keep = panel.scrollTop;
    panel.innerHTML = '';
    // поле «noLinesText» — служебное, хранится в самом конфиге до отправки
    if (cfg.ask.noLinesText == null) cfg.ask.noLinesText = (cfg.ask.noLines || []).join('\n');
    panel.append(...PANELS[STEPS[stepIdx].id]().filter(Boolean));
    panel.scrollTop = keep;
  }
  function goStep(i) {
    stopRecording(false);
    stepIdx = Math.max(0, Math.min(STEPS.length - 1, i));
    saveDraft(); renderDots(); renderPanel(); refreshPreview();
    $('#panel').scrollTop = 0;
  }

  $('#back').addEventListener('click', () => goStep(stepIdx - 1));
  $('#next').addEventListener('click', () => {
    if (STEPS[stepIdx].id === 'who' && !cfg.toName.trim()) { toast('Напишите, кого приглашаете'); $('#panel input')?.focus(); return; }
    goStep(stepIdx + 1);
  });
  $('#replay').addEventListener('click', () => refreshPreview());
  $('#playall').addEventListener('click', () => refreshPreview('gate'));
  $('#fab').addEventListener('click', () => $('.ed-preview').classList.add('open'));
  $('#closePreview').addEventListener('click', () => $('.ed-preview').classList.remove('open'));
  $('#reset').addEventListener('click', () => {
    if (editToken) { location.href = `/m/${editToken}`; return; }
    if (!confirm('Начать заново? Все введённые тексты пропадут.')) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* пусто */ }
    cfg = defaults(); activeChoice = 0; goStep(0);
  });

  async function init() {
    fetch('/api/meta').then((r) => r.json()).then((m) => { meta = m; if (STEPS[stepIdx].id === 'done') renderPanel(); }).catch(() => {});
    if (editToken) {
      const r = await fetch(`/api/m/${editToken}`);
      if (!r.ok) { document.body.innerHTML = '<p style="padding:40px;text-align:center">Приглашение не найдено</p>'; return; }
      cfg = Object.assign(defaults(), (await r.json()).config);
      stepIdx = 2;
      $('#reset').textContent = 'Отмена';
    } else {
      const d = loadDraft();
      if (d && d.cfg) { cfg = Object.assign(defaults(), d.cfg); stepIdx = Math.min(d.step || 0, STEPS.length - 1); }
      const q = (params.get('ask') || '').trim().slice(0, 140);
      if (q) cfg.ask.title = q;
      const th = params.get('theme');
      if (th && THEMES.some(([id]) => id === th)) cfg.theme = th;
      // параметры убираем из адреса, чтобы перезагрузка не затёрла правки
      if (params.has('ask') || params.has('theme')) history.replaceState(null, '', location.pathname);
    }
    goStep(stepIdx);
  }
  init();
})();
