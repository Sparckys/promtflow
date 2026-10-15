// Convierte el texto del guion en secciones (una por diapositiva) y HTML para el teleprompter.
//   [Diapositiva 3] Título   |  [Slide 3] Title   |  # Título   →  nueva sección
//   ---                                                           →  nueva sección sin título
//   [PAUSA] / [PAUSE]                                             →  pausa automática
//   [mirar a cámara]                                              →  indicación (no se lee)
//   **texto**                                                     →  énfasis
(function () {
  const SLIDE_RE = /^\s*\[\s*(diapositiva|slide|secci[oó]n|section)\s*([^\]]*)\]\s*(.*)$/i;
  const HEADING_RE = /^\s*#{1,6}\s+(.+)$/;
  const BREAK_RE = /^\s*(-{3,}|={3,})\s*$/;
  const PAUSE_RE = /^\s*(pausa|pause)\s*$/i;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function parse(content) {
    const lines = String(content || '').replace(/\r/g, '').split('\n');
    const sections = [];
    let cur = { title: '', marker: '', paras: [], implicit: true };
    let para = [];

    const flushPara = () => {
      if (para.length) cur.paras.push(para.join(' ').trim());
      para = [];
    };
    const startSection = (marker, title) => {
      flushPara();
      if (!cur.implicit || cur.paras.length) sections.push(cur);
      cur = { title: title.trim(), marker: marker.trim(), paras: [], implicit: false };
    };

    for (const line of lines) {
      let m;
      if ((m = line.match(SLIDE_RE))) startSection(m[2], m[3]);
      else if ((m = line.match(HEADING_RE))) startSection('', m[1]);
      else if (BREAK_RE.test(line)) startSection('', '');
      else if (!line.trim()) flushPara();
      else para.push(line.trim());
    }
    flushPara();
    if (!cur.implicit || cur.paras.length) sections.push(cur);
    return sections;
  }

  function inline(text, t) {
    let h = esc(text);
    h = h.replace(/\[([^\]]+)\]/g, (_, inner) =>
      PAUSE_RE.test(inner)
        ? `<span class="cue cue-pause" data-pause="1">⏸ ${esc(t('pPauseCue'))}</span>`
        : `<span class="cue">${inner}</span>`
    );
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
    return h;
  }

  function toHtml(sections, t) {
    const total = sections.length;
    return sections
      .map((s, i) => {
        const num = String(i + 1).padStart(2, '0');
        const label = s.implicit ? t('start') : `${t('slide')} ${num} / ${String(total).padStart(2, '0')}`;
        const head = `<div class="sec-head"><span class="sec-num">${esc(label)}</span>${s.title ? `<span class="sec-title">${esc(s.title)}</span>` : ''}</div>`;
        const body = s.paras.map((p) => `<p>${inline(p, t)}</p>`).join('');
        return `<section class="sec" data-index="${i}">${head}${body}</section>`;
      })
      .join('');
  }

  // Palabras que realmente se leen (sin indicaciones ni marcas).
  function countWords(content) {
    const spoken = String(content || '')
      .split('\n')
      .filter((l) => !SLIDE_RE.test(l) && !HEADING_RE.test(l))
      .join(' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[*_#]/g, ' ');
    const m = spoken.match(/[\p{L}\p{N}'’-]+/gu);
    return m ? m.length : 0;
  }

  function sectionTitle(s, i, t) {
    if (s.implicit) return t('start');
    return `${t('slide')} ${i + 1}${s.title ? ' · ' + s.title : ''}`;
  }

  window.ScriptParser = { parse, toHtml, countWords, sectionTitle };
})();
