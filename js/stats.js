/*
 * Расчёт метрик сессии: CPM, WPM, точность, ошибки, исправления, время реакции, стабильность.
 */
(function () {
  const U = TG.Util;

  TG.Stats = {
    /**
     * events — массив нажатий {exp, got, ok, rt, t, retry}
     * meta — {correctChars, corrections, startT, endT}
     */
    summarize(events, meta, lang) {
      const C = TG.CONFIG.MASTERY;
      const durMs = Math.max(1, (meta.endT || 0) - (meta.startT || 0));
      const minutes = durMs / 60000;
      const total = events.length;
      const ok = events.filter(e => e.ok).length;
      const errors = total - ok;
      const cpm = meta.correctChars / minutes;
      const rts = events.filter(e => e.ok && !e.retry && e.rt > 0 && e.rt < C.rtCap).map(e => e.rt);
      const rtAvg = U.mean(rts);
      const cv = rtAvg ? U.std(rts) / rtAvg : 0;

      // скорость по отрезкам 5 секунд — для графика стабильности
      const timeline = [];
      const bucket = 5000;
      if (events.length) {
        const n = Math.ceil(durMs / bucket);
        for (let i = 0; i < n; i++) timeline.push(0);
        events.forEach(e => {
          if (!e.ok) return;
          const b = Math.min(n - 1, Math.floor((e.t - meta.startT) / bucket));
          if (b >= 0) timeline[b]++;
        });
        // хвост короче 5 секунд искажает скорость — нормируем
        for (let i = 0; i < n; i++) {
          const len = i === n - 1 ? (durMs - i * bucket) || bucket : bucket;
          timeline[i] = Math.round(timeline[i] / 5 * (60000 / Math.max(len, 1000)));
        }
      }
      const tlNonZero = timeline.length > 2 ? timeline.slice(0, -1) : timeline;
      const tlMean = U.mean(tlNonZero);
      const speedStability = tlMean ? U.clamp(100 * (1 - U.std(tlNonZero) / tlMean), 0, 100) : 0;

      // статистика по клавишам за сессию
      const perKey = {};
      events.forEach(e => {
        if (!e.exp || e.retry && e.ok) return;
        const k = TG.Layout.keyId(lang, e.exp);
        const s = perKey[k] || (perKey[k] = { n: 0, ok: 0, rts: [] });
        s.n++;
        if (e.ok) { s.ok++; if (e.rt > 0 && e.rt < C.rtCap) s.rts.push(e.rt); }
      });

      return {
        durationS: Math.round(durMs / 1000),
        cpm: Math.round(cpm),
        wpm: Math.round(cpm / 5 * 10) / 10,
        acc: total ? Math.round(ok / total * 1000) / 10 : 0,
        keystrokes: total,
        errors,
        corrections: meta.corrections || 0,
        rtAvg: Math.round(rtAvg),
        stability: Math.round(rts.length > 3 ? U.clamp(100 * (1 - cv), 0, 100) : 0),
        speedStability: Math.round(speedStability),
        timeline,
        perKey
      };
    },

    /** Сводка по истории сессий за последние n записей. */
    recentAverages(profile, n) {
      const s = profile.sessions.filter(x => !x.free && x.keystrokes > 20).slice(-(n || 10));
      return {
        wpm: Math.round(U.mean(s.map(x => x.wpm)) * 10) / 10,
        acc: Math.round(U.mean(s.map(x => x.acc)) * 10) / 10,
        count: s.length
      };
    },

    todaySeconds(state) {
      return state.dailyLog[U.today()] || 0;
    },

    /** Обновить серию занятий и дневной журнал. */
    registerPractice(state, seconds) {
      const day = U.today();
      state.dailyLog[day] = (state.dailyLog[day] || 0) + seconds;
      if (seconds < TG.CONFIG.SESSION.minSecondsForStreak && state.streak.lastDay !== day) {
        if (state.dailyLog[day] < TG.CONFIG.SESSION.minSecondsForStreak) return;
      }
      const st = state.streak;
      if (st.lastDay === day) return;
      st.current = st.lastDay === U.yesterday() ? st.current + 1 : 1;
      st.best = Math.max(st.best, st.current);
      st.lastDay = day;
    },

    /** Серия с учётом пропуска: если вчера и сегодня не занимались — 0. */
    currentStreak(state) {
      const st = state.streak;
      if (st.lastDay === U.today() || st.lastDay === U.yesterday()) return st.current;
      return 0;
    }
  };
})();
