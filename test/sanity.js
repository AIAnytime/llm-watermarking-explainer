/* Headless sanity checks for the watermark engine.
   Run: node test/sanity.js                                                   */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '50-core.js'), 'utf8');
/* the chart/DOM half of core needs a document; stub just enough to load it */
global.document = { createElementNS: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {} }), createElement: () => ({ style: {} }), body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] };
global.window = { innerWidth: 1000, innerHeight: 800 };
eval(src + "\n;Object.assign(global,{isGreen,gumbelR,gValue,norm,cellValid,lshCode,ctxAt,H_CTX,BANKS,GRAMMARS,SYNS});");

let fails = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
}
function section(s) { console.log('\n' + s); }

const KEY = 'anthropic-2026';
const CFG = { key: KEY, gamma: 0.5, layers: 3 };
const base = { grammar: "prose", key: KEY, gamma: 0.5, delta: 4, layers: 3, temp: 1, length: 400 };

/* ---------------------------------------------------------- 1. detection */
section('1. detection separates marked from unmarked');
const gKGW = generate(Object.assign({}, base, { method: 'kgw', seed: 't1' }));
const gGUM = generate(Object.assign({}, base, { method: 'gumbel', seed: 't2' }));
const gSYN = generate(Object.assign({}, base, { method: 'synthid', seed: 't3' }));
const gNON = generate(Object.assign({}, base, { method: 'none', seed: 't4' }));

const zKGW = detectKGW(gKGW.toks, KEY, 0.5).z;
const zGUM = detectGumbel(gGUM.toks, KEY).z;
const zSYN = detectSynthID(gSYN.toks, KEY, 3).z;
check("KGW  marked z > 5", zKGW > 5, "z=" + zKGW.toFixed(2));
check('Gumbel marked z > 5', zGUM > 5, 'z=' + zGUM.toFixed(2));
check('SynthID marked z > 5', zSYN > 5, 'z=' + zSYN.toFixed(2));

check('unmarked text is null under KGW', Math.abs(detectKGW(gNON.toks, KEY, 0.5).z) < 3, 'z=' + detectKGW(gNON.toks, KEY, 0.5).z.toFixed(2));
check('unmarked text is null under Gumbel', Math.abs(detectGumbel(gNON.toks, KEY).z) < 3, 'z=' + detectGumbel(gNON.toks, KEY).z.toFixed(2));
check('unmarked text is null under SynthID', Math.abs(detectSynthID(gNON.toks, KEY, 3).z) < 3, 'z=' + detectSynthID(gNON.toks, KEY, 3).z.toFixed(2));

section('2. wrong key = no signal');
check('KGW under wrong key', Math.abs(detectKGW(gKGW.toks, 'wrong-key', 0.5).z) < 3, 'z=' + detectKGW(gKGW.toks, 'wrong-key', 0.5).z.toFixed(2));
check('SynthID under wrong key', Math.abs(detectSynthID(gSYN.toks, 'wrong-key', 3).z) < 3, 'z=' + detectSynthID(gSYN.toks, 'wrong-key', 3).z.toFixed(2));
check('cross-scheme: KGW text under SynthID detector', Math.abs(detectSynthID(gKGW.toks, KEY, 3).z) < 3, 'z=' + detectSynthID(gKGW.toks, KEY, 3).z.toFixed(2));

section('3. false-positive calibration — 300 unmarked passages');
let over2 = 0, over4 = 0, sum = 0, sum2 = 0;
for (let i = 0; i < 300; i++) {
  const g = generate(Object.assign({}, base, { method: 'none', seed: 'fp' + i, length: 300 }));
  const z = detectSynthID(g.toks, KEY, 3).z;
  sum += z; sum2 += z * z;
  if (z > 2) over2++; if (z > 4) over4++;
}
const mean = sum / 300, sd = Math.sqrt(sum2 / 300 - mean * mean);
check('null mean ≈ 0', Math.abs(mean) < 0.35, 'mean=' + mean.toFixed(3));
check('null sd ≈ 1', Math.abs(sd - 1) < 0.35, 'sd=' + sd.toFixed(3));
check('z>4 essentially never', over4 <= 1, over4 + '/300');
console.log('       z>2 in ' + over2 + '/300 (expect ~7)');

