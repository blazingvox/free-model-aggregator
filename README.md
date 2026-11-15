# Free Model Aggregator

A private implementation for Make.fun's `free-model-aggregator-01` bounty. It exposes OpenAI Chat Completions and Anthropic Messages, discovers the ten simulated providers from the trial brief, routes only to free models that meet the request capabilities, ranks candidates by the published quality table, fails over on provider errors, and translates JSON/SSE between OpenAI, Anthropic, and Gemini provider wires.

The server uses Node's built-in modules only. It reads `MAKEFUN_PROMPT_FILE` and `MAKEFUN_ENV_URL`, probes provider catalogs, posts the catalog to `/register`, handles `/v1/models`, `/v1/chat/completions`, and `/v1/messages`, then polls `/work`. Routing and response construction avoid wall-clock values and randomness so the local replay check can reproduce each trial. `lib/providers.ts` and `lib/wire.ts` retain the official MIT-licensed starter utilities; `lib/transforms.ts` contains the additional wire conversions and SSE normalization.

## Local check

Run the official dev-kit grader from the extracted kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/solution --driver process --instances 3
```

Use Node 22.23.4. The three public practice fixtures each scored 99/100; see [TEST_RESULTS.md](./TEST_RESULTS.md). The process driver is unisolated loopback testing, not the server's Docker sandbox. The tests used the fixture's local simulated providers only; they made no calls to an external model gateway and incurred $0 model-call cost.

## Important before submission

Nothing in this folder has been pushed, published, registered, or submitted. The local grader currently reports `prize_eligible: false` because it received no qualifying coding-agent transcript (`no_transcripts`, `coverage_below_gate`, `cost_unpriced`). The official rules require authentic, recorded/exported coding-agent session transcripts; this project does not include a fabricated transcript. Review the code and arrange a qualifying recorded session before any submission if prize eligibility matters.

See [TRANSCRIPT_WORKFLOW.md](./TRANSCRIPT_WORKFLOW.md) for the official, non-retroactive transcript workflow and the remaining user action.
