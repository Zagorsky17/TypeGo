/* Небольшие вспомогательные функции. */
window.TG = window.TG || {};

TG.Util = {
  pad: n => (n < 10 ? '0' : '') + n,

  dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + TG.Util.pad(d.getMonth() + 1) + '-' + TG.Util.pad(d.getDate());
  },

  today() { return TG.Util.dateKey(new Date()); },

  yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return TG.Util.dateKey(d);
  },

  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),

  rand: n => Math.floor(Math.random() * n),

  pick: arr => arr[Math.floor(Math.random() * arr.length)],

  /** Взвешенный случайный выбор. items — массив, weightFn — функция веса. */
  weighted(items, weightFn) {
    if (!items.length) return undefined;
    let total = 0;
    const ws = items.map(it => { const w = Math.max(0, weightFn(it)); total += w; return w; });
    if (total <= 0) return TG.Util.pick(items);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  },

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  },

  mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; },

  std(arr) {
    if (arr.length < 2) return 0;
    const m = TG.Util.mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1));
  },

  median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  },

  /** Число для вывода: конечное число или значение по умолчанию (защита разметки от строк из данных). */
  num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : (d === undefined ? 0 : d);
  },

  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    return m + ':' + TG.Util.pad(sec % 60);
  },

  /** Нормализовать пользовательский текст к набираемому виду. */
  normalizeText(s) {
    return String(s).normalize('NFC')
      .replace(/[–—−]/g, '-')
      .replace(/[«»“”„]/g, '"')
      .replace(/[‘’‚]/g, "'")
      .replace(/…/g, '...')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Оставить в тексте только то, что можно набрать в раскладке lang.
   * Диакритика снимается, если без неё символ есть на клавиатуре (é → e), остальное удаляется
   * (эмодзи, символы других алфавитов). Перебор по кодовым точкам — эмодзи не режутся пополам.
   * Возвращает {text, changed} — changed: сколько символов заменено или удалено.
   */
  typeable(s, lang) {
    const lay = TG.Layout.get(lang);
    let out = '', changed = 0;
    for (const ch of TG.Util.normalizeText(s)) {
      if (ch === ' ' || lay.byChar[ch]) { out += ch; continue; }
      changed++;
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (base.length === 1 && lay.byChar[base]) out += base;
    }
    return { text: out.replace(/\s+/g, ' ').trim(), changed };
  },

  /** Ограничить строку по длине, не разрезая слова. */
  cutWords(s, max) {
    if (s.length <= max) return s;
    const cut = s.lastIndexOf(' ', max);
    return s.slice(0, cut > max * 0.5 ? cut : max);
  },

  el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
};