section('3b. dedup is what keeps repetitive text honest');
for (const gr of ['facts', 'code']) {
  const g = generate({ grammar: gr, method: 'none', key: KEY, gamma: .5, delta: 2, layers: 3, temp: 1, length: 600, seed: 'dd' });
  const on = detectSynthID(g.toks, KEY, 3, true), off = detectSynthID(g.toks, KEY, 3, false);
  console.log('       ' + gr.padEnd(6) + ' dedup z=' + on.z.toFixed(2) + ' (n=' + on.n + ')   raw z=' + off.z.toFixed(2) + ' (n=' + off.n + ')');
  check('unmarked ' + gr + ' stays null with dedup', Math.abs(on.z) < 2.5, 'z=' + on.z.toFixed(2));
}

section('4. distortion — conditional on one context vs averaged over contexts');
const cands = slotDist('$N_WATER', 1);
const p = cands.map(c => c.p);
const N = 40000;
const KL = {};
for (const regime of ['fixed', 'varying']) {
  KL[regime] = {};
  for (const m of ['none', 'kgw', 'gumbel', 'synthid']) {
    const c = new Array(cands.length).fill(0);
    for (let i = 0; i < N; i++) {
      const ctx = regime === 'fixed' ? 'the quiet river' : 'ctx' + i;
      const rec = step(m, cands, ctx, { key: KEY, gamma: .5, delta: 2, layers: 3 }, mulberry32(hashStr(m + i, 99)));
      c[rec.idx]++;
    }
    const q = c.map(x => x / N);
    let kl = 0; for (let i = 0; i < p.length; i++) if (q[i] > 0) kl += q[i] * Math.log2(q[i] / p[i]);
    KL[regime][m] = kl;
  }
}
console.log('       at one context : ' + ['none', 'kgw', 'gumbel', 'synthid'].map(m => m + '=' + KL.fixed[m].toFixed(4)).join('  '));
console.log('       across contexts: ' + ['none', 'kgw', 'gumbel', 'synthid'].map(m => m + '=' + KL.varying[m].toFixed(4)).join('  '));
/* conditional on a fixed key+context, EVERY scheme is lopsided — this is the
   nuance "distortion-free" is usually mis-stated as denying */
check('KGW distorts at a fixed context', KL.fixed.kgw > 0.1, KL.fixed.kgw.toFixed(4));
check('Gumbel distorts at a fixed context (it is deterministic)', KL.fixed.gumbel > 1, KL.fixed.gumbel.toFixed(4));
check('SynthID distorts at a fixed context', KL.fixed.synthid > 0.1, KL.fixed.synthid.toFixed(4));
/* averaged over contexts the distortion-free schemes return to p exactly */
check('Gumbel is distortion-free across contexts', KL.varying.gumbel < 0.001, KL.varying.gumbel.toFixed(5));
check('SynthID is distortion-free across contexts', KL.varying.synthid < 0.001, KL.varying.synthid.toFixed(5));
check('KGW is NOT — residue well above the noise floor', KL.varying.kgw > 8 * KL.varying.none,
  KL.varying.kgw.toFixed(5) + ' vs floor ' + KL.varying.none.toFixed(5));

section('5. entropy governs strength');
for (const gr of ['prose', 'mixed', 'code', 'facts']) {
  const g = generate({ grammar: gr, method: 'synthid', key: KEY, gamma: .5, delta: 2, layers: 3, temp: 1, length: 400, seed: 'e' });
  const eff = g.steps.filter(s => !s.forced).length;
  const z = detectSynthID(g.toks, KEY, 3).z;
  console.log('       ' + gr.padEnd(6) + ' free ' + String(eff).padStart(3) + '/' + g.toks.length + '   z=' + z.toFixed(2));
}
const zProse = detectSynthID(generate({ grammar: 'prose', method: 'synthid', key: KEY, gamma: .5, delta: 2, layers: 3, temp: 1, length: 400, seed: 'e' }).toks, KEY, 3).z;
const zFacts = detectSynthID(generate({ grammar: 'facts', method: 'synthid', key: KEY, gamma: .5, delta: 2, layers: 3, temp: 1, length: 400, seed: 'e' }).toks, KEY, 3).z;
check('prose beats facts by a wide margin', zProse > zFacts + 4, zProse.toFixed(2) + ' vs ' + zFacts.toFixed(2));

