/*
 * Виртуальная клавиатура: палец и рука для каждой клавиши, статус освоения,
 * подсветка следующей клавиши, мягкая обратная связь при ошибке, heatmap.
 */
(function () {
  const U = TG.Util;

  const SPECIAL = {
    0: { after: [{ code: 'Backspace', label: '⌫', w: 2 }] },
    1: { before: [{ code: 'Tab', label: 'Tab', w: 1.5 }], lastW: 1.5 },
    2: { before: [{ code: 'CapsLock', label: 'Caps', w: 1.8 }], after: [{ code: 'Enter', label: 'Enter', w: 2.2 }] },
    3: { before: [{ code: 'ShiftLeft', label: 'Shift', w: 2.3 }], after: [{ code: 'ShiftRight', label: 'Shift', w: 2.7 }] }
  };

  function render(container, lang, options) {
    options = options || {};
    const lay = TG.Layout.get(lang);
    const html = ['<div class="kb" data-lang="' + lang + '">'];
    lay.rows.forEach((row, ri) => {
      html.push('<div class="kb-row">');
      const sp = SPECIAL[ri] || {};
      (sp.before || []).forEach(k => html.push(specialKey(k)));
      row.forEach((k, ci) => {
        const isLetter = lay.isLetter(k.n);
        const main = isLetter ? k.n.toUpperCase() : k.n;
        const shift = isLetter ? '' : k.s;
        const home = TG.Layout.HOME_CODES.indexOf(k.code) >= 0 && (k.code === 'KeyF' || k.code === 'KeyJ');
        const w = ci === row.length - 1 && sp.lastW ? sp.lastW : 1;
        html.push('<div class="key f-' + k.finger + (home ? ' bump' : '') + '" style="flex-grow:' + w + '" data-code="' + k.code +
          '" data-k="' + U.esc(k.n) + '"><span class="k-s">' + U.esc(shift) + '</span><span class="k-n">' + U.esc(main) +
          '</span><i class="k-dot"></i></div>');
      });
      (sp.after || []).forEach(k => html.push(specialKey(k)));
      html.push('</div>');
    });
    html.push('<div class="kb-row"><div class="key spacer" style="flex-grow:3.5"></div>' +
      '<div class="key f-th space" data-code="Space" data-k=" " style="flex-grow:6.5"><span class="k-n"></span><i class="k-dot"></i></div>' +
      '<div class="key spacer" style="flex-grow:3.5"></div></div>');
    html.push('</div>');
    container.innerHTML = html.join('');
    const root = container.firstElementChild;
    const byCode = {};
    root.querySelectorAll('.key[data-code]').forEach(el => { byCode[el.dataset.code] = el; });

    let errTimer = null;

    const kb = {
      root, byCode,
      clear() {
        root.querySelectorAll('.next').forEach(el => el.classList.remove('next'));
      },
      /** Подсветить клавишу для символа. hint=false — без подсветки (подсказка скрыта). */
      highlight(ch, hint) {
        kb.clear();
        if (ch == null || !hint) return null;
        const info = lay.byChar[ch];
        if (!info) return null;
        const el = byCode[info.code];
        if (el) el.classList.add('next');
        if (info.shift) {
          const sh = byCode[TG.Layout.shiftSide(lang, ch)];
          if (sh) sh.classList.add('next');
        }
        return info;
      },
      flashError(ch) {
        const info = lay.byChar[ch];
        if (!info) return;
        const el = byCode[info.code];
        if (!el) return;
        el.classList.remove('err');
        void el.offsetWidth;
        el.classList.add('err');
        clearTimeout(errTimer);
        errTimer = setTimeout(() => el.classList.remove('err'), 450);
      },
      press(code) {
        const el = byCode[code];
        if (!el) return;
        el.classList.add('down');
        setTimeout(() => el.classList.remove('down'), 110);
      },
      /** Статус освоения и постепенное скрытие подписей хорошо освоенных клавиш. */
      applyStatus(profile, th, fadeLabels) {
        root.querySelectorAll('.key[data-k]').forEach(el => {
          const k = TG.Layout.keyId(lang, el.dataset.k);
          const st = k === ' ' ? 'none' : TG.Mastery.status(profile, k, th);
          el.dataset.st = st;
          const fade = fadeLabels && k !== ' ' && TG.Mastery.score(profile, k) >= th.hintFadeMastery;
          el.classList.toggle('lbl-fade', !!fade);
        });
      },
      /** Heatmap: fn(key) → {v: 0..1 или null, title} */
      heatmap(fn) {
        root.classList.add('heat');
        root.querySelectorAll('.key[data-k]').forEach(el => {
          const k = TG.Layout.keyId(lang, el.dataset.k);
          const r = fn(k);
          if (!r || r.v == null) {
            el.style.removeProperty('--heat');
            el.classList.add('heat-none');
            el.title = r && r.title || '';
          } else {
            el.classList.remove('heat-none');
            el.style.setProperty('--heat', U.clamp(r.v, 0, 1).toFixed(3));
            el.title = r.title || '';
          }
        });
      }
    };
    return kb;
  }

  function specialKey(k) {
    return '<div class="key mod" style="flex-grow:' + k.w + '" data-code="' + k.code + '"><span class="k-n">' + k.label + '</span></div>';
  }

  /** Полоса пальцев с подсветкой активного. */
  function fingersBar(container, t) {
    const order = ['lp', 'lr', 'lm', 'li', 'th', 'ri', 'rm', 'rr', 'rp'];
    container.innerHTML = '<div class="fingers">' + order.map(f =>
      '<div class="finger f-' + f + '" data-f="' + f + '"><span></span><em>' + t('fingerShort.' + f) + '</em></div>').join('') + '</div>';
    const els = {};
    container.querySelectorAll('.finger').forEach(el => { els[el.dataset.f] = el; });
    return {
      set(f) {
        Object.keys(els).forEach(k => els[k].classList.toggle('active', k === f));
      }
    };
  }

  TG.Keyboard = { render, fingersBar };
})();
