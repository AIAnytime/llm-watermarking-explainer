/* ============================================================================
   UI — every plate is wired to the real engine in 50-core.js
   ========================================================================== */
(function () {
'use strict';

const DEFAULT_KEY = 'anthropic-2026';
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------------------------------------------------------- chrome: theme */
(function theme() {
  const btn = document.getElementById('themeBtn');
  const effective = () => document.documentElement.getAttribute('data-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const paint = () => { btn.textContent = effective() === 'dark' ? 'Light' : 'Dark'; };
  btn.addEventListener('click', () => {
    document.documentElement.setAttribute('data-theme', effective() === 'dark' ? 'light' : 'dark');
    paint(); window.dispatchEvent(new Event('themechange'));
  });
  paint();
})();

/* ------------------------------------------------- chrome: progress + spy */
(function railspy() {
  const bar = document.getElementById('progress');
  const links = $$('#nav a');
  const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  let ticking = false;
  const upd = () => {
    ticking = false;
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    let cur = -1;
    targets.forEach((t, i) => { if (t.getBoundingClientRect().top < window.innerHeight * 0.35) cur = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === cur));
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
  upd();
})();

/* ============================================================ HERO — lamp */
(function lamp() {
  const host = document.getElementById('lampText');
  const body = host.parentElement;
  const glow = document.getElementById('lampGlow');
  const modeHost = document.getElementById('lampMode');
  const allBtn = document.getElementById('lampAll');
  const KEY = DEFAULT_KEY, GAMMA = 0.5, R = 150;

  const HUMAN = "I have never trusted the river, and I say so as someone who grew up two streets from it. My grandmother used to walk down at low tide to look at whatever the water had given back that week, and she came home each time with the same sentence about how nothing is ever really lost, only relocated. She was wrong about that, and she knew it, and she said it anyway, which is the part I have kept.";

  let mode = 'wm', revealAll = false, toks = [], rects = [], spans = [];

  function build() {
    if (mode === 'human') {
      toks = tokenize(HUMAN);
    } else {
      const g = generate({ grammar: 'prose', method: mode === 'wm' ? 'kgw' : 'none', key: KEY, gamma: GAMMA, delta: 4, layers: 3, temp: 1, length: 200, seed: 'hero-' + mode });
      toks = g.toks;
    }
    host.innerHTML = '';
    spans = [];
    for (let i = 0; i < toks.length; i++) {
      if (needsSpace(toks, i)) host.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      s.className = 'tk';
      s.textContent = toks[i];
      s.dataset.g = i > 0 && isGreen(KEY, ctxAt(toks, i, H_CTX), toks[i], GAMMA) ? '1' : '0';
      host.appendChild(s); spans.push(s);
    }
    const d = detectKGW(toks, KEY, GAMMA);
    document.getElementById('lampFrac').textContent = (d.frac * 100).toFixed(1) + '% of ' + d.n;
    const zEl = document.getElementById('lampZ');
    zEl.textContent = d.z.toFixed(2);
    zEl.style.color = d.z > 4 ? cssVar('--green') : d.z > 2 ? cssVar('--amber') : cssVar('--ink-2');
    document.getElementById('lampP').textContent = fmtP(d.p);
    requestAnimationFrame(measure);
    if (revealAll) paintAll();
  }
  function measure() {
    const bb = body.getBoundingClientRect();
    rects = spans.map(s => { const r = s.getBoundingClientRect(); return [r.left - bb.left + r.width / 2, r.top - bb.top + r.height / 2]; });
  }
  function paintAll() { spans.forEach(s => { s.className = 'tk ' + (s.dataset.g === '1' ? 'lit-g' : 'lit-r'); }); }
  function clearAll() { spans.forEach(s => { s.className = 'tk'; }); }

  body.addEventListener('pointermove', e => {
    if (revealAll) return;
    const bb = body.getBoundingClientRect();
    const x = e.clientX - bb.left, y = e.clientY - bb.top;
    glow.style.setProperty('--lx', x + 'px'); glow.style.setProperty('--ly', y + 'px');
    for (let i = 0; i < spans.length; i++) {
      const p = rects[i]; if (!p) continue;
      const on = (p[0] - x) ** 2 + (p[1] - y) ** 2 < R * R;
      spans[i].className = 'tk' + (on ? (spans[i].dataset.g === '1' ? ' lit-g' : ' lit-r') : '');
    }
    document.getElementById('lampHint').textContent = 'green-list words glow under the lamp';
  });
  body.addEventListener('pointerleave', () => { if (!revealAll) { glow.style.setProperty('--lx', '-999px'); clearAll(); } });

  allBtn.addEventListener('click', () => {
    revealAll = !revealAll;
    allBtn.setAttribute('aria-pressed', String(revealAll));
    allBtn.textContent = revealAll ? 'Use the lamp' : 'Reveal all';
    glow.style.opacity = revealAll ? '0' : '1';
    revealAll ? paintAll() : clearAll();
  });

  function bindModes() {
    segmented(modeHost, [
      { value: 'wm', label: 'Claude, watermarked' },
      { value: 'plain', label: 'Same model, no mark' },
      { value: 'human', label: 'Human writing' }
    ], mode, v => { mode = v; bindModes(); build(); });
  }
  bindModes();
  window.addEventListener('resize', measure);
  build();
})();

/* ================================================ PLATE A — one position */
(function plateA() {
  const POS = [
    { id: 'adj', label: 'Open adjective', ctx: 'the', item: '$ADJ_W',
      note: 'A genuinely free position. Eight words fit the slot and no reader would notice which one appeared. This is where a watermark lives.' },
    { id: 'verb', label: 'Open verb', ctx: 'river', item: '$V_MOVE',
      note: 'Same story. The model is not choosing between right and wrong here, it is choosing between eight defensible options — so the choice can be made to carry a secret.' },
    { id: 'hedge', label: 'Hedge word', ctx: 'is', item: '$FACT_ADV',
      note: 'A lopsided position: one option dominates. There is still room here, but only a fraction of a bit of it. Thousands of such positions are what actually carry a real watermark.' },
    { id: 'forced', label: 'Forced by fact', ctx: 'principia', item: 'Mathematica',
      note: 'Zero entropy. After "Newton’s principal work is the Principia" there is exactly one continuation. No key, no δ, no number of layers can influence this token — and the detector will still count it, diluting the evidence.' }
  ];
  let cur = POS[0], temp = 1;
  const selHost = document.getElementById('pAsel');

  function render() {
    const cands = slotDist(cur.item, temp);
    document.getElementById('pActx').innerHTML =
      '… <span style="color:var(--ink-3)">' + cur.ctx + '</span> <span style="color:var(--accent);border-bottom:2px solid var(--accent)">▮ next token</span>';
    const H = entropyBits(cands.map(c => c.p));
    const maxp = Math.max(...cands.map(c => c.p));

    const t = document.getElementById('pAtable');
    t.innerHTML = '<thead><tr><th>candidate</th><th class="r">p</th><th style="width:34%">distribution</th><th class="r">surprisal</th></tr></thead>';
    const tb = document.createElement('tbody');
    cands.slice().sort((a, b) => b.p - a.p).forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="k">' + c.tok + '</td><td class="r">' + c.p.toFixed(3) + '</td>' +
        '<td class="bar-cell"><div class="fill" style="width:' + (c.p / maxp * 100).toFixed(1) + '%"></div><span>&nbsp;</span></td>' +
        '<td class="r">' + Math.log2(1 / c.p).toFixed(2) + ' bits</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb);

    document.getElementById('pAtiles').innerHTML = [
      tile('candidates', cands.length, ''),
      tile('entropy H', H.toFixed(2), 'bits', H > 1.5 ? 'good' : H > 0.3 ? 'warn' : 'bad'),
      tile('effective choices', Math.pow(2, H).toFixed(1), '2^H'),
      tile('watermark room', H === 0 ? 'none' : H < 0.5 ? 'trace' : H < 1.5 ? 'some' : 'ample', '', H === 0 ? 'bad' : H < 0.5 ? 'warn' : 'good')
    ].join('');
    document.getElementById('pAnote').textContent = cur.note;
  }
  function bind() { segmented(selHost, POS.map(p => ({ value: p.id, label: p.label })), cur.id, v => { cur = POS.find(p => p.id === v); bind(); render(); }); }
  bind();
  bindRange('pAtemp', 'pAtempV', v => v.toFixed(2), v => { temp = v; render(); })();
})();

function tile(k, v, n, cls) {
  return '<div class="tile ' + (cls || '') + '"><span class="k">' + k + '</span><span class="v">' + v +
    (n ? ' <small>' + n + '</small>' : '') + '</span></div>';
}

/* ================================================ PLATE B — the green list */
(function plateB() {
  const VOCAB = ['the','river','light','town','quiet','drifted','morning','and','a','of','water','slowly','old','mist','bridge','carried','never','settled','through','grey','memory','autumn','stream','held','past','low','rain','turned','silence','evening','narrow','sun','village','pressed','while','fog','deepened','shallow','current','patient'];
  const state = { key: DEFAULT_KEY, ctx: 'river', gamma: 0.5, delta: 2 };

  function render() {
    const v = document.getElementById('pBvocab');
    v.innerHTML = '';
    let ng = 0;
    VOCAB.forEach(w => {
      const g = isGreen(state.key, state.ctx.toLowerCase(), w, state.gamma);
      if (g) ng++;
      const s = document.createElement('span');
      s.className = g ? 'g' : 'r'; s.textContent = w;
      v.appendChild(s);
    });

    const cands = slotDist('$ADJ_W', 1);
    const green = cands.map(c => isGreen(state.key, state.ctx.toLowerCase(), c.tok, state.gamma));
    const p = cands.map(c => c.p);
    const q = softmaxFromLogits(p.map((pi, i) => Math.log(pi) + (green[i] ? state.delta : 0)));

    barChart(document.getElementById('pBchart'), {
      width: 520, height: 232,
      series: [{ name: 'original p', color: cssVar('--s1') }, { name: 'after bonus', color: cssVar('--s2') }],
      groups: cands.map((c, i) => ({ label: c.tok, color: green[i] ? cssVar('--green') : cssVar('--ink-3'), values: [p[i], q[i]] })),
      yfmt: x => x.toFixed(2), tipfmt: x => x.toFixed(4), yLabel: 'probability'
    });

    let kl = 0; for (let i = 0; i < p.length; i++) if (q[i] > 0) kl += q[i] * Math.log2(q[i] / p[i]);
    let tv = 0; for (let i = 0; i < p.length; i++) tv += Math.abs(q[i] - p[i]); tv /= 2;
    const pGreenBefore = p.reduce((a, x, i) => a + (green[i] ? x : 0), 0);
    const pGreenAfter = q.reduce((a, x, i) => a + (green[i] ? x : 0), 0);

    document.getElementById('pBtiles').innerHTML = [
      tile('green words', ng + '/' + VOCAB.length, (ng / VOCAB.length * 100).toFixed(0) + '%'),
      tile('P(green) before', pGreenBefore.toFixed(3), ''),
      tile('P(green) after', pGreenAfter.toFixed(3), '', 'good'),
      tile('KL divergence', kl.toFixed(3), 'bits', kl > 0.25 ? 'bad' : kl > 0.05 ? 'warn' : 'good'),
      tile('total variation', tv.toFixed(3), '')
    ].join('');
    document.getElementById('pBnote').textContent = state.delta === 0
      ? 'δ = 0. The distribution is untouched and there is nothing to detect. Every scheme starts here and has to buy its way out.'
      : 'The bonus lifts P(green) from ' + pGreenBefore.toFixed(2) + ' to ' + pGreenAfter.toFixed(2) + '. Over 300 tokens that gap is overwhelming evidence — and it costs ' + kl.toFixed(3) + ' bits of divergence per token, paid by whoever reads the text.';
  }
  document.getElementById('pBkey').addEventListener('input', e => { state.key = e.target.value || ' '; render(); });
  document.getElementById('pBctx').addEventListener('input', e => { state.ctx = e.target.value || ' '; render(); });
  bindRange('pBgamma', 'pBgammaV', v => v.toFixed(2), v => { state.gamma = v; render(); })();
  bindRange('pBdelta', 'pBdeltaV', v => v.toFixed(1), v => { state.delta = v; render(); })();
  window.addEventListener('themechange', render);
})();

/* ================================================ PLATE C — detector bench */
const PlateC = (function plateC() {
  const HUMAN = "There is a particular kind of quiet that settles over a coastal town in the last week of the season, after the visitors have gone and before the weather turns properly hostile. The shops keep half-hours. The pier is closed for repairs that will not begin until spring. I walked out to the end of the sea wall on the Tuesday and found a man fishing with no bait on his hook, and when I asked him about it he said the fish were not the point, which struck me at the time as either very wise or very lazy, and I have never settled which.";
  let method = 'kgw', dedup = true;
  const cfg = () => ({ key: document.getElementById('pCkey').value || ' ', gamma: 0.5, layers: 3, dedup });
  const ta = document.getElementById('pCtext');

  function sample(kind) {
    const base = { grammar: 'prose', key: DEFAULT_KEY, gamma: 0.5, delta: 4, layers: 3, temp: 1, length: 260 };
    if (kind === 'human') { setMethod('kgw'); return HUMAN; }
    if (kind === 'plain') { setMethod('auto'); return joinTokens(generate(Object.assign({}, base, { method: 'none', seed: 'c-plain' })).toks); }
    if (kind === 'synth') { setMethod('synthid'); return joinTokens(generate(Object.assign({}, base, { method: 'synthid', seed: 'c-syn' })).toks); }
    const g = generate(Object.assign({}, base, { method: 'kgw', seed: 'c-wm' }));
    if (kind === 'wm') { setMethod('kgw'); return joinTokens(g.toks); }
    setMethod('kgw');
    return joinTokens(paraphrase(g.toks, kind === 'edited' ? 0.12 : 0.65, 'c').toks);
  }
  function setMethod(m) { method = m; bindMethod(); }
  function bindMethod() {
    segmented(document.getElementById('pCmethod'), [
      { value: 'kgw', label: 'Green list' }, { value: 'gumbel', label: 'Gumbel' },
      { value: 'synthid', label: 'SynthID' }, { value: 'auto', label: 'Try all' }
    ], method, v => { method = v; bindMethod(); run(); });
    segmented(document.getElementById('pCdedup'), [
      { value: 'on', label: 'Count once' }, { value: 'off', label: 'Count every token' }
    ], dedup ? 'on' : 'off', v => { dedup = v === 'on'; bindMethod(); run(); });
  }

  function run() {
    const toks = tokenize(ta.value);
    if (toks.length < 3) {
      document.getElementById('pCtiles').innerHTML = tile('tokens', toks.length, '');
      document.getElementById('pCstream').innerHTML = '<span class="faint small">Not enough text.</span>';
      setVerdict('miss', 'Paste at least a few sentences. Below about 40 tokens no threshold is meaningful.');
      return;
    }
    const c = cfg();
    const d = method === 'auto' ? detect('none', toks, c) : detect(method, toks, c);
    document.getElementById('pCtiles').innerHTML = [
      tile('tokens counted', d.n, 'of ' + toks.length),
      tile('repeats dropped', d.dups, dedup ? '' : 'rule off', dedup ? '' : 'warn'),
      tile(d.stat, d.frac.toFixed(4), 'exp ' + d.expected.toFixed(2)),
      tile('z-score', d.z.toFixed(2), '', d.z >= 4 ? 'good' : d.z >= 2 ? 'warn' : 'bad'),
      tile('p-value', fmtP(d.p), ''),
      tile('odds by chance', d.p > 0.5 ? 'even' : '1 in ' + shortNum(1 / d.p), '')
    ].join('');

    const st = document.getElementById('pCstream');
    st.innerHTML = '';
    for (let i = 0; i < toks.length; i++) {
      if (needsSpace(toks, i)) st.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      const v = i === 0 ? null : d.per[i - 1];
      s.className = 'tok' + (i === 0 ? ' dup' : v === null ? ' dup' : (v > d.expected ? ' det-g' : ' det-r'));
      s.textContent = toks[i];
      s.title = i === 0 ? 'no context yet — never counted'
        : v === null ? 'this context window + token already counted once'
        : d.stat + ' = ' + v.toFixed(3);
      st.appendChild(s);
    }

    if (d.z >= 5) setVerdict('hit', '<b>Strong evidence of this watermark.</b> A green count this extreme happens by chance about once in ' + shortNum(1 / d.p) + ' unmarked documents of this length. It says the key was involved in choosing these words — it does not say who wrote the document.');
    else if (d.z >= 3.5) setVerdict('warn', '<b>Suggestive, not conclusive.</b> z = ' + d.z.toFixed(2) + '. Consistent with a watermarked passage that was edited, or a shorter one — and also reachable by chance more often than most people would guess. Do not act on this alone.');
    else if (d.z >= 2) setVerdict('warn', '<b>Noise-adjacent.</b> z = ' + d.z.toFixed(2) + '. Roughly a 1-in-' + shortNum(1 / d.p) + ' fluctuation. Screen a thousand innocent documents and you will see several of these.');
    else setVerdict('miss', '<b>No watermark detected under this key and scheme.</b> That is the expected result for human writing, for other models, for unmarked output, for heavily rewritten text, and for anything short — a negative here carries almost no information.');
  }
  function setVerdict(cls, html) {
    const v = document.getElementById('pCverdict');
    v.className = 'verdict ' + cls;
    v.innerHTML = '<span class="dot"></span><span>' + html + '</span>';
  }

  /* the live chip only appears when a proxy is answering */
  fetch('/api/health').then(r => r.ok ? r.json() : Promise.reject()).then(h => {
    if (h.live) document.getElementById('pClive').hidden = false;
  }).catch(() => {});

  async function liveSample(btn) {
    const label = btn.textContent;
    btn.textContent = 'Fetching…'; btn.disabled = true;
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          prompt: 'Write two paragraphs of descriptive prose about a coastal town out of season.',
          k: 1, maxTokens: 400, temperature: 1
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      ta.value = d.candidates[0].text;
      setMethod('auto');
      run();
    } catch (e) {
      setVerdict('miss', '<b>Could not reach the model.</b> ' + String(e.message || e));
    } finally { btn.textContent = label; btn.disabled = false; }
  }

  $$('[data-samp]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.samp === 'live') return liveSample(b);
    ta.value = sample(b.dataset.samp); run();
  }));
  document.getElementById('pCrun').addEventListener('click', run);
  document.getElementById('pCkey').addEventListener('input', run);
  bindMethod();
  ta.value = sample('wm'); run();
  return { load(text, m) { ta.value = text; setMethod(m); run(); document.getElementById('pCtext').scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
})();

function shortNum(x) {
  if (!isFinite(x)) return '∞';
  if (x < 1000) return Math.round(x).toString();
  const e = Math.floor(Math.log10(x));
  if (e < 6) return Math.round(x).toLocaleString();
  return (x / Math.pow(10, e)).toFixed(1) + '×10' + sup(e);
}

/* ================================================ PLATE D — distortion */
(function plateD() {
  const ITEM = '$N_WATER';
  const state = { n: 8000, delta: 2, layers: 3, regime: 'varying' };
  const METHODS = [['none', 'unwatermarked control'], ['kgw', 'KGW green list'], ['gumbel', 'Gumbel-max'], ['synthid', 'SynthID tournament']];

  /* empirical frequencies for one method under one context regime */
  function empirical(m, regime, cands, n) {
    const K = cands.length, c = new Array(K).fill(0);
    for (let i = 0; i < n; i++) {
      const ctx = regime === 'fixed' ? 'the quiet river' : 'ctx' + i;
      const rec = step(m, cands, ctx, { key: DEFAULT_KEY, gamma: 0.5, delta: state.delta, layers: state.layers },
        mulberry32(hashStr(m + i, 99)));
      c[rec.idx]++;
    }
    return c.map(x => x / n);
  }
  const klOf = (q, p) => { let s = 0; for (let i = 0; i < p.length; i++) if (q[i] > 0) s += q[i] * Math.log2(q[i] / p[i]); return s; };
  const tvOf = (q, p) => { let s = 0; for (let i = 0; i < p.length; i++) s += Math.abs(q[i] - p[i]); return s / 2; };

  function run() {
    const cands = slotDist(ITEM, 1);
    const p = cands.map(c => c.p);
    const shown = {}, other = {};
    METHODS.forEach(([m]) => {
      shown[m] = empirical(m, state.regime, cands, state.n);
      other[m] = empirical(m, state.regime === 'fixed' ? 'varying' : 'fixed', cands, Math.min(state.n, 6000));
    });

    barChart(document.getElementById('pDchart'), {
      width: 680, height: 260,
      series: [
        { name: 'true p', color: cssVar('--s1') },
        { name: 'KGW δ=' + state.delta, color: cssVar('--s2') },
        { name: 'SynthID m=' + state.layers, color: cssVar('--s3') },
        { name: 'Gumbel', color: cssVar('--s4') }
      ],
      groups: cands.map((c, i) => ({ label: c.tok, values: [p[i], shown.kgw[i], shown.synthid[i], shown.gumbel[i]] })),
      yfmt: x => x.toFixed(2), tipfmt: x => x.toFixed(4), yLabel: 'frequency'
    });

    document.getElementById('pDtiles').innerHTML = [
      tile('KL · KGW', klOf(shown.kgw, p).toFixed(4), 'bits', klOf(shown.kgw, p) > 0.02 ? 'bad' : 'warn'),
      tile('KL · Gumbel', klOf(shown.gumbel, p).toFixed(4), 'bits', klOf(shown.gumbel, p) > 0.02 ? 'bad' : 'good'),
      tile('KL · SynthID', klOf(shown.synthid, p).toFixed(4), 'bits', klOf(shown.synthid, p) > 0.02 ? 'bad' : 'good'),
      tile('KL · noise floor', klOf(shown.none, p).toFixed(4), 'bits'),
      tile('samples', state.n.toLocaleString(), 'each')
    ].join('');

    document.getElementById('pDnote').textContent = state.regime === 'fixed'
      ? 'One context, sampled ' + state.n.toLocaleString() + ' times. Every scheme is visibly lopsided here, and Gumbel has collapsed onto a single token — with the key and the context both fixed there is no randomness left in it at all. Judged on this view alone you would call all three badly distorting.'
      : 'The same schemes, but the context changes at every draw, as it does in real text. Gumbel and the tournament have snapped back onto the true distribution; KGW has not, and will not, because its bonus always points the same way. That residue is what "distortion-free" is actually distinguishing.';

    const t = document.getElementById('pDtable');
    t.innerHTML = '<thead><tr><th>scheme</th><th class="r">KL at one context</th><th class="r">KL across contexts</th><th class="r">total variation</th><th>verdict</th></tr></thead>';
    const tb = document.createElement('tbody');
    const at = m => state.regime === 'fixed' ? shown[m] : other[m];
    const across = m => state.regime === 'fixed' ? other[m] : shown[m];
    METHODS.forEach(([m, label]) => {
      const kFix = klOf(at(m), p), kVar = klOf(across(m), p);
      const free = m !== 'kgw' && m !== 'none';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="k">' + label + '</td>' +
        '<td class="r">' + kFix.toFixed(4) + '</td><td class="r">' + kVar.toFixed(4) + '</td>' +
        '<td class="r">' + tvOf(across(m), p).toFixed(4) + '</td>' +
        '<td style="color:' + (m === 'none' ? 'var(--ink-3)' : free ? 'var(--green)' : 'var(--red)') + '">' +
        (m === 'none' ? 'baseline' : free ? 'distortion-free on average' : 'biased in both views') + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }
  function bindRegime() {
    segmented(document.getElementById('pDctx'), [
      { value: 'fixed', label: 'At one fixed context' }, { value: 'varying', label: 'Across many contexts' }
    ], state.regime, v => { state.regime = v; bindRegime(); run(); });
  }
  bindRegime();
  bindRange('pDn', 'pDnV', v => v.toLocaleString(), v => { state.n = v; });
  bindRange('pDdelta', 'pDdeltaV', v => v.toFixed(1), v => { state.delta = v; });
  bindRange('pDlayers', 'pDlayersV', v => v.toFixed(0), v => { state.layers = v; });
  document.getElementById('pDrun').addEventListener('click', run);
  window.addEventListener('themechange', run);
  run();
})();

/* ================================================ PLATE E — Gumbel */
(function plateE() {
  const CTXS = ['river', 'quiet', 'morning', 'the', 'bridge', 'mist', 'evening', 'town'];
  let asked = 0, lastWinner = null;

  function render() {
    const key = document.getElementById('pEkey').value || ' ';
    const ctx = (document.getElementById('pEctx').value || ' ').toLowerCase();
    const cands = slotDist('$N_WATER', 1);
    const p = cands.map(c => c.p);
    const r = cands.map(c => gumbelR(key, ctx, c.tok));
    const sc = r.map((ri, i) => Math.pow(ri, 1 / p[i]));
    let win = 0; for (let i = 1; i < sc.length; i++) if (sc[i] > sc[win]) win = i;
    const rank = p.slice().sort((a, b) => b - a).indexOf(p[win]) + 1;

    const t = document.getElementById('pEtable');
    t.innerHTML = '<thead><tr><th>candidate</th><th class="r">pᵢ</th><th class="r">rᵢ (from key)</th><th class="r">rᵢ^(1/pᵢ)</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    cands.forEach((c, i) => {
      const tr = document.createElement('tr');
      if (i === win) tr.className = 'win';
      tr.innerHTML = '<td class="k">' + c.tok + '</td><td class="r">' + p[i].toFixed(3) + '</td><td class="r">' + r[i].toFixed(4) +
        '</td><td class="r">' + sc[i].toExponential(2) + '</td><td>' + (i === win ? '← selected' : '') + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb);

    document.getElementById('pEtiles').innerHTML = [
      tile('selected', cands[win].tok, ''),
      tile('its probability', p[win].toFixed(3), 'rank ' + rank),
      tile('its r', r[win].toFixed(3), r[win] > 0.7 ? 'lucky draw' : 'ordinary'),
      tile('mean r', (r.reduce((a, b) => a + b, 0) / r.length).toFixed(3), 'null = 0.5')
    ].join('');

    if (lastWinner !== cands[win].tok) { asked = 0; document.getElementById('pEresampleOut').textContent = ''; }
    lastWinner = cands[win].tok;
  }
  document.getElementById('pEkey').addEventListener('input', render);
  document.getElementById('pEctx').addEventListener('input', render);
  document.getElementById('pEnudge').addEventListener('click', () => {
    document.getElementById('pEctx').value = CTXS[Math.floor(Math.random() * CTXS.length)];
    render();
  });
  document.getElementById('pEresample').addEventListener('click', () => {
    asked++;
    document.getElementById('pEresampleOut').textContent =
      'asked ' + (asked + 1) + '× → "' + lastWinner + '" every time';
  });
  render();
})();

/* ================================================ PLATE F — tournament */
(function plateF() {
  let layers = 2, seed = 19;   /* opens on a draw with a repeat entrant and one tie — both worth seeing */

  function render() {
    const key = document.getElementById('pFkey').value || ' ';
    const cands = slotDist('$N_WATER', 1);
    const p = cands.map(c => c.p);
    const ctx = 'river';
    const rng = mulberry32(hashStr('brk' + seed + layers + key, 4));
    const rec = step('synthid', cands, ctx, { key, gamma: .5, delta: 0, layers }, rng);
    const rounds = rec.detail.rounds;

    const host = document.getElementById('pFbracket');
    host.innerHTML = '';
    rounds.forEach((col, ri) => {
      const isLast = ri === rounds.length - 1;
      const c = document.createElement('div');
      c.className = 'bcol' + (isLast ? '' : ' has-next');
      const lab = document.createElement('div'); lab.className = 'clabel';
      lab.textContent = ri === 0 ? '2^' + layers + ' entries' : (isLast ? 'emitted' : 'after layer ' + ri);
      c.appendChild(lab);

      const mk = idx => {
        const n = document.createElement('div');
        const g = isLast ? null : gValue(key, ctx, cands[idx].tok, ri + 1);
        const advanced = isLast || rounds[ri + 1].indexOf(idx) >= 0;
        n.className = 'bnode' + (isLast ? ' w' : advanced ? ' adv' : ' l');
        n.innerHTML = '<span>' + cands[idx].tok + '</span><span class="gv">' +
          (g === null ? '✓ output' : 'g<sub>' + (ri + 1) + '</sub>=' + g) + '</span>';
        return n;
      };

      if (isLast) { col.forEach(idx => c.appendChild(mk(idx))); }
      else {
        /* group entrants two at a time — a pair IS a match */
        for (let i = 0; i < col.length; i += 2) {
          const pair = document.createElement('div'); pair.className = 'bpair';
          const a = col[i], b = col[i + 1];
          const ga = gValue(key, ctx, cands[a].tok, ri + 1), gb = gValue(key, ctx, cands[b].tok, ri + 1);
          const na = mk(a), nb = mk(b);
          if (ga === gb) {
            /* equal g-values: the key has no opinion, so the match is a fair coin */
            [na, nb].forEach(n => {
              n.classList.add('tied');
              n.title = 'equal g-values — this match was decided by a fair coin flip';
              n.querySelector('.gv').insertAdjacentHTML('beforeend', ' <span class="tie">⚖</span>');
            });
          }
          pair.appendChild(na); pair.appendChild(nb);
          c.appendChild(pair);
        }
      }
      host.appendChild(c);
    });

    const seats = new Array(cands.length).fill(0);
    rounds[0].forEach(i => seats[i]++);
    const share = seats.map(s => s / rounds[0].length);
    barChart(document.getElementById('pFchart'), {
      width: 520, height: 210,
      series: [{ name: 'true p', color: cssVar('--s1') }, { name: 'entry share', color: cssVar('--s3') }],
      groups: cands.map((c, i) => ({ label: c.tok, values: [p[i], share[i]] })),
      yfmt: x => x.toFixed(2), tipfmt: x => x.toFixed(3), yLabel: 'share'
    });

    document.getElementById('pFtiles').innerHTML = [
      tile('entries', 1 << layers, '2^' + layers),
      tile('bits per token', layers, 'g-values'),
      tile('winner', cands[rec.idx].tok, 'p = ' + p[rec.idx].toFixed(2)),
      tile('evidence gain', '×' + Math.sqrt(layers).toFixed(2), 'vs m=1')
    ].join('');
    document.getElementById('pFnote').textContent =
      'With m = ' + layers + ', each token contributes ' + layers + ' g-value bits to the detector instead of one, so the z-score for a given passage grows by roughly √' + layers + '. The generator pays ' + (1 << layers) + ' samples per token for it, and the output distribution does not move at all.';
    document.getElementById('pFentries').textContent = (1 << layers);
  }
  bindRange('pFlayers', 'pFlayersV', v => v.toFixed(0), v => { layers = v; render(); });
  document.getElementById('pFkey').addEventListener('input', render);
  document.getElementById('pFdraw').addEventListener('click', () => { seed++; render(); });
  window.addEventListener('themechange', render);
  render();
})();

/* ================================================ PLATE G — the lab */
(function plateG() {
  const state = { grammar: 'prose', method: 'synthid', len: 160, temp: 1, delta: 2, gamma: 0.5, layers: 3, seed: 1 };
  let last = null;

  function bindSegs() {
    segmented(document.getElementById('pGgram'),
      Object.keys(GRAMMARS).map(k => ({ value: k, label: GRAMMARS[k].label })), state.grammar,
      v => { state.grammar = v; bindSegs(); run(); });
    segmented(document.getElementById('pGmethod'), [
      { value: 'none', label: 'No watermark' }, { value: 'kgw', label: 'Green list' },
      { value: 'gumbel', label: 'Gumbel' }, { value: 'synthid', label: 'SynthID' }
    ], state.method, v => { state.method = v; bindSegs(); run(); });
  }

  function run() {
    const key = document.getElementById('pGkey').value || ' ';
    const g = generate({
      grammar: state.grammar, method: state.method, key, gamma: state.gamma, delta: state.delta,
      layers: state.layers, temp: state.temp, length: state.len, seed: 'lab' + state.seed
    });
    last = { g, key };
    const dm = state.method === 'none' ? 'synthid' : state.method;
    const d = detect(dm, g.toks, { key, gamma: state.gamma, layers: state.layers });
    const eff = g.steps.filter(s => !s.forced).length;
    const changed = g.steps.filter(s => s.changed).length;
    const meanH = g.steps.reduce((a, s) => a + s.entropy, 0) / g.steps.length;

    document.getElementById('pGtiles').innerHTML = [
      tile('tokens', g.toks.length, ''),
      tile('free positions', eff, (eff / g.toks.length * 100).toFixed(0) + '%'),
      tile('mean entropy', meanH.toFixed(2), 'bits'),
      tile('changed by key', changed, changed ? (changed / Math.max(1, eff) * 100).toFixed(0) + '% of free' : '—'),
      tile('z-score', d.z.toFixed(2), '', d.z >= 4 ? 'good' : d.z >= 2 ? 'warn' : 'bad'),
      tile('p-value', fmtP(d.p), '')
    ].join('');

    const st = document.getElementById('pGstream');
    st.className = 'stream' + (state.grammar === 'code' ? ' mono' : '');
    st.innerHTML = '';
    g.steps.forEach((s, i) => {
      if (s.tok === '\n') { st.appendChild(document.createElement('br')); return; }
      if (needsSpace(g.toks, i) && state.grammar !== 'code') st.appendChild(document.createTextNode(' '));
      else if (state.grammar === 'code' && needsSpace(g.toks, i)) st.appendChild(document.createTextNode(' '));
      const el2 = document.createElement('span');
      const v = i === 0 ? undefined : d.per[i - 1];
      let cls = 'tok';
      if (s.forced) cls += ' forced';
      if (v === null || v === undefined) cls += ' dup';
      else if (v > d.expected) cls += ' det-g';
      if (s.changed) cls += ' g';
      el2.className = cls;
      el2.textContent = s.display;
      el2.addEventListener('click', () => inspect(i, g, key, d));
      st.appendChild(el2);
    });
    inspect(g.steps.findIndex(s => !s.forced), g, key, d);
  }

  function inspect(i, g, key, d) {
    const host = document.getElementById('pGinspect');
    if (i < 0) { host.innerHTML = '<p class="small faint">No free positions in this passage — that is the finding.</p>'; return; }
    $$('#pGstream .tok').forEach(e => e.classList.remove('sel'));
    const nodes = $$('#pGstream .tok'); if (nodes[i]) nodes[i].classList.add('sel');
    const s = g.steps[i];
    const rows = s.cands.map((c, j) => {
      let extra = '';
      if (state.method === 'kgw' && s.detail.green) extra = s.detail.green[j] ? '<span style="color:var(--green)">green</span>' : '<span style="color:var(--red)">red</span>';
      else if (state.method === 'gumbel' && s.detail.r) extra = 'r=' + s.detail.r[j].toFixed(3);
      else if (state.method === 'synthid') { let bits = ''; for (let l = 1; l <= state.layers; l++) bits += gValue(key, s.ctx, c.tok, l); extra = 'g=' + bits; }
      return '<tr' + (j === s.idx ? ' class="win"' : '') + '><td class="k">' + c.tok + '</td><td class="r">' + c.p.toFixed(3) +
        '</td><td class="r">' + (s.pWm[j] !== undefined ? s.pWm[j].toFixed(3) : '—') + '</td><td>' + extra + '</td></tr>';
    }).join('');
    host.innerHTML =
      '<div class="eyebrow">position ' + i + ' · context “' + s.ctx + '”</div>' +
      '<div class="tblwrap"><table class="data"><thead><tr><th>candidate</th><th class="r">p</th><th class="r">p′</th><th>key says</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="mono tiny dim">entropy ' + s.entropy.toFixed(2) + ' bits · ' +
      (s.forced ? 'forced — no watermark possible here'
        : (s.changed ? '<span style="color:var(--green)">the key changed this outcome</span> (unwatermarked draw would have been “' + s.cands[s.plainIdx].tok + '”)'
          : 'same token an unwatermarked draw would have produced')) + '</div>';
  }

  document.getElementById('pGgen').addEventListener('click', () => { state.seed++; run(); });
  document.getElementById('pGkey').addEventListener('input', run);
  document.getElementById('pGsend').addEventListener('click', () => {
    if (!last) return;
    PlateC.load(joinTokens(last.g.toks), state.method === 'none' ? 'auto' : state.method);
    document.getElementById('pCkey').value = last.key;
    document.getElementById('pCkey').dispatchEvent(new Event('input'));
  });
  bindRange('pGlen', 'pGlenV', v => v.toFixed(0), v => { state.len = v; run(); });
  bindRange('pGtemp', 'pGtempV', v => v.toFixed(2), v => { state.temp = v; run(); });
  bindRange('pGdelta', 'pGdeltaV', v => v.toFixed(1), v => { state.delta = v; run(); });
  bindRange('pGgamma', 'pGgammaV', v => v.toFixed(2), v => { state.gamma = v; run(); });
  bindRange('pGlayers', 'pGlayersV', v => v.toFixed(0), v => { state.layers = v; run(); });
  bindSegs(); run();
})();

/* ================================================ PLATE H — capacity */
(function plateH() {
  let gram = 'prose';

  function measure() {
    const key = document.getElementById('pHkey').value || ' ';
    const g = generate({ grammar: gram, method: 'synthid', key, gamma: .5, delta: 2, layers: 3, temp: 1, length: 220, seed: 'cap' });
    const d = detectSynthID(g.toks, key, 3);
    const eff = g.steps.filter(s => !s.forced).length;
    const meanH = g.steps.reduce((a, s) => a + s.entropy, 0) / g.steps.length;

    /* entropy strip */
    const host = document.getElementById('pHstrip');
    host.innerHTML = '';
    const n = Math.min(g.steps.length, 200);
    const W = 1000, H = 96, bw = W / n;
    const svg = el('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' }, host);
    svg.style.height = '96px';
    const maxH = Math.max(1, ...g.steps.slice(0, n).map(s => s.entropy));
    el('line', { class: 'axis', x1: 0, x2: W, y1: H - 14, y2: H - 14 }, svg);
    for (let i = 0; i < n; i++) {
      const s = g.steps[i];
      const hh = (s.entropy / maxH) * (H - 22);
      const r = el('rect', { x: i * bw, y: H - 14 - hh, width: Math.max(0.8, bw - 0.8), height: Math.max(1, hh), fill: s.entropy > 0 ? cssVar('--s1') : cssVar('--axis'), rx: 1 }, svg);
      r.addEventListener('mousemove', e => tip('“' + s.display + '”<br>entropy <b>' + s.entropy.toFixed(2) + '</b> bits<br>' + (s.forced ? 'forced — zero capacity' : s.cands.length + ' candidates'), e.clientX, e.clientY));
      r.addEventListener('mouseleave', untip);
    }
    const lbl = el('text', { x: 2, y: H - 3, fill: cssVar('--ink-3') }, svg);
    lbl.textContent = 'first ' + n + ' tokens →  tall = free choice, flat = forced';

    /* comparison across text types */
    const vals = Object.keys(GRAMMARS).map(k => {
      const gg = generate({ grammar: k, method: 'synthid', key, gamma: .5, delta: 2, layers: 3, temp: 1, length: 800, seed: 'cmp' });
      return { label: GRAMMARS[k].label.split(' ')[0], z: detectSynthID(gg.toks, key, 3).z };
    });
    barChart(document.getElementById('pHchart'), {
      width: 520, height: 215,
      series: [{ name: 'z', color: cssVar('--s1') }],
      groups: vals.map(v => ({ label: v.label, values: [Math.max(0, v.z)] })),
      yfmt: x => x.toFixed(1), tipfmt: x => 'z = ' + x.toFixed(2), yLabel: 'z-score'
    });

    document.getElementById('pHtiles').innerHTML = [
      tile('tokens', g.toks.length, ''),
      tile('effective', eff, (eff / g.toks.length * 100).toFixed(0) + '%', eff / g.toks.length > 0.3 ? 'good' : 'bad'),
      tile('mean entropy', meanH.toFixed(2), 'bits'),
      tile('z reached', d.z.toFixed(2), '', d.z >= 4 ? 'good' : 'bad')
    ].join('');
    document.getElementById('pHnote').textContent = GRAMMARS[gram].note +
      ' Here ' + eff + ' of ' + g.toks.length + ' positions had any freedom at all, and the detector reached z = ' + d.z.toFixed(2) + '.';
  }
  function bind() { segmented(document.getElementById('pHgram'), Object.keys(GRAMMARS).map(k => ({ value: k, label: GRAMMARS[k].label })), gram, v => { gram = v; bind(); measure(); }); }
  bind();
  document.getElementById('pHrun').addEventListener('click', measure);
  document.getElementById('pHkey').addEventListener('input', measure);
  window.addEventListener('themechange', measure);
  measure();
})();

/* ================================================ PLATE I — attacks */
(function plateI() {
  const state = { method: 'synthid', attack: 'paraphrase', rate: 0.15, len: 300 };
  const KEY = DEFAULT_KEY, CFG = { key: KEY, gamma: 0.5, layers: 3 };

  const XL = t => { const u = norm(t); if (!/[a-z]/.test(u)) return t; return u.slice(0, 2) + 'ø' + u.slice(2).split('').reverse().join(''); };

  function adaptive(toks, rho, method, seed) {
    if (method === 'synthid') return layerInflation(toks, rho, KEY, CFG.layers, seed);
    const rng = mulberry32(hashStr('ad' + seed, 13));
    const out = [], edited = [];
    for (let i = 0; i < toks.length; i++) {
      const lower = norm(toks[i]); const alts = SYNS[lower];
      if (i > 0 && alts && alts.length && rng() < rho) {
        const ctx = ctxAt(out, i, H_CTX);
        const sc = t => method === 'kgw' ? (isGreen(KEY, ctx, t, CFG.gamma) ? 1 : 0) : gumbelR(KEY, ctx, t);
        let best = lower, bs = sc(lower);
        for (const a of alts) { const s = sc(a); if (s < bs) { bs = s; best = a; } }
        let b = best; if (/^[A-Z]/.test(toks[i])) b = b[0].toUpperCase() + b.slice(1);
        out.push(b); edited.push(norm(b) !== lower);
      } else { out.push(toks[i]); edited.push(false); }
    }
    return { toks: out, edited };
  }

  function attackOf(toks, rate, seed) {
    if (state.attack === 'paraphrase') return paraphrase(toks, rate, seed);
    if (state.attack === 'adaptive') return adaptive(toks, rate, state.method, seed);
    if (state.attack === 'truncate') {
      const k = Math.max(3, Math.round(toks.length * (1 - rate)));
      return { toks: toks.slice(0, k), edited: new Array(k).fill(false), truncated: toks.length - k };
    }
    /* translate: this fraction of the document was rendered by a different system */
    const k = Math.round(toks.length * rate);
    const out = toks.map((t, i) => i < k ? XL(t) : t);
    return { toks: out, edited: out.map((_, i) => i < k) };
  }

  function baseText(len) {
    return generate({ grammar: 'prose', method: state.method, key: KEY, gamma: .5, delta: 2.4, layers: CFG.layers, temp: 1, length: len, seed: 'atk' }).toks;
  }

  function run() {
    const base = baseText(state.len);
    const z0 = detect(state.method, base, CFG).z;
    const a = attackOf(base, state.rate, 'a');
    const z1 = detect(state.method, a.toks, CFG).z;
    const nEdit = a.edited.filter(Boolean).length;

    document.getElementById('pItiles').innerHTML = [
      tile('z before', z0.toFixed(2), '', 'good'),
      tile('z after', z1.toFixed(2), '', z1 >= 4 ? 'good' : z1 >= 2 ? 'warn' : 'bad'),
      tile('tokens touched', state.attack === 'truncate' ? (a.truncated + ' cut') : nEdit, state.attack === 'truncate' ? '' : (nEdit / base.length * 100).toFixed(0) + '%'),
      tile('evidence kept', Math.max(0, z1 / z0 * 100).toFixed(0) + '%', ''),
      tile('p after', fmtP(pOneSided(z1)), '')
    ].join('');

    const v = document.getElementById('pIverdict');
    let cls, msg;
    if (z1 >= 4) { cls = 'hit'; msg = '<b>Mark survives.</b> Still ' + z1.toFixed(1) + 'σ above chance after this much damage — copying, reformatting and light editing are simply not enough.'; }
    else if (z1 >= 2) { cls = 'warn'; msg = '<b>Mark is fading.</b> z = ' + z1.toFixed(2) + ' is in the zone where an honest analyst has to say "inconclusive" and stop.'; }
    else { cls = 'miss'; msg = '<b>Mark destroyed.</b> z = ' + z1.toFixed(2) + '. The text still means what it meant; the evidence does not exist any more. No key recovers it.'; }
    v.className = 'verdict ' + cls;
    v.innerHTML = '<span class="dot"></span><span>' + msg + '</span>';

    const st = document.getElementById('pIstream');
    st.innerHTML = '';
    a.toks.forEach((t, i) => {
      if (needsSpace(a.toks, i)) st.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      s.className = 'tok' + (a.edited[i] ? ' edited' : '');
      s.textContent = t; st.appendChild(s);
    });

    /* average over several attacker seeds — one run per rate is far too noisy
       to read a trend off, and the wobble is not a property of the attack */
    const pts = [];
    const SEEDS = 6;
    for (let r = 0; r <= 100; r += 5) {
      let acc = 0;
      for (let s = 0; s < SEEDS; s++) acc += detect(state.method, attackOf(base, r / 100, 'c' + s).toks, CFG).z;
      pts.push([r, Math.max(0, acc / SEEDS)]);
    }
    lineChart(document.getElementById('pIchart'), {
      width: 520, height: 230, labelRoom: 30,
      series: [{ name: '', color: cssVar('--s2'), points: pts, fill: true }],
      xTicks: [0, 25, 50, 75, 100], xfmt: v => v + '%', xLabel: 'attack strength',
      yLabel: 'z-score', yMin: 0, rules: [{ y: 4, label: 'z = 4' }]
    });
  }

  function bind() {
    segmented(document.getElementById('pImethod'), [
      { value: 'kgw', label: 'Green list' }, { value: 'gumbel', label: 'Gumbel' }, { value: 'synthid', label: 'SynthID' }
    ], state.method, v => { state.method = v; bind(); run(); });
    segmented(document.getElementById('pIattack'), [
      { value: 'paraphrase', label: 'Paraphrase' }, { value: 'adaptive', label: 'Adaptive (g-value aware)' },
      { value: 'truncate', label: 'Truncate' }, { value: 'translate', label: 'Translate' }
    ], state.attack, v => { state.attack = v; bind(); run(); });
  }
  bindRange('pIrate', 'pIrateV', v => v.toFixed(0) + '%', v => { state.rate = v / 100; run(); });
  bindRange('pIlen', 'pIlenV', v => v.toFixed(0), v => { state.len = v; run(); });
  bind(); run();
  window.addEventListener('themechange', run);
})();

/* ================================================ PLATE J — errors */
(function plateJ() {
  const state = { len: 200, thr: 4, frac: 1 };
  /* calibrate the achievable signal from a real 600-token watermarked passage */
  const REF_LEN = 600;
  const refZ = (function () {
    const g = generate({ grammar: 'prose', method: 'synthid', key: DEFAULT_KEY, gamma: .5, delta: 2, layers: 3, temp: 1, length: REF_LEN, seed: 'cal' });
    return detectSynthID(g.toks, DEFAULT_KEY, 3).z;
  })();

  const mu = () => refZ * Math.sqrt(state.len / REF_LEN) * state.frac;

  function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function run() {
    const N = 10000, nB = 56, lo = -4.5, hi = 13;
    const rng = mulberry32(4242);
    const a = new Array(nB).fill(0), b = new Array(nB).fill(0);
    const m = mu();
    const bin = z => Math.max(0, Math.min(nB - 1, Math.floor((z - lo) / (hi - lo) * nB)));
    for (let i = 0; i < N; i++) { a[bin(gauss(rng))]++; b[bin(gauss(rng) + m)]++; }

    histChart(document.getElementById('pJhist'), {
      width: 560, height: 235, nBins: nB,
      sets: [{ bins: a, color: cssVar('--s1') }, { bins: b, color: cssVar('--s2') }],
      xTicks: [[(0 - lo) / (hi - lo), '0'], [(4 - lo) / (hi - lo), '4'], [(8 - lo) / (hi - lo), '8'], [(12 - lo) / (hi - lo), '12']],
      marks: [{ pos: (state.thr - lo) / (hi - lo), label: 'threshold', color: cssVar('--accent') }],
      xLabel: 'z-score'
    });

    const fpr = pOneSided(state.thr);
    const tpr = 1 - normCdf(state.thr - m);
    document.getElementById('pJtiles').innerHTML = [
      tile('signal μ', m.toFixed(2), 'σ'),
      tile('detection rate', (tpr * 100).toFixed(1) + '%', 'true positives', tpr > 0.9 ? 'good' : tpr > 0.5 ? 'warn' : 'bad'),
      tile('false alarm rate', fmtP(fpr), '', fpr < 1e-4 ? 'good' : 'warn'),
      tile('per 1M documents', Math.round(fpr * 1e6).toLocaleString(), 'wrongly flagged'),
      tile('tokens needed', tokensFor(4).toLocaleString(), 'for z = 4')
    ].join('');

    const v = document.getElementById('pJverdict');
    let cls, msg;
    if (tpr > 0.95 && fpr < 1e-4) { cls = 'hit'; msg = '<b>Comfortable operating point.</b> ' + (tpr * 100).toFixed(0) + '% of marked documents caught, roughly ' + Math.round(fpr * 1e6).toLocaleString() + ' false alarms per million clean ones.'; }
    else if (tpr < 0.5) { cls = 'miss'; msg = '<b>The detector is mostly blind here.</b> Only ' + (tpr * 100).toFixed(0) + '% of genuinely watermarked documents clear the line. Lowering the threshold to fix that trades directly into false accusations.'; }
    else { cls = 'warn'; msg = '<b>The uncomfortable middle.</b> ' + (tpr * 100).toFixed(0) + '% caught, ' + Math.round(fpr * 1e6).toLocaleString() + ' false alarms per million. This is the regime most real documents sit in.'; }
    v.className = 'verdict ' + cls;
    v.innerHTML = '<span class="dot"></span><span>' + msg + '</span>';

    const mk = f => { const p = []; for (let L = 20; L <= 900; L += 20) p.push([L, refZ * Math.sqrt(L / REF_LEN) * f]); return p; };
    lineChart(document.getElementById('pJcurve'), {
      width: 1000, height: 240, labelRoom: 96,
      series: [
        { name: '100% model', color: cssVar('--s1'), points: mk(1) },
        { name: '50% model', color: cssVar('--s2'), points: mk(0.5) },
        { name: '25% model', color: cssVar('--s3'), points: mk(0.25) }
      ],
      xTicks: [20, 200, 400, 600, 800], xLabel: 'document length (tokens)', yLabel: 'expected z',
      yMin: 0, rules: [{ y: 4, label: 'z = 4 · 1 in 32,000' }, { y: 2, label: 'z = 2 · 1 in 44' }]
    });
  }
  function tokensFor(z) { return Math.ceil(REF_LEN * Math.pow(z / (refZ * state.frac), 2)); }

  bindRange('pJlen', 'pJlenV', v => v.toFixed(0), v => { state.len = v; run(); });
  bindRange('pJthr', 'pJthrV', v => v.toFixed(1), v => { state.thr = v; run(); });
  bindRange('pJfrac', 'pJfracV', v => v.toFixed(0) + '%', v => { state.frac = v / 100; run(); });
  run();
  window.addEventListener('themechange', run);
})();

/* ================================================ PLATE K — semantic */
(function plateK() {
  const cv = document.getElementById('pKcanvas');
  const ctx = cv.getContext('2d');
  const state = { key: DEFAULT_KEY, planes: 3, sigma: 0.15, seed: 1 };
  let pts = [];

  function resample() {
    const rng = mulberry32(hashStr('sem' + state.seed, 21));
    pts = [];
    const planes = lshPlanes(state.key, state.planes);
    let tries = 0;
    while (pts.length < 130 && tries < 60000) {
      tries++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.94;
      const p = [Math.cos(a) * r, Math.sin(a) * r];
      if (cellValid(lshCode(p, planes), state.key)) pts.push({ p, id: pts.length });
    }
  }

  function draw() {
    const W = cv.width, H = cv.height;
    const S = Math.min(W, H) / 2 - 16;
    const cx = W / 2, cy = H / 2;
    const planes = lshPlanes(state.key, state.planes);
    const toPx = p => [cx + p[0] * S, cy - p[1] * S];

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cssVar('--sheet-2'); ctx.fillRect(0, 0, W, H);

    /* shade valid cells */
    const img = ctx.getImageData(0, 0, W, H);
    const dat = img.data;
    const acc = hexToRgb(cssVar('--accent'));
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const px = (x - cx) / S, py = (cy - y) / S;
        if (px * px + py * py > 1) continue;
        if (cellValid(lshCode([px, py], planes), state.key)) {
          const i = (y * W + x) * 4;
          dat[i] = dat[i] + (acc[0] - dat[i]) * 0.16;
          dat[i + 1] = dat[i + 1] + (acc[1] - dat[i + 1]) * 0.16;
          dat[i + 2] = dat[i + 2] + (acc[2] - dat[i + 2]) * 0.16;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    /* boundary circle + hyperplanes */
    ctx.strokeStyle = cssVar('--rule'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, S, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = cssVar('--ink-3'); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    planes.forEach(pl => {
      const d = [-pl[1], pl[0]];
      const a = toPx([d[0] * 1.05, d[1] * 1.05]), b = toPx([-d[0] * 1.05, -d[1] * 1.05]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    ctx.setLineDash([]);

    /* sentences, before and after paraphrase */
    const rng = mulberry32(hashStr('mv' + state.seed + state.sigma, 33));
    let survived = 0;
    pts.forEach(o => {
      const a = rng() * Math.PI * 2, r = state.sigma * Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * 0.6;
      const q = [o.p[0] + Math.cos(a) * r, o.p[1] + Math.sin(a) * r];
      const ok = cellValid(lshCode(q, planes), state.key);
      if (ok) survived++;
      const A = toPx(o.p), B = toPx(q);
      ctx.strokeStyle = ok ? cssVar('--green') : cssVar('--red');
      ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar('--ink-3');
      ctx.beginPath(); ctx.arc(A[0], A[1], 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ok ? cssVar('--green') : cssVar('--red');
      ctx.beginPath(); ctx.arc(B[0], B[1], 3.4, 0, Math.PI * 2); ctx.fill();
    });

    const rate = pts.length ? survived / pts.length : 0;
    const cells = 1 << state.planes;
    document.getElementById('pKtiles').innerHTML = [
      tile('cells', cells, state.planes + ' planes'),
      tile('valid cells', cells / 2, '50%'),
      tile('sentences', pts.length, 'accepted'),
      tile('survive paraphrase', (rate * 100).toFixed(0) + '%', '', rate > 0.85 ? 'good' : rate > 0.6 ? 'warn' : 'bad'),
      tile('bits/sentence', '1', 'valid or not')
    ].join('');
    document.getElementById('pKnote').textContent =
      'At a displacement of ' + state.sigma.toFixed(2) + ', ' + (rate * 100).toFixed(0) + '% of sentences stay inside a valid cell — the mark survives a rewrite that would have wiped out every token-level scheme on this page. Push the planes up and the cells shrink: more capacity, more boundary, less robustness.';
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  document.getElementById('pKkey').addEventListener('input', e => { state.key = e.target.value || ' '; resample(); draw(); });
  bindRange('pKplanes', 'pKplanesV', v => v.toFixed(0), v => { state.planes = v; resample(); draw(); });
  bindRange('pKsigma', 'pKsigmaV', v => v.toFixed(2), v => { state.sigma = v; draw(); });
  document.getElementById('pKredraw').addEventListener('click', () => { state.seed++; resample(); draw(); });
  window.addEventListener('themechange', draw);
  resample(); draw();
})();

/* ================================================ PLATE L — multi-bit */
(function plateL() {
  const state = { payload: 22, len: 1200, delta: 3, noise: 0 };
  const NB = 8;
  const toBits = v => Array.from({ length: NB }, (_, i) => (v >> (NB - 1 - i)) & 1);
  const fromBits = b => b.reduce((a, x) => a * 2 + x, 0);

  function run() {
    const bits = toBits(state.payload);
    const g = generateMultibit({ bits, key: DEFAULT_KEY, gamma: 0.5, delta: state.delta, length: state.len, seed: 'mb' });
    const damaged = state.noise > 0 ? paraphrase(g.toks, state.noise, 'mbn').toks : g.toks;
    const dec = decodePayload(damaged, DEFAULT_KEY, 0.5, NB);
    const got = fromBits(dec.bits);
    const errs = dec.bits.reduce((a, b, i) => a + (b !== bits[i] ? 1 : 0), 0);

    document.getElementById('pLsent').innerHTML = bits.map(b => '<span style="color:var(--accent)">' + b + '</span>').join('');
    document.getElementById('pLsentN').textContent = 'decimal ' + state.payload;
    document.getElementById('pLgot').innerHTML = dec.bits.map((b, i) => '<span style="color:' + (b === bits[i] ? 'var(--green)' : 'var(--red)') + '">' + b + '</span>').join('');
    document.getElementById('pLgotN').textContent = 'decimal ' + got;
    const res = document.getElementById('pLres');
    res.textContent = errs === 0 ? 'recovered' : errs + ' bit error' + (errs > 1 ? 's' : '');
    res.style.color = errs === 0 ? cssVar('--green') : cssVar('--red');
    document.getElementById('pLresN').textContent = errs === 0
      ? g.toks.length + ' tokens carried 8 bits intact'
      : 'the payload is wrong — and nothing in the decoder announces that';

    barChart(document.getElementById('pLchart'), {
      width: 1000, height: 180,
      series: [{ name: 'slot confidence', color: cssVar('--s1') }],
      groups: dec.raw.map((b, i) => ({ label: (i % 3 === 1 ? 'b' + Math.floor(i / 3) : ''), values: [Math.abs((dec.vote[i][1] - dec.vote[i][0])) / Math.max(1, dec.vote[i][0] + dec.vote[i][1])] })),
      max: 1, yfmt: x => x.toFixed(1), tipfmt: x => 'margin ' + x.toFixed(3), yLabel: 'vote margin'
    });

    const st = document.getElementById('pLstream');
    st.innerHTML = '';
    damaged.forEach((t, i) => {
      if (needsSpace(damaged, i)) st.appendChild(document.createTextNode(' '));
      const s = document.createElement('span'); s.className = 'tok'; s.textContent = t; st.appendChild(s);
    });
  }
  bindRange('pLpayload', 'pLpayloadV', v => v.toFixed(0), v => { state.payload = v; });
  bindRange('pLlen', 'pLlenV', v => v.toFixed(0), v => { state.len = v; });
  bindRange('pLdelta', 'pLdeltaV', v => v.toFixed(1), v => { state.delta = v; });
  bindRange('pLnoise', 'pLnoiseV', v => v.toFixed(0) + '%', v => { state.noise = v / 100; });
  document.getElementById('pLrun').addEventListener('click', run);
  window.addEventListener('themechange', run);
  run();
})();

/* ================================================ PLATE N — live post-hoc
   The only plate that talks to a real model. Selection-based watermarking is
   the one construction on this page that works through a black-box API, so it
   is the one that can honestly be run for real.                              */
(function plateN() {
  const state = { model: null, seg: 4, k: 6, tok: 70, temp: 1 };
  let pool = null;                       /* [{text, toks, z, ...}] most recent run */

  const el2 = id => document.getElementById(id);
  const cfg = () => ({ key: el2('pNkey').value || ' ', gamma: 0.5, layers: 3 });

  /* ---- is there a proxy in front of us? ---- */
  fetch('/api/health').then(r => r.ok ? r.json() : Promise.reject())
    .then(h => {
      if (!h.live) throw new Error('no key');
      state.model = h.models[0].id;
      el2('pNstatus').textContent = h.models.length + ' models · key held server-side';
      el2('pNlive').hidden = false;
      bindModels(h.models);
      el2('pNk').max = h.maxK; el2('pNtok').max = h.maxTokens;
    })
    .catch(() => {
      el2('pNstatus').textContent = 'offline — browser-only mode';
      el2('pNoffline').hidden = false;
    });

  function bindModels(models) {
    segmented(el2('pNmodel'), models.map(m => ({ value: m.id, label: m.label })), state.model,
      v => { state.model = v; bindModels(models); });
  }

  function setVerdict(cls, html) {
    const v = el2('pNverdict');
    v.className = 'verdict ' + cls;
    v.innerHTML = '<span class="dot"></span><span>' + html + '</span>';
  }

  const detOf = (text, c) => detectSynthID(tokenize(text), c.key, c.layers);
  const paint = (host, text, c) => {
    const toks = tokenize(text), det = detectSynthID(toks, c.key, c.layers);
    host.innerHTML = '';
    toks.forEach((t, i) => {
      if (needsSpace(toks, i)) host.appendChild(document.createTextNode(' '));
      const v = i === 0 ? undefined : det.per[i - 1];
      const s = document.createElement('span');
      s.className = 'tok' + (v === null || v === undefined ? ' dup' : v > det.expected ? ' det-g' : ' det-r');
      s.textContent = t;
      host.appendChild(s);
    });
    return det;
  };

  async function run() {
    const btn = el2('pNrun');
    btn.disabled = true;
    el2('pNsend').disabled = true;
    const c = cfg();
    const prompt = el2('pNprompt').value;

    let sel = '', ctrl = '';            /* selected doc, and the no-selection control */
    let stoppedEarly = null;
    const track = [];                   /* per-segment z for both documents */
    let calls = 0, paidTokens = 0, lastPool = null;
    const t0 = Date.now();

    try {
      for (let s = 1; s <= state.seg; s++) {
        btn.textContent = 'Segment ' + s + '/' + state.seg + '…';
        setVerdict('warn', 'Requesting <b>' + state.k + '</b> continuations for segment <b>' + s + ' of ' + state.seg +
          '</b> — ' + calls + ' API calls so far.');

        const r = await fetch('/api/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: state.model, prompt, prefix: sel,
            k: state.k, maxTokens: state.tok, temperature: state.temp
          })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'request failed');
        if (d.finished || !d.candidates.length) { stoppedEarly = 'the model ended the answer'; break; }
        calls += d.candidates.length;
        paidTokens += d.candidates.reduce((a, x) => a + x.completionTokens, 0);

        /* score each continuation IN CONTEXT — the g-values depend on what came
           before, so a candidate is only meaningful appended to the prefix */
        const scored = d.candidates.map((cand, i) => {
          const joined = sel + (sel && !/\s$/.test(sel) ? ' ' : '') + cand.text.trim();
          return { i, text: cand.text.trim(), joined, z: detOf(joined, c).z };
        });
        const ranked = scored.slice().sort((a, b) => b.z - a.z);
        if (!ranked.length) { stoppedEarly = 'the model ended the answer'; break; }
        lastPool = ranked;

        sel = ranked[0].joined;
        /* the control takes an arbitrary draft from the very same pool */
        const pick = scored[0];
        ctrl = ctrl + (ctrl && !/\s$/.test(ctrl) ? ' ' : '') + pick.text;

        track.push({ s, sel: detOf(sel, c).z, ctrl: detOf(ctrl, c).z });
        render({ sel, ctrl, track, lastPool, calls, paidTokens, ms: Date.now() - t0, c });
      }
      pool = { sel, ctrl, track, lastPool, calls, paidTokens, ms: Date.now() - t0 };
      finish(pool, c);
      if (stoppedEarly) {
        const v = el2('pNverdict');
        v.insertAdjacentHTML('beforeend',
          '<span class="tiny faint mono" style="display:block;margin-top:6px">Ran ' + track.length +
          ' of ' + state.seg + ' segments — ' + stoppedEarly + '. Ask for a longer piece to use every segment.</span>');
      }
    } catch (e) {
      const msg = String(e.message || e);
      const rate = /rate limit|429/i.test(msg);
      if (track.length) {
        /* keep what we already selected — a short run is still a real result */
        pool = { sel, ctrl, track, lastPool, calls, paidTokens, ms: Date.now() - t0 };
        finish(pool, c);
        setVerdict('warn', '<b>Stopped after ' + track.length + ' of ' + state.seg + ' segments.</b> ' +
          (rate ? 'The provider rate-limited us — selection watermarking fires S×k requests for a single answer, which is exactly the cost this plate exists to show. Lower k or the segment count, or wait a minute.' : msg) +
          ' The results below are real, just shorter than requested.');
      } else {
        setVerdict('miss', '<b>Live request failed.</b> ' + msg +
          ' — every other plate on this page runs in the browser and is unaffected.');
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Generate & mark';
    }
  }

  function render(r) {
    const c = r.c;
    const dSel = paint(el2('pNstream'), r.sel, c);
    const dCtrl = paint(el2('pNbase'), r.ctrl, c);

    el2('pNtiles').innerHTML = [
      tile('segments done', r.track.length, 'of ' + state.seg),
      tile('API calls', r.calls, state.k + '/segment'),
      tile('selected z', dSel.z.toFixed(2), '', dSel.z >= 4 ? 'good' : dSel.z >= 2 ? 'warn' : 'bad'),
      tile('control z', dCtrl.z.toFixed(2), 'no selection'),
      tile('gain', '+' + (dSel.z - dCtrl.z).toFixed(2), 'σ'),
      tile('tokens counted', dSel.n, ''),
      tile('tokens paid for', r.paidTokens.toLocaleString(), '≈' + Math.round(r.paidTokens / Math.max(1, dSel.n)) + '× shipped'),
      tile('wall clock', (r.ms / 1000).toFixed(1) + 's', '')
    ].join('');

    lineChart(el2('pNcurve'), {
      width: 520, height: 230, labelRoom: 74,
      xMin: 0,
      yMin: Math.min(-1.2, ...r.track.map(t => t.ctrl)),
      /* always keep the z = 4 rule on screen — it is the reference the eye needs */
      yMax: Math.max(4.6, ...r.track.map(t => t.sel)) * 1.1,
      series: [
        { name: 'selected', color: cssVar('--s1'), points: [[0, 0]].concat(r.track.map(t => [t.s, t.sel])), fill: true },
        { name: 'control', color: cssVar('--s2'), points: [[0, 0]].concat(r.track.map(t => [t.s, t.ctrl])) }
      ],
      xTicks: r.track.map(t => t.s), xLabel: 'segments selected', yLabel: 'document z',
      rules: [{ y: 4, label: 'z = 4' }]
    });

    if (r.lastPool) {
      barChart(el2('pNpool'), {
        width: 520, height: 200,
        series: [{ name: 'z', color: cssVar('--s1') }],
        groups: r.lastPool.map((x, i) => ({
          label: i === 0 ? '★ kept' : '#' + (i + 1),
          color: i === 0 ? cssVar('--green') : cssVar('--ink-3'),
          values: [Math.max(0, x.z)]
        })),
        yfmt: v => v.toFixed(1), tipfmt: v => 'z = ' + v.toFixed(2), yLabel: 'z if kept'
      });
    }
  }

  function finish(r, c) {
    const dSel = detOf(r.sel, c), dCtrl = detOf(r.ctrl, c);
    const strong = dSel.z >= 4;
    setVerdict(strong ? 'hit' : dSel.z >= 2 ? 'warn' : 'miss',
      strong
        ? '<b>A real model, really marked — without touching it.</b> The selected document scores z = ' + dSel.z.toFixed(2) +
          ' (p = ' + fmtP(dSel.p) + ') while the control built from the same candidate pools sits at ' + dCtrl.z.toFixed(2) +
          '. Every word came from the model; the only thing the key did was decide <i>which draft survived each of the ' +
          r.track.length + ' rounds</i>.'
        : '<b>Marked, but not decisively — and that is the honest outcome.</b> z = ' + dSel.z.toFixed(2) +
          ' against a control of ' + dCtrl.z.toFixed(2) + '. Selection can only exploit variation the model actually produced. ' +
          'Raise the segment count (the gain compounds as √S) before raising k (which only buys √ln k).');

    el2('pNnote').innerHTML =
      'Cost accounting, which is the part that decides whether this is deployable: <b>' + r.calls + ' API calls</b> and <b>' +
      r.paidTokens.toLocaleString() + ' generated tokens</b> to ship <b>' + dSel.n + '</b> scored ones — a ' +
      Math.round(r.paidTokens / Math.max(1, dSel.n)) + '× multiple on inference spend, to buy ' +
      (dSel.z - dCtrl.z).toFixed(1) + 'σ of evidence. That is the whole trade of post-hoc watermarking, and it is why providers ' +
      'who <i>can</i> reach the sampling loop (Google, Anthropic) use the tournament instead: the same evidence for zero extra tokens. ' +
      'Try the low-entropy prompt — when every draft says nearly the same thing, there is nothing to select between and the two lines converge.';

    el2('pNsend').disabled = false;
    el2('pNsend').onclick = () => {
      PlateC.load(r.sel, 'synthid');
      el2('pCkey').value = cfg().key;
      el2('pCkey').dispatchEvent(new Event('input'));
    };
  }

  $$('[data-nprompt]').forEach(b => b.addEventListener('click', () => { el2('pNprompt').value = b.dataset.nprompt; }));
  el2('pNrun').addEventListener('click', run);
  el2('pNkey').addEventListener('input', () => { if (pool) { render(Object.assign({}, pool, { c: cfg() })); finish(pool, cfg()); } });
  bindRange('pNseg', 'pNsegV', v => v.toFixed(0), v => { state.seg = v; });
  bindRange('pNk', 'pNkV', v => v.toFixed(0), v => { state.k = v; });
  bindRange('pNtok', 'pNtokV', v => v.toFixed(0), v => { state.tok = v; });
  bindRange('pNtemp', 'pNtempV', v => v.toFixed(2), v => { state.temp = v; });
})();

/* ================================================ PLATE M — claims */
(function plateM() {
  const state = { z: 4.5, len: 450, edit: 'unknown' };

  function run() {
    const p = pOneSided(state.z);
    const strength = state.z >= 6 ? 'strong' : state.z >= 4 ? 'moderate' : state.z >= 2 ? 'weak' : 'none';
    const shortDoc = state.len < 120;

    document.getElementById('pMtiles').innerHTML = [
      tile('p-value', fmtP(p), ''),
      tile('by chance', p > 0.4 ? 'routinely' : '1 in ' + shortNum(1 / p), ''),
      tile('evidence', strength, '', strength === 'strong' ? 'good' : strength === 'moderate' ? 'warn' : 'bad'),
      tile('length', state.len, 'tokens', shortDoc ? 'bad' : 'good')
    ].join('');

    const claims = [
      ['These exact words passed through the marking model.', state.z >= 4 && !shortDoc,
       state.z >= 4 && !shortDoc ? 'Supported. This is the only claim the statistic makes directly.' : shortDoc ? 'Not supported — too few tokens for any threshold to mean anything.' : 'Not supported at z = ' + state.z.toFixed(1) + '.'],
      ['A human did not write this document.', false,
       'Never supported. A human can write a document and have the model polish it; the marked words are the model’s, the document is the human’s. The test cannot separate the two.'],
      ['This was written by AI, therefore it is not the author’s own work.', false,
       'Not a statistical claim at all. Whether assistance counts as misconduct is a policy question the z-score has no opinion about.'],
      ['The absence of a mark shows the text is human.', false,
       'Never supported. Short, factual, translated, rewritten, or non-Claude text all read as null. False negatives are the normal case, not the exception.'],
      ['This came from Claude specifically, not another model.', state.z >= 4 && !shortDoc,
       state.z >= 4 && !shortDoc ? 'Supported only because the key is Claude’s. It is really a claim about the key, not about the prose.' : 'Not supported here.'],
      ['We can tell how much of the document the model produced.', state.edit === 'none' && state.z >= 6,
       state.edit === 'none' && state.z >= 6 ? 'Roughly — a strong z on a clean document implies most positions were the model’s. Still an inference, not a measurement.' : 'Not reliably. z conflates length, entropy and the model’s share; a long lightly-assisted document and a short heavily-assisted one look the same.']
    ];

    document.getElementById('pMclaims').innerHTML = claims.map(([c, ok, why]) =>
      '<div class="verdict ' + (ok ? 'hit' : 'miss') + '"><span class="dot"></span><span><b>' +
      (ok ? 'CAN SAY' : 'CANNOT SAY') + '</b> — “' + c + '”<br><span style="color:var(--ink-2)">' + why + '</span></span></div>'
    ).join('');
  }
  function bind() {
    segmented(document.getElementById('pMedit'), [
      { value: 'unknown', label: 'Unknown' }, { value: 'none', label: 'None' }, { value: 'heavy', label: 'Heavy' }
    ], state.edit, v => { state.edit = v; bind(); run(); });
  }
  bind();
  bindRange('pMz', 'pMzV', v => v.toFixed(1), v => { state.z = v; run(); });
  bindRange('pMlen', 'pMlenV', v => v.toFixed(0), v => { state.len = v; run(); });
  run();
})();

})();
