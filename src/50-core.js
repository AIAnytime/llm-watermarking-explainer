/* ============================================================================
   CORE — hashing, PRF, toy language model, watermark samplers, detectors
   Everything here runs for real. No canned outputs.
   ========================================================================== */

/* ---------------------------------------------------------------- hashing */
function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16; return h >>> 0;
}
function hashStr(s, seed) {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; }
  return fmix32(h);
}
/* the keyed PRF: everything the watermark does is a function of (key, context, ...) */
function prf(key, ...parts) { return hashStr(parts.join(''), hashStr(key, 0)); }
function prfU(key, ...parts) { return prf(key, ...parts) / 4294967296; }      // uniform [0,1)
function prfBit(key, ...parts) { return prf(key, ...parts) & 1; }             // one fair bit

/* seeded stream RNG (mulberry32) — the "true randomness" the model would use */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- statistics */
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
const pOneSided = z => Math.max(1 - normCdf(z), 1e-300);

function fmtP(p) {
  if (p > 0.2) return p.toFixed(2);
  if (p > 1e-4) return p.toPrecision(2);
  const e = Math.floor(Math.log10(p));
  return (p / Math.pow(10, e)).toFixed(1) + '×10' + sup(e);
}
function sup(n) {
  const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map(c => map[c] || c).join('');
}
function entropyBits(ps) {
  let h = 0;
  for (const p of ps) if (p > 0) h -= p * Math.log2(p);
  return h;
}

/* ------------------------------------------------------------- tokenizing */
const TOKEN_RE = /[A-Za-zÀ-ɏ]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?|\n|[^\sA-Za-z0-9À-ɏ]/g;
function tokenize(text) { return (text.match(TOKEN_RE) || []); }
const norm = t => t.toLowerCase();

const NO_SPACE_BEFORE = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '’', '%', '\n']);
const NO_SPACE_AFTER = new Set(['(', '[', '{', '\n', '“']);
function joinTokens(toks) {
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (i > 0 && !NO_SPACE_BEFORE.has(t) && !NO_SPACE_AFTER.has(toks[i - 1])) out += ' ';
    out += t;
  }
  return out;
}
/* does token i need a leading space when rendered as its own element? */
function needsSpace(toks, i) {
  if (i === 0) return false;
  return !NO_SPACE_BEFORE.has(toks[i]) && !NO_SPACE_AFTER.has(toks[i - 1]);
}

/* ============================================================================
   TOY LANGUAGE MODEL
   A slot grammar. Every position emits exactly one token and carries an explicit
   distribution over candidates — many positions are *degenerate* (one candidate,
   probability 1), which is precisely how real text behaves and precisely why
   watermark capacity is unevenly distributed.
   ========================================================================== */

const BANKS = {
  /* --- river-town prose: high entropy, many equally natural choices --- */
  ADJ_W:   [['quiet',3],['restless',2],['shallow',2],['widening',2],['patient',2],['narrow',2],['brackish',1],['unhurried',1]],
  N_WATER: [['river',4],['current',3],['channel',2],['water',3],['estuary',1],['stream',2]],
  V_MOVE:  [['slid',3],['turned',2],['pressed',2],['drifted',3],['swung',1],['ran',2],['wound',2],['curved',1]],
  PREP:    [['past',3],['beneath',2],['around',2],['through',3],['along',2]],
  ADJ_T:   [['sleeping',2],['low',2],['grey',2],['old',3],['shuttered',1],['crooked',1],['flooded',1]],
  N_TOWN:  [['town',4],['village',2],['mill',2],['quay',1],['bridge',3],['harbour',1],['ferry',1]],
  TIME:    [['morning',3],['evening',3],['autumn',2],['winter',2],['hour',1],['season',1],['spring',1]],
  ADV:     [['slowly',2],['steadily',3],['endlessly',1],['quietly',2],['faintly',2],['patiently',1]],
  N_LIGHT: [['light',4],['mist',2],['rain',2],['fog',2],['sun',2],['haze',1]],
  V_STATE: [['settled',2],['thinned',2],['gathered',2],['lifted',2],['held',2],['deepened',1]],
  ABSTR:   [['memory',2],['habit',2],['silence',2],['distance',2],['weather',2],['patience',1]],
  CONJ:    [['and',4],['but',3],['though',2],['while',2],['yet',2]],
  /* the subset that can head a bare verb phrase — "though left nothing" is not English */
  CONJ_AND:[['and',4],['but',3],['yet',2]],
  /* --- near-deterministic hedges: real text is full of these --- */
  FACT_ADV:[['generally',6],['widely',3],['commonly',2]],
  /* --- code comments: high entropy inside an otherwise rigid stream --- */
  C_ADJ:   [['running',2],['cumulative',2],['total',2],['final',1],['aggregate',1]],
  C_NOUN:  [['score',3],['tally',1],['sum',2],['weight',1]],
  C_VERB:  [['walk',2],['scan',2],['iterate',1],['sweep',1]],
  C_THING: [['token',3],['word',2],['item',1],['symbol',1]]
};

