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
      userChip() +
      '<button class="tool" data-action="layout-toggle" title="' + t('layoutBtn') + '">⌨ ' + st.layoutLang.toUpperCase() + '</button>' +
      '<button class="tool" data-action="uilang-toggle" title="' + t('uiLangBtn') + '">' + (st.uiLang === 'ru' ? 'RU' : 'EN') + '</button>' +
      '<button class="tool" data-action="theme-toggle" title="' + t('themeBtn') + '">◐</button>' +
      '<button class="tool save" data-action="save" title="' + t('saveProgress') + '">⤓ <span>' + t('saveProgress') + '</span></button>' +
      '</div>';
  }

  const dismissed = new Set();

  /** Баннер с проблемами хранилища — виден на любом экране. */
  function renderBanner() {
    const el = document.getElementById('banner');
    const E = TG.Util.esc;
    const list = TG.Store.issues.filter(k => !dismissed.has(k));
    el.hidden = !list.length;
    el.innerHTML = list.map(k => {
      let actions = '';
      if (k === 'conflict') actions = '<button class="btn primary sm" data-action="reload">' + E(t('reload')) + '</button>';
      else if (k === 'quota' || k === 'unavailable') actions = '<button class="btn primary sm" data-action="save">' + E(t('saveProgress')) + '</button>';
      if (k === 'corrupt' || k === 'quota') actions += '<button class="btn ghost sm" data-action="dismiss-issue:' + k + '">' + E(t('dismiss')) + '</button>';
      return '<div class="banner-item banner-' + k + '"><span>' + E(t('issue.' + k)) + '</span><span class="row">' + actions + '</span></div>';
    }).join('');
  }

  function dismissIssue(k) {
    dismissed.add(k);
    renderBanner();
  }

  function userChip() {
    const u = TG.Store.user();
    const name = TG.Store.userName(u);
    return '<button class="tool user-chip" data-nav="profiles" data-action="nav:profiles" title="' + t('profiles') + '">' +
      '<i class="avatar sm" style="background:' + TG.Util.esc(u.color) + '">' + TG.Util.esc(name.charAt(0).toUpperCase()) + '</i>' +
      '<span>' + TG.Util.esc(name) + '</span></button>';
  }

  /** Вариант русской раскладки из настроек (или определённый по нажатиям). */
  function applyVariant() {
    const st = TG.Store.settings();
    TG.Layout.setVariant('ru', st.ruVariant === 'auto' ? st.ruVariantDetected : st.ruVariant);
  }

  function applyPrefs() {
    const st = TG.Store.settings();
    applyVariant();
    TG.I18n.set(st.uiLang);
    applyTheme();
    document.title = 'TypeGo — ' + t('appTagline');
    renderHeader();
    renderBanner();
    TG.UI.rerender();
  }

  function start() {
    try {
      TG.Store.load();
    } catch (err) {
      // крайний случай: данные не удалось разобрать даже после проверки схемы
      console.error('TypeGo: load failed', err);
      TG.Store.index = { current: 'recovery', users: [{ id: 'recovery', name: '', color: '#6b7384', createdAt: Date.now(), lastActive: 0 }] };
      TG.Store.state = null;
    }
    if (!TG.Store.state) {
      TG.I18n.set((navigator.language || 'ru').slice(0, 2) === 'ru' ? 'ru' : 'en');
      TG.UI.init(document.getElementById('main'));
      TG.UI.renderRecovery(new Error('state unavailable'));
      return;
    }
    const st = TG.Store.settings();
    applyVariant();
    TG.I18n.set(st.uiLang);
    applyTheme();
    document.title = 'TypeGo — ' + t('appTagline');
    TG.UI.init(document.getElementById('main'));
    renderHeader();
    TG.Store.onIssue = kind => { if (kind) dismissed.delete(kind); renderBanner(); };
    TG.Store.onExternalChange = () => {
      const r = TG.UI.route();
      if (r !== 'session' && r !== 'results') applyPrefs(); // язык/тема/раскладка могли измениться
    };
    renderBanner();
    const routes = ['home', 'train', 'stats', 'texts', 'settings', 'profiles'];
    const r = (location.hash || '#home').slice(1);
    if (TG.Store.users().length > 1) TG.UI.pickProfile();
    else TG.UI.go(routes.indexOf(r) >= 0 ? r : 'home');
    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1);
      if (h && h !== TG.UI.route() && routes.indexOf(h) >= 0) TG.UI.go(h);
    });
  }

  TG.App = { applyPrefs, applyTheme, renderHeader, renderBanner, dismissIssue, start };
  document.addEventListener('DOMContentLoaded', start);
})();
