# Holdline

A payment-control agent. It checks every payment in an accounts-payable run before the money leaves and holds the ones that should not be paid: duplicate invoices, invoices split to dodge the approval limit, invoices that do not match the purchase order or receipt, and unverified bank detail changes.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No keys are needed. Copy `.env.example` to `.env.local` to add a model and ElevenLabs voice.

## How it fits together

| Path | What it is |
|---|---|
| `scripts/generate-data.mjs` | Builds the synthetic dataset and the answer key. `node scripts/generate-data.mjs <seed>` makes a fresh one. |
| `src/data/dataset.json`, `labels.json` | 522 invoices (120 in the run), 25 planted problems, 5 legitimate look-alikes. |
| `src/lib/engine.ts` | The four tools and the deterministic agent. `v1` is the baseline, `v2` the fixed version. |
| `src/lib/llm.ts` | The LLM agent: a tool-calling loop over any OpenAI-compatible endpoint. Falls back to the rules engine on error. |
| `src/lib/trace.ts` | Every investigation passes through `exportTrace`. Wire PRISM in here. |
| `src/lib/evaluate.ts`, `/api/eval` | Scores both versions against the answer key. `/api/eval?engine=llm` scores the LLM agent. |
| `/api/run` | Streams one verdict per payment (server-sent events). |
| `src/lib/kb.ts`, `/api/kb` | The knowledge base: one vendor's records and how they link, for the Knowledge base tab. |
| `/api/voice` | ElevenLabs text to speech for the callback call. |
| `src/components/` | The UI: payment run, evidence drawer, callback call, proof screen. |

## Current scores (rules engine, seed 20261121)

| | Caught | False alarms | Money at risk stopped |
|---|---|---|---|
| Agent v1 | 7 / 25 | 0 | $39,125 of $179,931 |
| Agent v2 | 23 / 25 | 3 | $164,196 of $179,931 |

The planted cases were known while the checks were written, so this is a regression test, not a field result.
