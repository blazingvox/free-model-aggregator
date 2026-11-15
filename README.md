# free-model-aggregator

[![make.fun · free-model-aggregator-01](https://make.fun/badge/free-model-aggregator-01.svg)](https://make.fun/bounty/free-model-aggregator-01?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)
[![rank](https://make.fun/badge/free-model-aggregator-01/blazingvox/free-model-aggregator/rank.svg)](https://make.fun/bounty/free-model-aggregator-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)
[![reward](https://make.fun/badge/free-model-aggregator-01/blazingvox/free-model-aggregator/reward.svg)](https://make.fun/bounty/free-model-aggregator-01?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)

An OpenAI- and Anthropic-compatible gateway that routes requests across ten simulated free-tier providers, selects an eligible high-quality model for each request, supports JSON and streaming, exposes catalogs, and fails over when a provider refuses.

## Run it

```sh
node --experimental-strip-types main.ts
```

## Implementation

Node built-ins only; runtime Node 22.23.4. JSON and incremental SSE translation support OpenAI, Anthropic and Gemini upstream wires. Streaming includes bounded frame decoding, error-first preflight, tool-block lifecycle handling, backpressure and disconnect cancellation. `lib/providers.ts` and `lib/wire.ts` retain MIT-licensed official starter utilities.

Without a trial brief, `node --experimental-strip-types main.ts --list` prints `{"providers":[]}`. In a trial, `MAKEFUN_PROMPT_FILE` and `MAKEFUN_ENV_URL` supply the provider configuration and simulator. The server registers its catalog/port, handles `/v1/models`, `/v1/chat/completions` and `/v1/messages`, and exits when `/work` reports completion. Routing is deterministic.

## Local checks

```sh
node --experimental-strip-types --test transforms.test.ts stream.test.ts
node --experimental-strip-types main.ts --list
```

From the official extracted kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/repository --driver process --instances 3 --bundle /path/to/transcripts.tar.gz
node cli/makefun.mjs check --kit . --repo /path/to/repository --transcripts /path/to/transcripts.tar.gz
```

All 26 synthetic tests pass; all three practice trials scored 99/100 and replayed byte-for-byte. See [TEST_RESULTS.md](./TEST_RESULTS.md).

## Provenance and submission status

The public repository is [blazingvox/free-model-aggregator](https://github.com/blazingvox/free-model-aggregator). As of 2026-11-15, no Make.fun entry signature or submission has been made. The initial implementation predates the six authentic recorded Codex sessions; its original coding session is unavailable. The six sessions document genuine follow-up implementation changes and tests only. No session was fabricated or reconstructed. Whether the available sessions satisfy prize eligibility remains unresolved and requires Make.fun's guidance. See [TRANSCRIPT_WORKFLOW.md](./TRANSCRIPT_WORKFLOW.md).
