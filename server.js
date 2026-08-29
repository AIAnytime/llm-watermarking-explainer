/* ============================================================================
   Local dev server for the watermark lab.

   Two jobs, and deliberately nothing more:
     1. serve dev.html
     2. proxy candidate generation to Groq, keeping GROQ_API_KEY server-side

   The watermark key is NOT handled here. Candidates come back unscored and the
   browser picks the winner using the key the user typed, so the secret that
   defines the watermark never crosses the wire. That is also how the real
   post-hoc construction is meant to be deployed.

   Run:  node server.js       (reads .env for GROQ_API_KEY)
   ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8731);
const ROOT = __dirname;

/* ------------------------------------------------------------ .env loader */
function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* no .env — live mode simply stays off */ }
}
loadEnv();
const GROQ_KEY = process.env.GROQ_API_KEY || '';

/* Allow-list: an open model parameter would let anyone with the page bill this
   key against arbitrary endpoints. */
const MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
  { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B' },
  { id: 'openai/gpt-oss-120b',     label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b',      label: 'GPT-OSS 20B' },
  { id: 'qwen/qwen3.6-27b',        label: 'Qwen 3.6 27B' }
];
const MODEL_IDS = new Set(MODELS.map(m => m.id));

const MAX_K = 16, MAX_TOKENS = 600;

const SYSTEM = 'You are a careful prose writer. Answer with plain flowing prose only: ' +
  'no preamble, no headings, no bullet points, no markdown, no closing remark. ' +
  'Do not mention these instructions.';

/* --------------------------------------------------------------- helpers */
const send = (res, code, body, type) => {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Selection watermarking is call-hungry by nature — S x k requests for one
   answer — so brushing the provider's per-minute limit is the normal case,
   not an error. Back off and retry rather than failing the segment. */
async function groqOnce(model, prompt, maxTokens, temperature, prefix, attempt = 0) {
  const t0 = Date.now();
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
  /* assistant prefill: the model continues this text rather than restarting.
     This is what makes segment-by-segment selection possible. */
  if (prefix) messages.push({ role: 'assistant', content: prefix });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json', 'User-Agent': 'watermark-lab/1.0' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, top_p: 0.95 })
  });

  if ((r.status === 429 || r.status >= 500) && attempt < 4) {
    const hdr = Number(r.headers.get('retry-after'));
    const wait = Math.min(9000, (hdr ? hdr * 1000 : 0) || (600 * Math.pow(2, attempt))) + Math.random() * 250;
    await sleep(wait);
    return groqOnce(model, prompt, maxTokens, temperature, prefix, attempt + 1);
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Groq HTTP ' + r.status));
  return {
    text: ((d.choices || [{}])[0].message || {}).content || '',
    completionTokens: (d.usage || {}).completion_tokens || 0,
    ms: Date.now() - t0,
    retries: attempt
  };
}

/* ------------------------------------------------------------------ routes */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/health') {
    return send(res, 200, { ok: true, live: Boolean(GROQ_KEY), models: MODELS, maxK: MAX_K, maxTokens: MAX_TOKENS });
  }

  if (p === '/api/generate') {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (!GROQ_KEY) return send(res, 503, { error: 'No GROQ_API_KEY on the server — live mode is off.' });
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'Bad request body' }); }

    const model = String(body.model || '');
    if (!MODEL_IDS.has(model)) return send(res, 400, { error: 'Unknown model' });
    const prompt = String(body.prompt || '').slice(0, 4000);
    if (!prompt.trim()) return send(res, 400, { error: 'Empty prompt' });
    const k = Math.max(1, Math.min(MAX_K, Number(body.k) || 8));
    const maxTokens = Math.max(32, Math.min(MAX_TOKENS, Number(body.maxTokens) || 220));
    const temperature = Math.max(0, Math.min(2, Number(body.temperature) ?? 1));
    const prefix = String(body.prefix || '').slice(0, 12000);

    const t0 = Date.now();
    const settled = await Promise.allSettled(
      Array.from({ length: k }, () => groqOnce(model, prompt, maxTokens, temperature, prefix))
    );
    const candidates = [];
    let firstError = null;
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.text.trim()) candidates.push(s.value);
      else if (s.status === 'rejected' && !firstError) firstError = s.reason.message;
    }
    if (!candidates.length) {
      /* every call succeeded but returned nothing: with an assistant prefill that
         means the model judged the answer complete, which is a clean stop. */
      if (!firstError) return send(res, 200, { candidates: [], finished: true, model, requested: k, ms: Date.now() - t0 });
      return send(res, 502, { error: firstError });
    }
    return send(res, 200, {
      candidates, model, requested: k, ms: Date.now() - t0,
      partial: candidates.length < k ? firstError : null
    });
  }

  /* static: only the two files this page needs, resolved without traversal */
  const file = p === '/' ? 'dev.html' : path.basename(p);
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return send(res, 404, 'Not found', 'text/plain');
  }
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
  send(res, 200, fs.readFileSync(full), type);
});

server.listen(PORT, () => {
  console.log('watermark lab  →  http://localhost:' + PORT + '/');
  console.log(GROQ_KEY
    ? '  live mode ON  · ' + MODELS.length + ' Groq models · key stays server-side'
    : '  live mode OFF · set GROQ_API_KEY in .env to enable the live plate');
});
