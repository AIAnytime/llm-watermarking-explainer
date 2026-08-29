# The Green List

An interactive explainer for **LLM text watermarking** — the technique Anthropic
shipped for Claude in August 2026, and the ten years of research behind it.

Everything on the page is computed in the browser from the key you type. There
are no canned outputs, no pre-rendered figures, and no hand-written numbers: the
z-scores, KL divergences, decoded payloads and attack curves are all produced by
running the actual algorithms.

![The Green List — the opening plate: three passages that look identical, and the
detector separating the marked one at z = 5.54](docs/screenshot.png)

## Run it

```bash
node server.js          # → http://localhost:8731/
```

Static-only (no live models, everything else works):

```bash
./build.sh && open dev.html
```

## What's in it

Fourteen interactive plates, following the argument rather than the chronology:

| | Plate | Shows |
|---|---|---|
| A | One position, one distribution | where the freedom to hide a bit actually lives; entropy as capacity |
| B | The green list | key + context → vocabulary split, and the KL cost of δ |
| C | Detector bench | paste anything; z-score, p-value, per-token evidence |
| D | Did the distribution survive? | Monte Carlo, **conditional vs marginal** distortion |
| E | Gumbel-max | the rigged draw, and why determinism kills it for chat |
| F | Tournament sampling | the SynthID bracket, seats vs probability |
| G | The lab | full generator + per-token inspector, four schemes |
| H | Capacity map | per-token entropy; why factual text carries nothing |
| I | Attack bench | paraphrase, adaptive, truncate, translate |
| J | Thresholds | null vs signal distributions, FPR/TPR, √length |
| K | Semantic space | SemStamp-style LSH partitioning, paraphrase survival |
| L | Multi-bit | write 8 bits into prose, read them back |
| M | Claim checker | what a detection does and does not license |
| **N** | **Live post-hoc** | **selection watermarking against real models via Groq** |

## The live plate

Plates A–M run a toy slot-grammar language model, because green lists, Gumbel
and tournament sampling all require access to the sampling loop — which no
hosted API exposes. (Groq confirms this: `logprobs` is rejected by every model
it serves.)

Plate N runs the one construction that *doesn't* need that access. Post-hoc
**selection** watermarking asks the model for k continuations, scores each one
under the secret key, keeps the best, and repeats for S segments. The model is
never modified; the mark lives entirely in which draft survived.

It is implemented the way the paper describes, including the part most summaries
skip: selecting once over a whole document buys only about `√(2·ln k)` ≈ 1.4σ at
k = 8, which is useless. Selecting per segment compounds it to roughly
`√S · √(2·ln k)`. That's the "inference-time scaling" in SAEMark's title, and
it costs S × k API calls per answer. The plate reports that bill next to the
evidence gained, and builds a **control document** from the same candidate pools
with the selection step removed, so the gain attributable to the key is visible
directly.

### Keys

Two different secrets, deliberately kept apart:

- `GROQ_API_KEY` lives in `.env` and never leaves the server.
- The **watermark key** is typed in the browser and never leaves it. The server
  returns candidates unscored; selection happens client-side.

Set up `.env`:

```
GROQ_API_KEY=gsk_...
```

Without it the server still runs; Plate N shows an offline notice and the other
thirteen plates are unaffected.

## Layout

```
src/00-head.html     <title> + all CSS (design tokens, light/dark)
src/1*-body-*.html   page markup, in reading order
src/50-core.js       the engine: PRF, toy LM, samplers, detectors, chart kit
src/60-ui.js         one IIFE per plate
build.sh             concatenates src/ → index.html (+ dev.html for local preview)
server.js            static server + Groq proxy
test/sanity.js       30 headless checks on the engine
```

`index.html` is self-contained and has no `<html>/<head>/<body>` wrapper, so it
can be published as an Artifact directly. `dev.html` is the same file inside a
minimal skeleton for opening in a browser.

## Tests

```bash
node test/sanity.js
```

Checks the engine end to end, including the properties the page makes claims
about:

- marked text separates from unmarked under all three schemes
- the wrong key, and the wrong scheme, both collapse to z ≈ 0
- **null calibration**: over 300 unmarked passages the statistic has mean ≈ 0 and
  sd ≈ 1, and never crosses z = 4 — the false-positive rate is real, not asserted
- repeated-context dedup keeps repetitive text honest (without it, factual and
  code samples produce fake signal)
- Gumbel and tournament are distortion-free *across contexts* but visibly skewed
  *at a fixed context* — the distinction the page argues most explainers drop
- attacks degrade the mark, and the adaptive attack beats blind paraphrase
- multi-bit payloads round-trip at 1200 tokens and fail at 400

## Caveats

The schemes are faithful to the published constructions in structure. The
vocabulary, the model and the scale are toys — a few hundred words and explicit
per-position distributions, small enough to be transparent. Plate N is the
exception and uses real models.

Plate B uses the hash-per-candidate form of KGW rather than a full vocabulary
permutation; same statistics, far less work per keystroke. Context width is
H = 4 tokens, matching SynthID-Text rather than KGW's H = 1.

## Sources

Built from Kaito Sugimoto's survey article (`idea.txt`) and the papers it cites:
Kirchenbauer et al. (ICML 2023), Aaronson (2022), Kuditipudi et al. (2023),
Dathathri et al. (Nature 2024), Krishna et al. (NeurIPS 2023), Hou et al. (NAACL
2024), Ai & He (ICML 2026), Qu et al. (USENIX Security 2025), Yu et al. (NeurIPS
2025), and Anthropic's own documentation.