section('6. attacks degrade the mark');
const atk = generate(Object.assign({}, base, { method: 'synthid', seed: 'atk', length: 400 }));
const z0 = detectSynthID(atk.toks, KEY, 3).z;
const zP = detectSynthID(paraphrase(atk.toks, 0.6, 'a').toks, KEY, 3).z;
const zA = detectSynthID(layerInflation(atk.toks, 0.6, KEY, 3, 'a').toks, KEY, 3).z;
console.log('       clean z=' + z0.toFixed(2) + '  paraphrase(60%) z=' + zP.toFixed(2) + '  adaptive(60%) z=' + zA.toFixed(2));
check('paraphrase weakens the mark', zP < z0 * 0.8, '');
check('adaptive attack beats blind paraphrase', zA < zP, '');
check('layers m=5 beats m=1 on the same text', (() => {
  const g5 = generate({ grammar: 'prose', method: 'synthid', key: KEY, gamma: .5, delta: 2, layers: 5, temp: 1, length: 400, seed: 'L' });
  const g1 = generate({ grammar: 'prose', method: 'synthid', key: KEY, gamma: .5, delta: 2, layers: 1, temp: 1, length: 400, seed: 'L' });
  const a = detectSynthID(g5.toks, KEY, 5).z, b = detectSynthID(g1.toks, KEY, 1).z;
  console.log('       m=5 z=' + a.toFixed(2) + '   m=1 z=' + b.toFixed(2));
  return a > b;
})(), '');

section('7. multi-bit payload round-trip');
const mbTry = (payload, L) => {
  const bits = Array.from({ length: 8 }, (_, i) => (payload >> (7 - i)) & 1);
  const g = generateMultibit({ bits, key: KEY, gamma: 0.5, delta: 3, length: L, seed: 'mb' });
  return decodePayload(g.toks, KEY, 0.5, 8).bits.reduce((a, x) => a * 2 + x, 0);
};
for (const payload of [22, 0, 255, 137, 99, 200]) {
  const got = mbTry(payload, 1200);
  check('payload ' + payload + ' recovered from 1200 tokens', got === payload, 'got ' + got);
}
/* and the flip side: a payload needs far more carrier than a single flag does */
let shortOk = 0;
for (let p = 0; p < 256; p += 17) if (mbTry(p, 400) === p) shortOk++;
check('short text loses the payload (the plate teaches this)', shortOk < 13, shortOk + '/16 recovered at 400 tokens');

section('8. semantic-space watermark');
const planes = lshPlanes(KEY, 3);
let acc = 0, surv = 0;
const rng = mulberry32(7);
for (let i = 0; i < 4000; i++) {
  const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.9;
  const pt = [Math.cos(a) * r, Math.sin(a) * r];
  if (!cellValid(lshCode(pt, planes), KEY)) continue;
  acc++;
  const b = rng() * Math.PI * 2, d = 0.12;
  if (cellValid(lshCode([pt[0] + Math.cos(b) * d, pt[1] + Math.sin(b) * d], planes), KEY)) surv++;
}
check('≈half of space is valid', Math.abs(acc / 4000 - 0.5) < 0.05, (acc / 4000).toFixed(3));
check('small paraphrase mostly survives', surv / acc > 0.8, (surv / acc * 100).toFixed(1) + '%');

section('9. detector is model-free (works on pasted human text)');
const human = tokenize("There is a particular kind of quiet that settles over a coastal town in the last week of the season, after the visitors have gone and before the weather turns properly hostile. The shops keep half-hours and the pier is closed for repairs that will not begin until spring.");
check('human text near zero', Math.abs(detectKGW(human, KEY, 0.5).z) < 2.5, 'z=' + detectKGW(human, KEY, 0.5).z.toFixed(2));

section('10. round-trip through the text (tokenize ∘ join)');
const rt = generate(Object.assign({}, base, { method: 'kgw', seed: 'rt' }));
const zBefore = detectKGW(rt.toks, KEY, 0.5).z;
const zAfter = detectKGW(tokenize(joinTokens(rt.toks)), KEY, 0.5).z;
check('serialising and re-tokenising preserves z', Math.abs(zBefore - zAfter) < 1e-9, zBefore.toFixed(4) + ' → ' + zAfter.toFixed(4));

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
