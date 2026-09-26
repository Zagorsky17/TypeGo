/*
 * Точка входа: загрузка данных, тема, язык, шапка и маршрутизация.
 */
(function () {
  const t = (k, p) => TG.I18n.t(k, p);

  function applyTheme() {
    const th = TG.Store.settings().theme;
    const root = document.documentElement;
    if (th === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', th);
  }

  function renderHeader() {
    const st = TG.Store.settings();
    const nav = ['home', 'train', 'stats', 'texts', 'settings'];
    document.getElementById('header').innerHTML =
      '<div class="brand" data-action="nav:home"><span class="logo">T<b>G</b></span><span class="brand-text"><b>TypeGo</b><small>' + t('appTagline') + '</small></span></div>' +
      '<nav class="nav">' + nav.map(n => '<button data-nav="' + n + '" data-action="nav:' + n + '">' + t('nav.' + n) + '</button>').join('') + '</nav>' +
      '<div class="tools">' +
      '<button class="tool" data-action="layout-toggle" title="' + t('layoutBtn') + '">⌨ ' + st.layoutLang.toUpperCase() + '</button>' +
      '<button class="tool" data-action="uilang-toggle" title="' + t('uiLangBtn') + '">' + (st.uiLang === 'ru' ? 'RU' : 'EN') + '</button>' +
      '<button class="tool" data-action="theme-toggle" title="' + t('themeBtn') + '">◐</button>' +
      '<button class="tool save" data-action="save" title="' + t('saveProgress') + '">⤓ <span>' + t('saveProgress') + '</span></button>' +
      '</div>';
  }

  function applyPrefs() {
    const st = TG.Store.settings();
    TG.I18n.set(st.uiLang);
    applyTheme();
    document.title = 'TypeGo — ' + t('appTagline');
    renderHeader();
    TG.UI.rerender();
  }

  function start() {
    TG.Store.load();
    const st = TG.Store.settings();
    TG.I18n.set(st.uiLang);
    applyTheme();
    document.title = 'TypeGo — ' + t('appTagline');
    TG.UI.init(document.getElementById('main'));
    renderHeader();
    const r = (location.hash || '#home').slice(1);
    TG.UI.go(['home', 'train', 'stats', 'texts', 'settings'].indexOf(r) >= 0 ? r : 'home');
    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1);
      if (h && h !== TG.UI.route() && ['home', 'train', 'stats', 'texts', 'settings'].indexOf(h) >= 0) TG.UI.go(h);
    });
  }

  TG.App = { applyPrefs, applyTheme, start };
  document.addEventListener('DOMContentLoaded', start);
})();