const GRAMMARS = {
  prose: {
    label: 'Descriptive prose',
    note: 'High-entropy text: at most positions several words are equally natural, so the watermark has room to work.',
    templates: [
      ['The','$ADJ_W','$N_WATER','$V_MOVE','$PREP','the','$ADJ_T','$N_TOWN','.'],
      ['In','the','$TIME','the','$N_LIGHT','$V_STATE','$ADV','over','the','$N_WATER','.'],
      ['$CONJ','the','$N_TOWN','kept','its','$ABSTR',',','$ADV',',','as','if','the','$N_WATER','had','never','$V_MOVE','at','all','.'],
      ['The','$ADJ_W','$N_LIGHT','came','$PREP','the','$ADJ_T','$N_TOWN','$CONJ_AND','left','nothing','behind','.'],
      ['Every','$TIME','the','$ADJ_W','$N_WATER','$V_STATE',',','and','the','$N_TOWN','$V_STATE','with','it','.'],
      ['No','one','remembered','the','$TIME','when','the','$N_WATER','had','$V_STATE','$ADV','.'],
      ['The','$ABSTR','of','the','$N_TOWN','was','$ADJ_W',',','like','$N_LIGHT','that','never','quite','$V_STATE','.'],
      ['The','$N_LIGHT','$V_STATE','$PREP','the','$N_TOWN',',','and','for','one','$TIME','nothing','$V_MOVE','at','all','.'],
      ['$CONJ_AND','no','$N_LIGHT','ever','$V_STATE','long','over','the','$ADJ_W','$N_WATER','.'],
      ['Someone','had','$V_STATE','the','$ADJ_T','$N_TOWN','into','a','$ABSTR','of','$N_LIGHT','and','$ABSTR','.'],
      ['By','the','$TIME','the','$N_WATER','was','$ADJ_W','again',',','$ADV',',','and','the','$N_TOWN','$V_STATE','.'],
      ['It','was','the','kind','of','$TIME','that','$V_MOVE','$PREP','a','$N_TOWN','without','being','noticed','.'],
      ['The','$ADJ_T','$N_TOWN','had','learned','to','live','$PREP','the','$ADJ_W','$N_WATER',',','and','called','it','$ABSTR','.'],
      ['Downstream','the','$N_WATER','$V_MOVE','$ADV','$PREP','one','$ADJ_T','$N_TOWN','after','another','.'],
      ['What','the','$N_TOWN','called','$ABSTR','was','only','the','$N_WATER',',','which','$V_MOVE','$PREP','it','$ADV','.']
    ]
  },
  facts: {
    label: 'Factual reference',
    note: 'Low-entropy text: the next token is nearly forced, so there is almost nothing for the key to bias.',
    templates: [
      ['Newton',"'s",'principal','work','is','the','Principia','Mathematica',',','published','in','1687','.'],
      ['Water','freezes','at','0','degrees','Celsius','at','standard','atmospheric','pressure','.'],
      ['The','capital','of','Japan','is','Tokyo',',','and','its','largest','port','is','Yokohama','.'],
      ['Two','plus','two','equals','four','.'],
      ['The','$FACT_ADV','accepted','value','of','the','speed','of','light','is','299792458','metres','per','second','.'],
      ['The','mitochondrion','is','the','organelle','responsible','for','cellular','respiration','.']
    ]
  },
  code: {
    label: 'Code with comments',
    ordered: true,
    note: 'Mixed: the code tokens are forced by syntax, the comment words are free. The watermark lands almost entirely in the prose.',
    templates: [
      ['//','$V_STATE','a','$C_ADJ','$C_NOUN','as','we','$C_VERB','each','$C_THING','\n'],
      ['function','detect','(','tokens',',','key',')','{','\n'],
      ['  ','let','hits','=','0',';','\n'],
      ['  ','for','(','let','i','=','1',';','i','<','tokens','.','length',';','i','++',')','{','\n'],
      ['    ','//','the','$C_ADJ','$C_NOUN','only','moves','on','a','green','$C_THING','\n'],
      ['    ','if','(','isGreen','(','tokens','[','i','-','1',']',',','tokens','[','i',']',',','key',')',')','hits','++',';','\n'],
      ['  ','}','\n'],
      ['  ','return','zScore','(','hits',',','tokens','.','length',')',';','\n'],
      ['}','\n']
    ]
  },
  mixed: {
    label: 'Mixed report',
    note: 'What most real answers look like: free prose interleaved with facts and numbers.',
    templates: [
      ['The','$ADJ_W','$N_WATER','$V_MOVE','$PREP','the','$N_TOWN','.'],
      ['Water','freezes','at','0','degrees','Celsius','.'],
      ['In','$TIME','the','$N_LIGHT','$V_STATE','$ADV','.'],
      ['Newton',"'s",'principal','work','is','the','Principia','Mathematica','.'],
      ['$CONJ','the','$N_TOWN','kept','its','$ABSTR',',','$ADV','.'],
      ['Two','plus','two','equals','four','.'],
      ['A','$ADJ_W','$N_LIGHT','came','$PREP','the','$ADJ_T','$N_TOWN','.']
    ]
  }
};

