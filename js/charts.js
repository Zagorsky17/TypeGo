/*
 * Простые SVG-графики без библиотек.
 */
(function () {
  const U = TG.Util;

  /**
   * Линейный график.
   * series: [{values:[число|null], cls:'s1', name}], labels: подписи точек (для подсказок)
   */
  function line(series, opts) {
    opts = opts || {};
    const W = opts.width || 640, H = opts.height || 200;
    const pad = { l: 36, r: 12, t: 12, b: 22 };
    const all = [];
    series.forEach(s => s.values.forEach(v => { if (v != null) all.push(v); }));
    if (!all.length) return '<div class="chart-empty">' + U.esc(opts.empty || '—') + '</div>';
    let min = opts.min != null ? opts.min : Math.min.apply(null, all);
    let max = opts.max != null ? opts.max : Math.max.apply(null, all);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    const n = Math.max(...series.map(s => s.values.length));
    const x = i => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : i * (W - pad.l - pad.r) / (n - 1));
    const y = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    const out = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">'];
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = min + (max - min) * i / ticks;
      const yy = y(v);
      out.push('<line class="grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '"/>');
      out.push('<text class="axis" x="' + (pad.l - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + Math.round(v) + '</text>');
    }
    series.forEach(s => {
      let d = '';
      s.values.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); });
      if (s.area && d) {
        const first = s.values.findIndex(v => v != null);
        const last = s.values.length - 1 - s.values.slice().reverse().findIndex(v => v != null);
        out.push('<path class="area ' + s.cls + '" d="' + d + 'L' + x(last) + ',' + (H - pad.b) + 'L' + x(first) + ',' + (H - pad.b) + 'Z"/>');
      }
      out.push('<path class="ln ' + s.cls + '" d="' + d + '"/>');
      if (n <= 60) {
        s.values.forEach((v, i) => {
          if (v == null) return;
          const lbl = opts.labels ? opts.labels[i] + ': ' : '';
          out.push('<circle class="pt ' + s.cls + '" cx="' + x(i) + '" cy="' + y(v) + '" r="3"><title>' + U.esc(lbl + (s.name ? s.name + ' ' : '') + v) + '</title></circle>');
        });
      }
    });
    if (opts.xLabels) {
      const step = Math.ceil(n / 8);
      for (let i = 0; i < n; i += step) {
        out.push('<text class="axis" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + U.esc(opts.xLabels[i]) + '</text>');
      }
    }
    out.push('</svg>');
    return out.join('');
  }

  /** Мини-график для карточек. */
  function spark(values, cls) {
    const v = values.filter(x => x != null);
    if (v.length < 2) return '';
    const W = 120, H = 32;
    const min = Math.min(...v), max = Math.max(...v) || 1;
    const rng = max - min || 1;
    const d = v.map((val, i) => (i ? 'L' : 'M') + (i * W / (v.length - 1)).toFixed(1) + ',' + (H - 3 - (val - min) / rng * (H - 6)).toFixed(1)).join('');
    return '<svg class="spark ' + (cls || '') + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + d + '"/></svg>';
  }

  /** Горизонтальные полосы (например, прогресс по пальцам). items: [{label, value 0..100, note}] */
  function bars(items) {
    return '<div class="bars">' + items.map(it =>
      '<div class="bar-row"><span class="bar-label">' + U.esc(it.label) + '</span>' +
      '<span class="bar-track"><span class="bar-fill ' + (it.cls || '') + '" style="width:' + (it.value == null ? 0 : U.clamp(it.value, 0, 100)) + '%"></span></span>' +
      '<span class="bar-val">' + (it.value == null ? '—' : Math.round(it.value)) + (it.note ? ' <small>' + U.esc(it.note) + '</small>' : '') + '</span></div>'
    ).join('') + '</div>';
  }

  TG.Charts = { line, spark, bars };
})();
