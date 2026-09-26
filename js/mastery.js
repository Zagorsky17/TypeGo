/*
 * Mastery Score, анализ слабых мест и интервальное повторение.
 */
(function () {
  const U = TG.Util;
  const DAY = 86400000;

  function rec(profile, k) {
    return profile.keys[k] || (profile.keys[k] = { h: 0, e: 0, rec: [], last: 0, ease: TG.CONFIG.SRS.startEase, ivl: 0, reps: 0, due: 0 });
  }

  /** Подробный расчёт компонент Mastery для клавиши. */
  function components(r, now) {
    const M = TG.CONFIG.MASTERY;
    if (!r || !r.rec || !r.rec.length) return null;
    let wSum = 0, okSum = 0, w = 1;
    for (let i = r.rec.length - 1; i >= 0; i--) {
      wSum += w; okSum += w * r.rec[i][0];
      w *= M.decay;
    }
    const accuracy = okSum / wSum;
    const rts = r.rec.filter(x => x[0] && x[1] > 0).map(x => x[1]);
    const rtAvg = U.mean(rts);
    const speed = rts.length ? U.clamp((M.rtSlow - rtAvg) / (M.rtSlow - M.rtFast), 0, 1) : 0;
    const stability = rts.length > 3 ? U.clamp(1 - U.std(rts) / rtAvg, 0, 1) : 0;
    const volume = Math.min(1, r.h / M.volumeTarget);
    const days = r.last ? (now - r.last) / DAY : 0;
    const recency = Math.exp(-days / (Math.max(1, r.ivl || 1) * M.recencyK));
    const conf = Math.min(1, r.rec.length / M.confidenceN);
    const W = M.weights;
    const score = 100 * conf * (W.accuracy * accuracy + W.speed * speed + W.stability * stability + W.volume * volume + W.recency * recency);
    return { accuracy, speed, stability, volume, recency, conf, rtAvg, score: Math.round(score) };
  }

  const Mastery = {
    components: (profile, k) => components(profile.keys[k], Date.now()),

    score(profile, k) {
      const c = components(profile.keys[k], Date.now());
      return c ? c.score : 0;
    },

    /** Статус клавиши для раскраски: none | new | learning | good | mastered */
    status(profile, k, th) {
      const r = profile.keys[k];
      if (!r || !r.rec.length) return 'none';
      const s = Mastery.score(profile, k);
      if (s >= Math.max(90, th.masteredMastery)) return 'mastered';
      if (s >= 70) return 'good';
      if (s >= 40) return 'learning';
      return 'new';
    },

    /** Учесть нажатия сессии: клавиши, пары, последовательности, путаницы, интервалы повторения. */
    applySession(profile, events, lang) {
      const M = TG.CONFIG.MASTERY;
      const now = Date.now();
      const kid = ch => TG.Layout.keyId(lang, ch);
      const isGap = ch => !ch || ch === ' ';
      events.forEach(e => {
        if (!e.exp) return;
        const k = kid(e.exp);
        // повторные нажатия на той же позиции после ошибки (режим остановки на ошибке) в освоение
        // не идут: и исправление, и серия неверных нажатий — это одна ошибка, а не несколько
        if (e.retry) return;
        if (!e.ok && e.got) {
          const ck = k + '>' + e.got;
          profile.confusions[ck] = (profile.confusions[ck] || 0) + 1;
        }
        const r = rec(profile, k);
        if (e.ok) r.h++; else r.e++;
        r.rec.push([e.ok ? 1 : 0, e.ok && e.rt > 0 && e.rt < M.rtCap ? Math.round(e.rt) : 0]);
        if (r.rec.length > M.recentSize) r.rec.splice(0, r.rec.length - M.recentSize);
        r.last = now;
        if (!isGap(e.prev) && !isGap(e.exp)) {
          const bk = kid(e.prev) + kid(e.exp);
          const b = profile.bigrams[bk] || (profile.bigrams[bk] = { n: 0, e: 0, rt: 0 });
          b.n++;
          if (!e.ok) b.e++;
          else if (e.rt > 0 && e.rt < M.rtCap) b.rt = b.rt ? Math.round(b.rt * 0.8 + e.rt * 0.2) : Math.round(e.rt);
          if (!isGap(e.prev2)) {
            const tk = kid(e.prev2) + kid(e.prev) + kid(e.exp);
            const t = profile.trigrams[tk] || (profile.trigrams[tk] = { n: 0, e: 0 });
            t.n++;
            if (!e.ok) t.e++;
          }
        }
      });
      Mastery.updateSRS(profile, events, lang, now);
    },

    /** Упрощённый SM-2: интервал растёт, только если повторение пришлось на срок или позже. */
    updateSRS(profile, events, lang, now) {
      const S = TG.CONFIG.SRS;
      const per = {};
      events.forEach(e => {
        if (!e.exp || e.exp === ' ' || e.retry) return;
        const k = TG.Layout.keyId(lang, e.exp);
        const p = per[k] || (per[k] = { n: 0, ok: 0, rts: [] });
        p.n++;
        if (e.ok) { p.ok++; if (e.rt > 0 && e.rt < 2500) p.rts.push(e.rt); }
      });
      Object.keys(per).forEach(k => {
        const p = per[k];
        if (p.n < S.minPresses) return;
        const r = rec(profile, k);
        const acc = p.ok / p.n;
        const rt = U.mean(p.rts) || 9999;
        let q;
        if (acc >= 0.98 && rt < S.rtGood) q = 5;
        else if (acc >= 0.95) q = 4;
        else if (acc >= 0.9) q = 3;
        else if (acc >= 0.8) q = 2;
        else q = 1;
        const isDue = !r.due || now >= r.due - DAY / 2;
        if (q < 3) {
          r.reps = 0;
          r.ivl = 1;
          r.due = now + DAY;
        } else if (isDue) {
          r.reps++;
          r.ivl = r.reps === 1 ? 1 : r.reps === 2 ? 3 : Math.round(Math.max(1, r.ivl) * r.ease);
          r.due = now + r.ivl * DAY;
        }
        r.ease = Math.max(S.minEase, r.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      });
    },

    /** Клавиши, которые пора повторить. */
    dueKeys(profile, lang) {
      const now = Date.now();
      const set = TG.Curriculum.unlocked(profile, lang);
      return [...set].filter(k => k !== ' ' && profile.keys[k] && profile.keys[k].due && profile.keys[k].due <= now);
    },

    /** Слабые клавиши среди доступных, от самой слабой. */
    weakKeys(profile, lang, limit, th) {
      const set = TG.Curriculum.unlocked(profile, lang);
      const list = [...set].filter(k => k !== ' ' && k !== TG.Curriculum.SHIFT)
        .map(k => ({ k, s: Mastery.score(profile, k), practiced: !!(profile.keys[k] && profile.keys[k].rec.length) }))
        .sort((a, b) => a.s - b.s);
      return list.filter(x => x.s < th.weakMastery).slice(0, limit || 5);
    },

    masteredKeys(profile, lang, th) {
      const set = TG.Curriculum.unlocked(profile, lang);
      return [...set].filter(k => k !== ' ' && Mastery.score(profile, k) >= th.masteredMastery);
    },

    /** Средний Mastery по доступным клавишам. */
    overall(profile, lang) {
      const set = [...TG.Curriculum.unlocked(profile, lang)].filter(k => k !== ' ' && k !== TG.Curriculum.SHIFT);
      if (!set.length) return 0;
      return Math.round(U.mean(set.map(k => Mastery.score(profile, k))));
    },

    /** Статистика по пальцам. */
    fingerStats(profile, lang) {
      const lay = TG.Layout.get(lang);
      const res = {};
      TG.Layout.FINGERS.forEach(f => { res[f] = { f, scores: [], h: 0, e: 0, keys: [] }; });
      Object.keys(profile.keys).forEach(k => {
        const info = lay.byChar[k];
        if (!info) return;
        const r = profile.keys[k];
        const x = res[info.finger];
        x.h += r.h; x.e += r.e;
        if (r.rec.length) { x.scores.push(Mastery.score(profile, k)); x.keys.push(k); }
      });
      return TG.Layout.FINGERS.map(f => {
        const x = res[f];
        return {
          f,
          mastery: x.scores.length ? Math.round(U.mean(x.scores)) : null,
          errRate: x.h + x.e ? x.e / (x.h + x.e) : 0,
          presses: x.h + x.e,
          keys: x.keys
        };
      });
    },

    /** Слабые пальцы: ниже среднего на 10+ пунктов или с высокой долей ошибок. */
    weakFingers(profile, lang) {
      const fs = Mastery.fingerStats(profile, lang).filter(x => x.mastery !== null && x.f !== 'th' && x.presses >= 20);
      if (!fs.length) return [];
      const avg = U.mean(fs.map(x => x.mastery));
      return fs.filter(x => x.mastery < avg - 10 || x.errRate > 0.1).sort((a, b) => a.mastery - b.mastery).map(x => x.f);
    },

    /** Проблемные пары: много ошибок или заметно медленнее обычного. */
    problemBigrams(profile, lang, limit) {
      const set = TG.Curriculum.unlocked(profile, lang);
      const list = Object.keys(profile.bigrams).map(k => Object.assign({ k }, profile.bigrams[k]))
        .filter(b => b.n >= 5 && [...b.k].every(c => set.has(c)));
      const med = U.median(list.filter(b => b.rt).map(b => b.rt)) || 400;
      list.forEach(b => {
        b.errRate = b.e / b.n;
        b.slow = b.rt ? b.rt / med : 1;
        b.bad = b.errRate * 3 + Math.max(0, b.slow - 1);
      });
      return list.filter(b => b.errRate > 0.08 || b.slow > 1.5).sort((a, b) => b.bad - a.bad).slice(0, limit || 8);
    },

    problemTrigrams(profile, lang, limit) {
      const set = TG.Curriculum.unlocked(profile, lang);
      return Object.keys(profile.trigrams).map(k => Object.assign({ k }, profile.trigrams[k]))
        .filter(t => t.n >= 3 && t.e / t.n >= 0.2 && [...t.k].every(c => set.has(c)))
        .sort((a, b) => (b.e / b.n) * Math.log(b.n + 1) - (a.e / a.n) * Math.log(a.n + 1))
        .slice(0, limit || 6);
    },

    /** Частые путаницы клавиш: [{exp, got, n}] */
    topConfusions(profile, limit) {
      return Object.keys(profile.confusions)
        .map(k => ({ exp: k.split('>')[0], got: k.split('>').slice(1).join('>'), n: profile.confusions[k] }))
        .filter(c => c.n >= 2 && c.got !== ' ' && c.exp !== ' ')
        .sort((a, b) => b.n - a.n)
        .slice(0, limit || 6);
    },

    /** Вес клавиши для генератора упражнений. */
    weight(profile, k, ctx) {
      const G = TG.CONFIG.GENERATOR;
      const s = Mastery.score(profile, k);
      let w = G.baseWeight + Math.pow((100 - s) / 100, G.gamma);
      if (ctx.due && ctx.due.has(k)) w += G.dueBonus;
      if (ctx.fresh && ctx.fresh.has(k)) w += G.newBonus;
      if (ctx.fingers && ctx.fingers.size) {
        const info = TG.Layout.get(ctx.lang).byChar[k];
        if (info && ctx.fingers.has(info.finger)) w += G.fingerBonus;
      }
      return w;
    }
  };

  TG.Mastery = Mastery;
})();
