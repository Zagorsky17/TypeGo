/*
 * Библиотека текстов: встроенные тексты + тексты пользователя (хранятся вместе с прогрессом).
 */
(function () {
  const U = TG.Util;

  const Texts = {
    builtin(lang) {
      return TG.DATA[lang].texts.map(t => Object.assign({ builtin: true, lang }, t));
    },

    custom(lang) {
      return TG.Store.state.customTexts.filter(t => !lang || t.lang === lang);
    },

    all(lang) {
      return Texts.builtin(lang).concat(Texts.custom(lang));
    },

    byId(id) {
      return Texts.builtin('ru').concat(Texts.builtin('en'), Texts.custom()).find(t => t.id === id);
    },

    /** Добавить текст. Возвращает текст или {error: 'empty' | 'tooLong' | 'full'}. */
    add(title, body, lang) {
      const L = TG.CONFIG.TEXTS;
      body = U.normalizeText(body);
      if (!body) return { error: 'empty' };
      if (body.length > L.maxChars) return { error: 'tooLong' };
      const total = TG.Store.state.customTexts.reduce((n, x) => n + (x.body ? x.body.length : 0), 0);
      if (total + body.length > L.maxTotalChars) return { error: 'full' };
      const t = {
        id: 'c-' + Date.now().toString(36) + U.rand(1000),
        title: (title || '').trim() || body.slice(0, 40),
        body, lang: lang || TG.Layout.detect(body) || 'ru', added: Date.now()
      };
      TG.Store.state.customTexts.push(t);
      TG.Store.save();
      return t;
    },

    remove(id) {
      const st = TG.Store.state;
      st.customTexts = st.customTexts.filter(t => t.id !== id);
      ['ru', 'en'].forEach(l => { delete st.profiles[l].textPos[id]; });
      TG.Store.save();
    },

    sentences(body) {
      const out = [];
      const re = /[^.!?]+(?:[.!?]+["')]?|$)/g;
      let m;
      while ((m = re.exec(body))) {
        const s = m[0].trim();
        if (s) out.push(s);
        if (m[0] === '') break;
      }
      return out;
    },

    /** Фрагмент текста, продолжая с места, где пользователь остановился. */
    passageOf(profile, t, maxLen) {
      const sents = Texts.sentences(t.body);
      if (!sents.length) return t.body;
      let pos = profile.textPos[t.id] || 0;
      if (pos >= sents.length || sents.slice(pos).join(' ').length < maxLen * 0.4) pos = 0;
      let out = '';
      let i = pos;
      while (i < sents.length && (out.length < maxLen * 0.6 || !out)) {
        if (out && out.length + sents[i].length > maxLen) break;
        out += (out ? ' ' : '') + sents[i];
        i++;
      }
      profile.textPos[t.id] = i >= sents.length ? 0 : i;
      return out;
    },

    /** Подобрать текст под доступные клавиши. */
    passage(profile, lang, ctx, maxLen, easy) {
      const list = Texts.all(lang);
      let ok = list.filter(t => TG.Curriculum.textAllowed(t.body, ctx.set, lang));
      if (!ok.length) {
        // предложения, которые можно набрать
        const s = [];
        list.forEach(t => Texts.sentences(t.body).forEach(x => { if (TG.Curriculum.textAllowed(x, ctx.set, lang)) s.push(x); }));
        TG.DATA[lang].sentences.forEach(x => { if (TG.Curriculum.textAllowed(x, ctx.set, lang)) s.push(x); });
        if (s.length >= 3) return U.cutWords(U.shuffle(s).join(' '), maxLen);
        ok = list;
      }
      if (easy) ok = ok.slice().sort((a, b) => a.body.length - b.body.length).slice(0, Math.max(3, Math.ceil(ok.length / 2)));
      return Texts.passageOf(profile, U.pick(ok), maxLen);
    }
  };

  TG.Texts = Texts;
})();