/* build the candidate distribution at one slot, with temperature */
function slotDist(item, temp) {
  if (item[0] !== '$') return [{ tok: item, p: 1, w: 1 }];
  const bank = BANKS[item.slice(1)];
  const t = Math.max(0.05, temp);
  const ws = bank.map(([, w]) => Math.pow(w, 1 / t));
  const sum = ws.reduce((a, b) => a + b, 0);
  return bank.map(([tok], i) => ({ tok, p: ws[i] / sum, w: ws[i] }));
}

/* inverse-CDF pick from a probability vector, given u in [0,1) */
function pickFromU(ps, u) {
  let acc = 0;
  for (let i = 0; i < ps.length; i++) { acc += ps[i]; if (u < acc) return i; }
  return ps.length - 1;
}
function softmaxFromLogits(logits) {
  const m = Math.max(...logits);
  const ex = logits.map(l => Math.exp(l - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map(e => e / s);
}

/* ============================================================================
   WATERMARK SCHEMES

   The context is a sliding window of the H preceding tokens. KGW's original
   paper uses H = 1; SynthID-Text uses a window (H = 4 in the Nature paper),
   which spreads the PRF over far more distinct contexts and so survives the
   repeated-context dedup rule with much more evidence intact. The cost is
   fragility: editing one token corrupts the context of the next H tokens too.
   ========================================================================== */
const H_CTX = 4;
/* context string for the token about to be emitted after `prev` (already normalised) */
const ctxJoin = arr => arr.join(' ');
/* context for position i of an existing token list */
function ctxAt(toks, i, h) {
  const w = [];
  for (let j = Math.max(0, i - h); j < i; j++) w.push(norm(toks[j]));
  return ctxJoin(w);
}

const isGreen = (key, ctx, tok, gamma) => prfU(key, 'kgw', ctx, norm(tok)) < gamma;
const gumbelR = (key, ctx, tok) => prfU(key, 'gum', ctx, norm(tok));
const gValue  = (key, ctx, tok, layer) => prfBit(key, 'syn', layer, ctx, norm(tok));

/* ---- one generation step. Returns everything needed to explain the choice. */
function step(method, cands, ctx, cfg, rng) {
  const n = cands.length;
  const p = cands.map(c => c.p);
  const u = rng();                                  /* the model's own randomness */
  const plainIdx = pickFromU(p, u);
  const rec = {
    cands, ctx, p, plainIdx, entropy: entropyBits(p),
    forced: n === 1, method, detail: {}
  };

  if (n === 1) { rec.idx = 0; rec.pWm = [1]; return rec; }

  if (method === 'none') {
    rec.idx = plainIdx; rec.pWm = p.slice();
    return rec;
  }

  if (method === 'kgw') {
    const green = cands.map(c => isGreen(cfg.key, ctx, c.tok, cfg.gamma));
    const logits = p.map((pi, i) => Math.log(pi) + (green[i] ? cfg.delta : 0));
    const pw = softmaxFromLogits(logits);
    /* coupled sampling: SAME uniform u, so the token differs only when the
       green-list bonus genuinely changed this draw's outcome. */
    rec.idx = pickFromU(pw, u);
    rec.pWm = pw;
    rec.detail.green = green;
    rec.changed = rec.idx !== plainIdx;
    return rec;
  }

  if (method === 'gumbel') {
    const r = cands.map(c => gumbelR(cfg.key, ctx, c.tok));
    const score = r.map((ri, i) => Math.pow(ri, 1 / p[i]));
    let best = 0; for (let i = 1; i < n; i++) if (score[i] > score[best]) best = i;
    rec.idx = best; rec.pWm = p.slice();
    rec.detail.r = r; rec.detail.score = score;
    rec.changed = rec.idx !== plainIdx;
    return rec;
  }

  if (method === 'synthid') {
    const m = cfg.layers;
    const K = 1 << m;
    /* 2^m i.i.d. draws from p — repeats allowed, which is what preserves the
       distribution: likelier tokens simply enter the bracket more often. */
    let field = [];
    for (let i = 0; i < K; i++) field.push(pickFromU(p, rng()));
    const rounds = [field.slice()];
    for (let l = 1; l <= m; l++) {
      const next = [];
      for (let i = 0; i < field.length; i += 2) {
        const a = field[i], b = field[i + 1];
        const ga = gValue(cfg.key, ctx, cands[a].tok, l);
        const gb = gValue(cfg.key, ctx, cands[b].tok, l);
        next.push(ga > gb ? a : gb > ga ? b : (rng() < 0.5 ? a : b));
      }
      field = next; rounds.push(field.slice());
    }
    rec.idx = field[0]; rec.pWm = p.slice();
    rec.detail.rounds = rounds; rec.detail.layers = m;
    rec.changed = rec.idx !== plainIdx;
    return rec;
  }

  rec.idx = plainIdx; rec.pWm = p.slice();
  return rec;
}

/* ---- generate a passage ------------------------------------------------- */
function generate(opts) {
  const g = GRAMMARS[opts.grammar];
  const h = opts.h || H_CTX;
  const rng = mulberry32(hashStr('seed:' + opts.seed, 7));
  const cfg = { key: opts.key, gamma: opts.gamma, delta: opts.delta, layers: opts.layers };
  const steps = [];
  const toks = [];
  const win = [];                                   /* rolling normalised context window */
  let sentenceStart = true;
  let ti = -1;
  while (toks.length < opts.length) {
    /* pick a sentence frame at random, never the same one twice running —
       cycling them in order makes the passage read like a stuck record */
    if (g.ordered) ti = (ti + 1) % g.templates.length;      /* code must stay in sequence */
    else {
      let next = ti;
      if (g.templates.length > 1) { while (next === ti) next = Math.floor(rng() * g.templates.length); }
      else next = 0;
      ti = next;
    }
    const tpl = g.templates[ti];
    for (const item of tpl) {
      const cands = slotDist(item, opts.temp);
      const ctx = ctxJoin(win);
      const rec = step(opts.method, cands, ctx, cfg, rng);
      const tok = cands[rec.idx].tok;
      rec.tok = tok;
      rec.display = sentenceStart && /^[a-z]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok;
      rec.i = steps.length;
      steps.push(rec);
      toks.push(rec.display);
      win.push(norm(tok)); if (win.length > h) win.shift();
      sentenceStart = (tok === '.' || tok === '\n' || tok === '!' || tok === '?');
    }
    if (toks.length >= opts.length) break;
  }
  return { steps, toks, grammar: g, h };
}

/* ============================================================================
   DETECTORS
   Each takes a plain token list — no model, no prompt, no logits. Just the key.

   Repeated-context suppression: a (context, token) pair that appears twice
   yields the identical PRF output twice, so counting both inflates the
   statistic without adding evidence. Real detectors deduplicate; so does this
   one, by default. Turn it off and watch the false-positive rate blow up on
   repetitive text.
   ========================================================================== */

/* walk the text once, yielding one score per *distinct* (context, token) pair */
function scoreStream(toks, scoreFn, dedup, h) {
  h = h || H_CTX;
  const seen = new Set();
  const per = [];                  /* aligned to toks[1..]; null = not counted */
  const vals = [];
  let dups = 0;
  for (let i = 1; i < toks.length; i++) {
    const ctx = ctxAt(toks, i, h);
    const key = ctx + ' | ' + norm(toks[i]);
    if (dedup && seen.has(key)) { per.push(null); dups++; continue; }
    seen.add(key);
    const v = scoreFn(ctx, toks[i]);
    per.push(v); vals.push(v);
  }
  return { per, vals, dups };
}

function detectKGW(toks, key, gamma, dedup, h) {
  if (dedup === undefined) dedup = true;
  const s = scoreStream(toks, (ctx, t) => (isGreen(key, ctx, t, gamma) ? 1 : 0), dedup, h);
  const n = s.vals.length;
  const hits = s.vals.reduce((a, b) => a + b, 0);
  const sd = Math.sqrt(n * gamma * (1 - gamma)) || 1;
  const z = (hits - gamma * n) / sd;
  return { z, p: pOneSided(z), n, hits, dups: s.dups, frac: n ? hits / n : gamma,
           expected: gamma, per: s.per, stat: 'green fraction' };
}

function detectGumbel(toks, key, dedup, h) {
  if (dedup === undefined) dedup = true;
  const s = scoreStream(toks, (ctx, t) => gumbelR(key, ctx, t), dedup, h);
  const n = s.vals.length;
  const mean = n ? s.vals.reduce((a, b) => a + b, 0) / n : 0.5;
  /* under the null r ~ U(0,1): mean 1/2, variance 1/12 */
  const z = n ? (mean - 0.5) / Math.sqrt(1 / (12 * n)) : 0;
  return { z, p: pOneSided(z), n, dups: s.dups, frac: mean, expected: 0.5, per: s.per, stat: 'mean r' };
}

function detectSynthID(toks, key, m, dedup, h) {
  if (dedup === undefined) dedup = true;
  const s = scoreStream(toks, (ctx, t) => {
    let v = 0; for (let l = 1; l <= m; l++) v += gValue(key, ctx, t, l);
    return v / m;
  }, dedup, h);
  const n = s.vals.length, bits = n * m;
  const mean = n ? s.vals.reduce((a, b) => a + b, 0) / n : 0.5;
  const z = bits ? (mean - 0.5) / Math.sqrt(1 / (4 * bits)) : 0;
  return { z, p: pOneSided(z), n, dups: s.dups, frac: mean, expected: 0.5, per: s.per, stat: 'mean g-value' };
}

function detect(method, toks, cfg) {
  const dd = cfg.dedup === undefined ? true : cfg.dedup;
  if (method === "kgw") return detectKGW(toks, cfg.key, cfg.gamma, dd, cfg.h);
  if (method === "gumbel") return detectGumbel(toks, cfg.key, dd, cfg.h);
  if (method === "synthid") return detectSynthID(toks, cfg.key, cfg.layers, dd, cfg.h);
  /* "none" has no detector of its own — score it with all three and take the best,
     which is exactly what an honest analyst without provenance would do. */
  const a = detectKGW(toks, cfg.key, cfg.gamma, dd, cfg.h), b = detectGumbel(toks, cfg.key, dd, cfg.h),
        c = detectSynthID(toks, cfg.key, cfg.layers, dd, cfg.h);
  return [a, b, c].sort((x, y) => y.z - x.z)[0];
}

/* ============================================================================
   ATTACKS
   ========================================================================== */

/* a synonym table drawn from the model's own banks, plus common function words */
const SYNS = (() => {
  const m = {};
  for (const k in BANKS) {
    const words = BANKS[k].map(([w]) => w);
    for (const w of words) m[w] = words.filter(x => x !== w);
  }
  const extra = {
    'the': ['that'], 'a': ['one'], 'and': ['plus'], 'but': ['though'],
    'never': ['not once'], 'kept': ['held'], 'came': ['arrived'], 'left': ['abandoned'],
    'nothing': ['no trace'], 'behind': ['in its wake'], 'over': ['above'],
    'remembered': ['recalled'], 'no': ['not'], 'one': ['a soul'], 'was': ['seemed'],
    'like': ['as'], 'quite': ['entirely'], 'its': ['the'], 'all': ['any']
  };
  for (const k in extra) m[k] = (m[k] || []).concat(extra[k]);
  return m;
})();

/* paraphrase: swap tokens for meaning-preserving alternatives at rate rho */
function paraphrase(toks, rho, seed) {
  const rng = mulberry32(hashStr('para' + seed, 3));
  const out = [], edited = [];
  for (let i = 0; i < toks.length; i++) {
    const lower = norm(toks[i]);
    const alts = SYNS[lower];
    if (alts && alts.length && rng() < rho) {
      let alt = alts[Math.floor(rng() * alts.length)];
      if (/^[A-Z]/.test(toks[i])) alt = alt[0].toUpperCase() + alt.slice(1);
      out.push(alt); edited.push(true);
    } else { out.push(toks[i]); edited.push(false); }
  }
  return { toks: out, edited };
}

/* the adaptive attack on SynthID: regenerate candidates and keep the ones with
   the LOWEST g-values, pushing the detector's mean back toward 0.5 */
function layerInflation(toks, rho, key, m, seed) {
  const rng = mulberry32(hashStr('inf' + seed, 11));
  const out = [], edited = [];
  for (let i = 0; i < toks.length; i++) {
    const lower = norm(toks[i]);
    const alts = SYNS[lower];
    if (i > 0 && alts && alts.length && rng() < rho) {
      const ctx = ctxAt(out, i, H_CTX);          /* attacker scores against the text as edited so far */
      const score = t => { let s = 0; for (let l = 1; l <= m; l++) s += gValue(key, ctx, t, l); return s; };
      let best = toks[i], bs = score(lower);
      for (const a of alts) { const s = score(a); if (s < bs) { bs = s; best = a; } }
      if (/^[A-Z]/.test(toks[i])) best = best[0].toUpperCase() + best.slice(1);
      out.push(best); edited.push(norm(best) !== lower);
    } else { out.push(toks[i]); edited.push(false); }
  }
  return { toks: out, edited };
}

/* ============================================================================
   MULTI-BIT WATERMARKING (payload, not just a flag)
   ========================================================================== */
const REP = 3;                                   /* repetition code, majority vote */
function encodePayload(bits) {
  const out = [];
  for (const b of bits) for (let r = 0; r < REP; r++) out.push(b);
  return out;
}
/* which codeword position is this text position responsible for? */
const segmentOf = (key, ctx, L) => prf(key, 'seg', ctx) % L;
/* the green list now depends on the bit this position is carrying */
const isGreenBit = (key, ctx, tok, bit, gamma) => prfU(key, 'mb', bit, ctx, norm(tok)) < gamma;

function generateMultibit(opts) {
  const g = GRAMMARS.prose;
  const rng = mulberry32(hashStr('mb' + opts.seed, 5));
  const code = encodePayload(opts.bits);
  const L = code.length;
  const steps = [], toks = [];
  const win = [];
  const h = opts.h || H_CTX;
  let sentenceStart = true, ti = -1;
  while (toks.length < opts.length) {
    let next = ti; while (next === ti) next = Math.floor(rng() * g.templates.length); ti = next;
    const tpl = g.templates[ti];
    for (const item of tpl) {
      const cands = slotDist(item, 1);
      const ctx = ctxJoin(win);
      const seg = segmentOf(opts.key, ctx, L);
      const bit = code[seg];
      let idx;
      if (cands.length === 1) idx = 0;
      else {
        const p = cands.map(c => c.p);
        const logits = p.map((pi, i) => Math.log(pi) + (isGreenBit(opts.key, ctx, cands[i].tok, bit, opts.gamma) ? opts.delta : 0));
        idx = pickFromU(softmaxFromLogits(logits), rng());
      }
      const tok = cands[idx].tok;
      const disp = sentenceStart && /^[a-z]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok;
      steps.push({ tok, seg, bit, forced: cands.length === 1 });
      toks.push(disp);
      win.push(norm(tok)); if (win.length > h) win.shift();
      sentenceStart = (tok === '.' || tok === '\n');
    }
  }
  return { steps, toks, code, L };
}

function decodePayload(toks, key, gamma, nBits, h) {
  h = h || H_CTX;
  const L = nBits * REP;
  const vote = Array.from({ length: L }, () => [0, 0]);   /* [votes for 0, votes for 1] */
  const seen = new Set();
  for (let i = 1; i < toks.length; i++) {
    const ctx = ctxAt(toks, i, h);
    const sig = ctx + ' | ' + norm(toks[i]);
    if (seen.has(sig)) continue;                          /* same dedup rule as the flag detector */
    seen.add(sig);
    const seg = segmentOf(key, ctx, L);
    for (const b of [0, 1]) if (isGreenBit(key, ctx, toks[i], b, gamma)) vote[seg][b]++;
  }
  const raw = vote.map(v => (v[1] > v[0] ? 1 : v[0] > v[1] ? 0 : -1));
  const bits = [], conf = [];
  for (let i = 0; i < nBits; i++) {
    let ones = 0, tot = 0;
    for (let r = 0; r < REP; r++) { const b = raw[i * REP + r]; if (b >= 0) { tot++; ones += b; } }
    bits.push(tot === 0 ? 0 : (ones * 2 > tot ? 1 : 0));
    conf.push(tot === 0 ? 0 : Math.abs(ones / tot - 0.5) * 2);
  }
  return { bits, raw, conf, vote };
}

/* ============================================================================
   SEMANTIC-SPACE WATERMARKING (SemStamp / PASA family)
   Sentences live as points in an embedding space. The key defines LSH
   hyperplanes; only sentences landing in "valid" cells are accepted.
   ========================================================================== */
function lshPlanes(key, n) {
  const planes = [];
  for (let i = 0; i < n; i++) {
    const a = prfU(key, 'plane', i) * Math.PI * 2;
    planes.push([Math.cos(a), Math.sin(a)]);
  }
  return planes;
}
const lshCode = (pt, planes) => planes.map(pl => (pt[0] * pl[0] + pt[1] * pl[1] >= 0 ? 1 : 0));
const cellValid = (code, key) => (code.reduce((a, b) => a ^ b, 0) === (prf(key, 'parity') & 1));

/* ============================================================================
   SVG CHART KIT — thin marks, recessive grid, direct labels, hover tooltips
   ========================================================================== */
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
let TT;
function tip(html, x, y) {
  if (!TT) { TT = document.createElement('div'); TT.className = 'tt'; document.body.appendChild(TT); }
  TT.innerHTML = html; TT.style.opacity = '1';
  const r = TT.getBoundingClientRect();
  TT.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14)) + 'px';
  TT.style.top = Math.max(8, y - r.height - 12) + 'px';
}
function untip() { if (TT) TT.style.opacity = '0'; }

