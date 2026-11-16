// Мини-приложение Telegram: распознаём запуск из бота и подключаем telegram-web-app.js только там
(function () {
  'use strict';
  var KEY = 'tolkoda:tg';
  var fromHash = /tgWebAppData=/.test(location.hash) || /tgWebAppData=/.test(location.search);
  var inside = fromHash;
  try { if (fromHash) sessionStorage.setItem(KEY, '1'); else inside = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* пусто */ }
  var TG = { inside: inside, app: null, initData: '' };
  TG.ready = !inside ? Promise.resolve(null) : new Promise(function (resolve) {
    var s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = function () {
      var w = window.Telegram && window.Telegram.WebApp;
      if (w) {
        try { w.ready(); w.expand(); } catch (e) { /* пусто */ }
        TG.app = w; TG.initData = w.initData || '';
        document.documentElement.classList.add('in-tg');
      }
      resolve(w || null);
    };
    s.onerror = function () { resolve(null); };
    document.head.appendChild(s);
  });
  // ссылку на t.me внутри Telegram открываем средствами Telegram
  TG.openTg = function (url) {
    if (TG.app && TG.app.openTelegramLink) { try { TG.app.openTelegramLink(url); return; } catch (e) { /* пусто */ } }
    window.open(url, '_blank', 'noopener');
  };
  window.TG = TG;
})();
