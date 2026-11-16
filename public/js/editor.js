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
    'Куда пойдём': { title: 'Куда пойдём?', items: [['Парк', '🌳'], ['Ресторан', '🍽️'], ['Набережная', '🌅'], ['Уютный вечер дома', '🏠'], ['Кофейня', '☕'], ['Кино', '🎬']] },
    'Что поедим': { title: 'Что будем есть?', items: [['Пицца', '🍕'], ['Суши', '🍣'], ['Паста', '🍝'], ['Бургеры', '🍔'], ['Десерты', '🍰'], ['Стейк', '🥩']] },
    'Чем займёмся': { title: 'Чем займёмся?', items: [['Боулинг', '🎳'], ['Квест', '🧩'], ['Караоке', '🎤'], ['Настолки', '🎮'], ['Танцы', '💃'], ['Пикник', '🧺']] },
  };

  const defaults = () => ({
    toName: '', fromName: '', theme: 'pink', photo: '',
    gate: { type: 'envelope', text: '' },
    ask: { title: 'Пойдёшь со мной на свидание?', text: '', sticker: '🥺', yes: 'Да 💖', noLines: [], noMode: 'run', yesFx: 'burst' },
    confirm: { enabled: true, picture: 'sticker', photo: '', title: 'Ура! Лучший ответ на свете 💖', text: '', sticker: '🥰', button: 'Дальше' },
    date: { enabled: true, mode: 'ask', fixedDate: '', fixedTime: '', chat: true, picture: 'sticker', photo: '', title: 'Когда тебе удобно?', text: 'Выбери день и время — я подстроюсь.', sticker: '💘' },
    choices: [{ title: 'Куда пойдём?', multi: false, items: [{ name: 'Парк', emoji: '🌳' }, { name: 'Ресторан', emoji: '🍽️' }, { name: 'Набережная', emoji: '🌅' }, { name: 'Уютный вечер дома', emoji: '🏠' }, { name: 'Кофейня', emoji: '☕' }, { name: 'Кино', emoji: '🎬' }] }],
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
  let inlinePlayer = null;

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
    return h('div', { class: 'f' }, label ? h('span', { class: 'f-l', text: label }) : null,
      h('div', { class: 'emojis' }, STICKERS.map((e) => h('button', { type: 'button', class: 'emo' + (cur === e ? ' on' : ''), text: e, 'aria-label': e, on: { click: () => onPick(e) } })), own));
  }
  const NO_MODES = [
    ['run', '🏃', 'Убегает', 'не поймать'], ['shrink', '🤏', 'Уменьшается', '«Да» при этом растёт'],
    ['kiss', '💋', 'Уговаривает', 'поцелуи и «ну пожалуйста»'], ['turn', '🔄', 'Становится «Да»', 'после первого нажатия'],
    ['honest', '🙂', 'Честный ответ', 'можно отказаться'],
  ];
  const YES_FX = [['burst', '💥', 'Взрыв сердечек', ''], ['rain', '💕', 'Дождь из сердечек', ''], ['none', '➡️', 'Без анимации', '']];
  function optionGrid(label, path, list, def) {
    const cur = get(path) || def;
    return h('div', { class: 'f' }, h('span', { class: 'f-l', text: label }),
      h('div', { class: 'opts' }, list.map(([val, e, title, sub]) => h('button', {
        type: 'button', class: 'opt' + (cur === val ? ' on' : ''), 'aria-pressed': String(cur === val), on: { click: () => set(path, val, true) },
      }, h('span', { class: 'opt-e', text: e, 'aria-hidden': 'true' }), title, sub ? h('small', { text: sub }) : null))));
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
  async function uploadPhoto(file) {
    const blob = await prepareImage(file);
    const r = await fetch('/api/upload?kind=image', { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Не удалось загрузить');
    return d.file;
  }
  function photoField(path = 'photo', label = 'Фото (необязательно)') {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
    const status = h('span', { class: 'f-h' });
    const cur = get(path);
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      status.textContent = 'Загружаю…';
      try { set(path, await uploadPhoto(f), true); } catch (e) { status.textContent = e.message; }
    });
    return h('div', { class: 'f' }, label ? h('span', { class: 'f-l', text: label }) : null,
      cur
        ? h('div', { class: 'photo-row' }, h('img', { class: 'photo-thumb', src: `/u/${cur}`, alt: '' }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Убрать', on: { click: () => set(path, '', true) } }))
        : h('label', { class: 'btn btn-ghost btn-sm upload' }, '📷 Загрузить фото', input),
      h('span', { class: 'f-h', text: 'JPG, PNG, WebP или GIF' }),
      status);
  }

  function pictureField(base, defSticker) {
    const c = get(base);
    const pic = c.picture || 'sticker';
    const out = [h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Картинка' }),
      tabs([['sticker', '😊 Стикер'], ['photo', '📷 Своё фото'], ['none', 'Без картинки']], pic, (v) => set(`${base}.picture`, v, true)))];
    if (pic === 'sticker') out.push(emojiPicker('', c.sticker || defSticker, (e) => set(`${base}.sticker`, e, true)));
    if (pic === 'photo') out.push(photoField(`${base}.photo`, ''));
    return out;
  }

  // ---------- шаги ----------
  const PANELS = {
    who() {
      return [...panelHead('Кого зовём?', 'Имя увидит получатель — оно подставится в текст.'),
        textInput('toName', 'Кого приглашаете', { max: 40, ph: 'Аня' }),
        textInput('fromName', 'Ваше имя (необязательно)', { max: 40, ph: 'Саша' }),
        h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Оформление' }),
          h('div', { class: 'theme-cards' }, THEMES.map(([id, name]) => h('button', {
            type: 'button', class: 'tcard' + (cfg.theme === id ? ' on' : ''), 'aria-pressed': String(cfg.theme === id), on: { click: () => set('theme', id, true) },
          }, h('span', { class: 'pl tmini', 'data-theme': id, 'aria-hidden': 'true' },
            h('span', { class: 'tmini-h', text: '♥' }), h('span', { class: 'tmini-t' }),
            h('span', { class: 'tmini-b' }, h('span', { class: 'tmini-yes', text: 'Да' }), h('span', { class: 'tmini-no', text: 'Нет' }))),
          h('span', { class: 'tcard-n', text: name }))))),
        emojiPicker('Стикер на приглашении', cfg.ask.sticker, (e) => set('ask.sticker', e, true))];
    },
    gate() {
      return [...panelHead('Как откроется приглашение', 'Первое, что увидит получатель.'),
        h('div', { class: 'theme-cards two' }, [['envelope', 'Конверт', 'нужно нажать, чтобы открыть'], ['button', 'Кнопка «Открыть»', 'проще и быстрее']].map(([id, name, sub]) => h('button', {
          type: 'button', class: 'tcard' + (cfg.gate.type === id ? ' on' : ''), 'aria-pressed': String(cfg.gate.type === id), on: { click: () => set('gate.type', id, true) },
        }, h('span', { class: 'pl tmini gmini', 'data-theme': cfg.theme, 'aria-hidden': 'true' },
          id === 'envelope' ? h('span', { class: 'gmini-env' }, h('span', { class: 'gmini-seal', text: '♥' })) : [h('span', { class: 'gmini-e', text: '💌' }), h('span', { class: 'tmini-yes', text: 'Открыть' })]),
        h('span', { class: 'tcard-n', text: name }), h('small', { text: sub })))),
        textInput('gate.text', 'Подпись (необязательно)', { max: 80, ph: cfg.gate.type === 'button' ? 'Тебе письмо 💌' : 'Тебе письмо. Нажми на конверт 💌' })];
    },
    ask() {
      return [...panelHead('Главный вопрос', 'Сам вопрос и тёплые слова. Ниже выберите, как поведут себя кнопки «Да» и «Нет».'),
        textInput('ask.title', 'Вопрос', { max: 140 }),
        textArea('ask.text', 'Тёплые слова', { max: 500, ph: 'Давно хочу позвать тебя куда-нибудь вдвоём…', hint: 'Можно писать {имя} — подставится имя получателя' }),
        textInput('ask.yes', 'Текст кнопки «Да»', { max: 30 }),
        emojiPicker('Стикер', cfg.ask.sticker, (e) => set('ask.sticker', e, true)),
        photoField('photo', 'Фото (необязательно) — будет вместо стикера'),
        optionGrid('Что делает кнопка «Нет»', 'ask.noMode', NO_MODES, 'run'),
        ['run', 'kiss'].includes(cfg.ask.noMode || 'run')
          ? textArea('ask.noLinesText', 'Фразы на кнопке «Нет» (по одной в строке)', { max: 400, rows: 4, ph: cfg.ask.noMode === 'kiss' ? 'Нет\nНу пожалуйста 🥺\nПодумай ещё разок 💋' : 'Нет\nТочно?\nПодумай ещё', hint: 'Пусто — будут стандартные' })
          : null,
        cfg.ask.noMode === 'honest' ? h('p', { class: 'f-h', text: 'Получатель сможет ответить «нет» — вы увидите это на странице приглашения.' }) : null,
        optionGrid('Что делает кнопка «Да»', 'ask.yesFx', YES_FX, 'burst')];
    },
    confirm() {
      const c = cfg.confirm;
      const list = [...panelHead('Экран после «Да»', 'Короткая пауза после согласия — пошутить или порадоваться вместе.'),
        switchRow('confirm.enabled', 'Показывать этот экран', 'Можно выключить и сразу перейти дальше')];
      if (!c.enabled) return list;
      list.push(...pictureField('confirm', '🥰'));
      list.push(textInput('confirm.title', 'Заголовок', { max: 120, ph: 'Ура! Лучший ответ на свете 💖' }),
        textArea('confirm.text', 'Текст (необязательно)', { max: 400 }),
        textInput('confirm.button', 'Надпись на кнопке', { max: 30, ph: 'Дальше' }));
      return list;
    },
    date() {
      const d = cfg.date;
      const list = [...panelHead('Дата и время', 'Пусть получатель выберет удобное время — или назначьте сами.'),
        switchRow('date.enabled', 'Спрашивать дату и время')];
      if (!d.enabled) return list;
      list.push(h('div', { class: 'f' }, h('span', { class: 'f-l', text: 'Кто выбирает' }),
        tabs([['ask', 'Пусть выберет получатель'], ['fixed', 'Указать свои дату и время']], d.mode || 'ask', (v) => set('date.mode', v, true))));
      if (d.mode === 'fixed') {
        const di = h('input', { type: 'date', class: 'inp', value: d.fixedDate || '', 'aria-label': 'Дата встречи' });
        const ti = h('input', { type: 'time', class: 'inp', value: d.fixedTime || '', 'aria-label': 'Время встречи' });
        di.addEventListener('change', () => set('date.fixedDate', di.value));
        ti.addEventListener('change', () => set('date.fixedTime', ti.value));
        list.push(h('div', { class: 'row' }, field('Дата', di), field('Время (необязательно)', ti)),
          h('p', { class: 'f-h', text: 'Получатель увидит ваше время и нажмёт «Подходит».' }));
      }
      list.push(switchRow('date.chat', 'Кнопка «Решим в чате»', 'Если получатель пока не знает, когда свободен'));
      list.push(...pictureField('date', '💘'),
        textInput('date.title', 'Заголовок', { max: 120, ph: d.mode === 'fixed' ? 'Как тебе такое время?' : 'Когда тебе удобно?' }),
        textArea('date.text', 'Текст (необязательно)', { max: 300 }));
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
            on: { click: () => { cfg.choices.push({ title: p.title, multi: false, items: p.items.slice(0, 6).map(([n, e]) => ({ name: n, emoji: e })) }); activeChoice = cfg.choices.length - 1; changed(true); } },
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
      if (editToken) {
        return [...panelHead('Сохранить изменения', 'Изменения появятся в той же ссылке — отправлять заново не нужно.'),
          err ? h('div', { class: 'error', text: err }) : null,
          h('button', { type: 'button', class: 'btn', id: 'create', text: 'Сохранить изменения', on: { click: submit } }),
          h('div', { class: 'error', id: 'create-err' })];
      }
      const gets = [
        `Ссылку на приглашение — работает ${meta.days || 30} дней`,
        'Личную страницу с ответом: открыли ли, что выбрали, сколько раз пытались нажать «Нет»',
        meta.bot ? 'Ответ в Telegram — бот напишет, как только приглашение откроют и ответят' : null,
        'Возможность поправить приглашение и после отправки',
      ].filter(Boolean);
      return [...panelHead('Всё готово! 💌', 'Пройдите приглашение в превью целиком — так его увидит получатель.'),
        h('div', { class: 'sum-card' }, h('b', { text: 'Что вы получите' }),
          h('ul', { class: 'gets' }, gets.map((t) => h('li', { text: t })))),
        meta.bot ? h('div', { class: 'tg-how' },
          h('b', { text: 'Как получать ответ в Telegram' }),
          h('ol', {}, h('li', { text: 'Создайте приглашение.' }),
            h('li', { text: 'На странице приглашения нажмите «Получать ответ в Telegram».' }),
            h('li', {}, 'Откроется бот ', h('b', { text: '@' + meta.bot }), ' — нажмите «Запустить» (Start).')),
          h('p', { class: 'f-h', text: 'Готово: бот пришлёт сообщение, когда приглашение откроют и когда ответят — с датой и выбором.' })) : null,
        h('p', { class: 'f-h', text: meta.pay ? `Дальше — оплата ${meta.price} ₽, сразу после неё вы получите ссылку. Собрать и посмотреть — бесплатно.` : 'Дальше вы получите ссылку для отправки.' }),
        err ? h('div', { class: 'error', text: err }) : null,
        h('button', { type: 'button', class: 'btn', id: 'create', text: 'Создать приглашение 💌', on: { click: submit } }),
        h('div', { class: 'error', id: 'create-err' }),
        h('p', { class: 'f-h' }, 'Пользуясь сервисом, вы соглашаетесь с ', h('a', { href: '/privacy', target: '_blank', text: 'политикой конфиденциальности' }),
          ' и ', h('a', { href: '/consent', target: '_blank', text: 'обработкой персональных данных' }), '. Условия услуги — в ', h('a', { href: '/oferta', target: '_blank', text: 'публичной оферте' }), '.')];
    },
  };

  // ---------- проверка и отправка ----------
  function validateAll() {
    if (!cfg.toName.trim()) return 'Напишите, кого приглашаете (шаг «Кого зовём»).';
    if (!cfg.ask.title.trim()) return 'Напишите главный вопрос.';
    if (cfg.date.enabled && cfg.date.mode === 'fixed' && !cfg.date.fixedDate) return 'Укажите дату встречи (шаг «Дата и время»).';
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
      // в мини-приложении Telegram — подтверждение пользователя, чтобы сразу подключить уведомления
      const tg = !editToken && window.TG && window.TG.inside ? await Promise.race([window.TG.ready, new Promise((r) => setTimeout(r, 3000))]).then(() => window.TG.initData) : '';
      const r = await fetch(editToken ? `/api/m/${editToken}` : '/api/inv', {
        method: editToken ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tg ? { config: out, tg } : { config: out }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Не удалось сохранить');
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* пусто */ }
      if (!editToken) goal('create_done');
      setTimeout(() => { location.href = `/m/${editToken || d.owner}${editToken ? '?saved=1' : '?new=1'}`; }, editToken ? 0 : 300);
    } catch (e) {
      box.textContent = e.message; submitting = false; btn.disabled = false; btn.textContent = editToken ? 'Сохранить изменения' : 'Создать приглашение 💌';
    }
  }

  // ---------- превью ----------
  const previewScreen = () => {
    const id = STEPS[stepIdx].id;
    if (id === 'who' || id === 'ask') return 'ask';
    if (id === 'gate' || id === 'done') return 'gate';
    if (id === 'confirm') return cfg.confirm.enabled ? 'confirm' : 'ask';
    if (id === 'date') return cfg.date.enabled ? 'date' : 'ask';
    if (id === 'choices') return cfg.choices.length ? 'choice' + Math.min(activeChoice, cfg.choices.length - 1) : 'ask';
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
    if (inlinePlayer) { inlinePlayer.destroy(); inlinePlayer = null; }
    const shown = Player.screensOf(c);
    const opts = {
      mode: 'preview', startAt: shown.includes(target) ? target : 'ask',
      demo: { date: c.date.enabled ? { date: iso, time: '19:00' } : null, picks: c.choices.map((q) => [q.items[0].name]) },
    };
    player = Player.mount($('#phone'), c, opts);
    // на телефоне большого превью не видно — показываем мини-превью прямо под настройками
    const inline = $('#phoneInline');
    if (inline && window.matchMedia('(max-width: 900px)').matches) inlinePlayer = Player.mount(inline, c, opts);
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
    const panel = $('#panel');
    const keep = panel.scrollTop;
    panel.innerHTML = '';
    // поле «noLinesText» — служебное, хранится в самом конфиге до отправки
    if (cfg.ask.noLinesText == null) cfg.ask.noLinesText = (cfg.ask.noLines || []).join('\n');
    panel.append(...PANELS[STEPS[stepIdx].id]().filter(Boolean));
    panel.append(h('div', { class: 'inline-pv' }, h('div', { class: 'inline-pv-h', text: 'Так увидит получатель' }),
      h('div', { class: 'pv-phone mini' }, h('div', { class: 'pv-notch' }), h('div', { class: 'pv-screen', id: 'phoneInline' }))));
    panel.scrollTop = keep;
    // панель перерисована — мини-превью наполняем заново (вместе с большим, одним вызовом)
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => refreshPreview(), 0);
  }
  function goStep(i) {
    stepIdx = Math.max(0, Math.min(STEPS.length - 1, i));
    saveDraft(); renderDots(); renderPanel(); refreshPreview();
    $('#panel').scrollTop = 0;
  }

  $('#back').addEventListener('click', () => goStep(stepIdx - 1));
  const goal = (g, p) => { try { window.goal && window.goal(g, p); } catch (e) { /* без Метрики */ } };
  let started = false;
  $('#next').addEventListener('click', () => {
    if (!started && !editToken && STEPS[stepIdx].id === 'who' && cfg.toName.trim()) { started = true; goal('create_start'); }
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