/* grouped bar chart — used for "did the distribution survive?" */
function barChart(host, spec) {
  host.innerHTML = '';
  const W = spec.width || 560, H = spec.height || 240;
  const M = { t: 18, r: 14, b: (spec.groups.length > 5 ? 62 : 42), l: 40 };
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img' }, host);
  svg.style.minWidth = Math.min(W, 560) + 'px';   /* narrow screens scroll, they do not squint */
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const max = spec.max || Math.max(...spec.groups.flatMap(g => g.values)) * 1.15;
  const y = v => M.t + ih - (v / max) * ih;

  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    el('line', { class: 'grid', x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v) }, svg);
    const t = el('text', { x: M.l - 7, y: y(v) + 3.5, 'text-anchor': 'end' }, svg);
    t.textContent = spec.yfmt ? spec.yfmt(v) : v.toFixed(2);
  }
  el('line', { class: 'axis', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, svg);

  const gw = iw / spec.groups.length;
  const ns = spec.series.length;
  const bw = Math.min(26, (gw * 0.72) / ns);
  spec.groups.forEach((g, gi) => {
    const cx = M.l + gw * gi + gw / 2;
    const x0 = cx - (bw * ns + 2 * (ns - 1)) / 2;
    g.values.forEach((v, si) => {
      const x = x0 + si * (bw + 2), yy = y(v), h = Math.max(1, M.t + ih - yy);
      const r = el('rect', { x, y: yy, width: bw, height: h, rx: 3, fill: spec.series[si].color, 'shape-rendering': 'crispEdges' }, svg);
      r.style.cursor = 'crosshair';
      r.addEventListener('mousemove', e => tip(`<b>${spec.series[si].name}</b><br>${g.label}: ${spec.tipfmt ? spec.tipfmt(v) : v.toFixed(4)}`, e.clientX, e.clientY));
      r.addEventListener('mouseleave', untip);
    });
    /* long label sets collide when packed edge to edge — lean them over instead */
    const tilt = spec.groups.length > 5;
    const t = el('text', tilt
      ? { x: cx, y: M.t + ih + 13, 'text-anchor': 'end', transform: `rotate(-34 ${cx} ${M.t + ih + 13})` }
      : { x: cx, y: M.t + ih + 15, 'text-anchor': 'middle' }, svg);
    if (g.color) t.setAttribute('fill', g.color);
    t.textContent = g.label;
  });
  if (spec.xLabel) { const t = el('text', { class: 'ax-label', x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); t.textContent = spec.xLabel; }
  if (spec.yLabel) { const t = el('text', { class: 'ax-label', x: 4, y: 11 }, svg); t.textContent = spec.yLabel; }
  return svg;
}

/* multi-series line chart with a crosshair */
function lineChart(host, spec) {
  host.innerHTML = '';
  const W = spec.width || 560, H = spec.height || 250;
  const M = { t: 20, r: spec.labelRoom || 70, b: 42, l: 46 };
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img' }, host);
  svg.style.minWidth = Math.min(W, 560) + 'px';   /* narrow screens scroll, they do not squint */
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const xs = spec.series.flatMap(s => s.points.map(p => p[0]));
  const ys = spec.series.flatMap(s => s.points.map(p => p[1]));
  const x0 = spec.xMin !== undefined ? spec.xMin : Math.min(...xs);
  const x1 = spec.xMax !== undefined ? spec.xMax : Math.max(...xs);
  const y0 = spec.yMin !== undefined ? spec.yMin : Math.min(0, Math.min(...ys));
  const y1 = spec.yMax !== undefined ? spec.yMax : Math.max(...ys) * 1.12;
  const X = v => M.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const Y = v => M.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  for (let i = 0; i <= 4; i++) {
    const v = y0 + (y1 - y0) * i / 4;
    el('line', { class: 'grid', x1: M.l, x2: M.l + iw, y1: Y(v), y2: Y(v) }, svg);
    const t = el('text', { x: M.l - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg);
    t.textContent = spec.yfmt ? spec.yfmt(v) : v.toFixed(1);
  }
  (spec.xTicks || []).forEach(v => {
    const t = el('text', { x: X(v), y: M.t + ih + 15, 'text-anchor': 'middle' }, svg);
    t.textContent = spec.xfmt ? spec.xfmt(v) : v;
  });
  el('line', { class: 'axis', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, svg);

  (spec.rules || []).forEach(r => {
    el('line', { x1: M.l, x2: M.l + iw, y1: Y(r.y), y2: Y(r.y), stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
    const t = el('text', { x: M.l + iw - 2, y: Y(r.y) - 5, 'text-anchor': 'end' }, svg);
    t.textContent = r.label;
  });

  spec.series.forEach(s => {
    const d = s.points.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    if (s.fill) el('path', { d: d + ` L ${X(s.points[s.points.length - 1][0])} ${Y(y0)} L ${X(s.points[0][0])} ${Y(y0)} Z`, fill: s.color, opacity: 0.10 }, svg);
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const last = s.points[s.points.length - 1];
    el('circle', { cx: X(last[0]), cy: Y(last[1]), r: 3.2, fill: s.color, stroke: 'var(--sheet)', 'stroke-width': 2 }, svg);
    const t = el('text', { class: 'dlabel', x: X(last[0]) + 8, y: Y(last[1]) + 3.5, fill: s.color }, svg);
    t.textContent = s.name;
  });

  /* crosshair */
  const cross = el('line', { x1: 0, x2: 0, y1: M.t, y2: M.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: 0 }, svg);
  const hit = el('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' }, svg);
  hit.style.cursor = 'crosshair';
  hit.addEventListener('mousemove', e => {
    const bb = svg.getBoundingClientRect();
    const px = ((e.clientX - bb.left) / bb.width) * W;
    const xv = x0 + ((px - M.l) / iw) * (x1 - x0);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('opacity', 0.5);
    const rows = spec.series.map(s => {
      let best = s.points[0];
      for (const p of s.points) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
      return `<span style="color:${s.color}">■</span> ${s.name}: <b>${spec.yfmt ? spec.yfmt(best[1]) : best[1].toFixed(2)}</b>`;
    }).join('<br>');
    tip(`${spec.xLabel || 'x'} ≈ ${spec.xfmt ? spec.xfmt(Math.round(xv)) : Math.round(xv)}<br>${rows}`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); untip(); });

  if (spec.xLabel) { const t = el('text', { class: 'ax-label', x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); t.textContent = spec.xLabel; }
  if (spec.yLabel) { const t = el('text', { class: 'ax-label', x: 4, y: 11 }, svg); t.textContent = spec.yLabel; }
  return svg;
}

/* two overlaid histograms — the null distribution vs the watermarked one */
function histChart(host, spec) {
  host.innerHTML = '';
  const W = spec.width || 560, H = spec.height || 230;
  const M = { t: 18, r: 14, b: 42, l: 40 };
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img' }, host);
  svg.style.minWidth = Math.min(W, 560) + 'px';   /* narrow screens scroll, they do not squint */
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const max = Math.max(...spec.sets.flatMap(s => s.bins));
  const X = i => M.l + (i / spec.nBins) * iw;
  const Y = v => M.t + ih - (v / (max || 1)) * ih;
  for (let i = 0; i <= 3; i++) {
    el('line', { class: 'grid', x1: M.l, x2: M.l + iw, y1: M.t + ih * i / 3, y2: M.t + ih * i / 3 }, svg);
  }
  spec.sets.forEach(s => {
    const bw = iw / spec.nBins;
    s.bins.forEach((v, i) => {
      if (v <= 0) return;
      el('rect', { x: X(i) + 1, y: Y(v), width: Math.max(1, bw - 2), height: M.t + ih - Y(v), fill: s.color, opacity: s.opacity || 0.62, rx: 2 }, svg);
    });
  });
  el('line', { class: 'axis', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, svg);
  (spec.xTicks || []).forEach(([pos, lab]) => {
    const px = M.l + pos * iw;
    const t = el('text', { x: px, y: M.t + ih + 15, 'text-anchor': 'middle' }, svg); t.textContent = lab;
  });
  (spec.marks || []).forEach(m => {
    const px = M.l + m.pos * iw;
    el('line', { x1: px, x2: px, y1: M.t, y2: M.t + ih, stroke: m.color || 'var(--ink-2)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
    const t = el('text', { x: px + 4, y: M.t + 10, fill: m.color || 'var(--ink-2)' }, svg); t.textContent = m.label;
  });
  if (spec.xLabel) { const t = el('text', { class: 'ax-label', x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); t.textContent = spec.xLabel; }
  return svg;
}

/* ------------------------------------------------------------ DOM helpers */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function h(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(c => n.appendChild(c));
  return n;
}
function segmented(host, options, value, onPick) {
  host.innerHTML = '';
  options.forEach(o => {
    const b = h('button', { type: 'button', text: o.label, 'aria-pressed': String(o.value === value) });
    b.addEventListener('click', () => onPick(o.value));
    host.appendChild(b);
  });
}
function bindRange(id, outId, fmt, onChange) {
  const r = document.getElementById(id), o = document.getElementById(outId);
  const upd = () => { if (o) o.textContent = fmt(parseFloat(r.value)); onChange(parseFloat(r.value)); };
  r.addEventListener('input', upd);
  return upd;
}
