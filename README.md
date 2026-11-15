# Free Model Aggregator

An implementation for Make.fun's `free-model-aggregator-01` bounty. It exposes OpenAI Chat Completions and Anthropic Messages, discovers the ten simulated providers from the trial brief, routes only to free models that meet request capabilities, ranks by the brief's quality table, and fails over on provider errors.

Node built-ins only; runtime Node 22.23.4. JSON and incremental SSE translation support OpenAI, Anthropic and Gemini upstream wires. Streaming includes bounded frame decoding, error-first preflight, tool-block lifecycle handling, backpressure and disconnect cancellation. `lib/providers.ts` and `lib/wire.ts` retain MIT-licensed official starter utilities.

## Run locally

```sh
node --experimental-strip-types --test transforms.test.ts stream.test.ts
node --experimental-strip-types main.ts --list
```

Without a trial brief, `--list` prints `{"providers":[]}`. In a trial, `MAKEFUN_PROMPT_FILE` and `MAKEFUN_ENV_URL` supply the provider configuration and simulator. The server registers its catalog/port, handles `/v1/models`, `/v1/chat/completions` and `/v1/messages`, and exits when `/work` reports completion. Routing is deterministic.

From the official extracted kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/repository --driver process --instances 3 --bundle /path/to/transcripts.tar.gz
node cli/makefun.mjs check --kit . --repo /path/to/repository --transcripts /path/to/transcripts.tar.gz
```

All 26 synthetic tests pass; all three practice trials scored 99/100 and replayed byte-for-byte. See [TEST_RESULTS.md](./TEST_RESULTS.md).

## Provenance and submission status

The initial implementation predates the six authentic recorded Codex sessions supplied with this preparation. Its original coding session is unavailable; it has not been fabricated or reconstructed, and the six new sessions must not be represented as recording the initial build. They record genuine later implementation changes and tests. The official local checker passes the 30% transcript attribution gate (619 of 1,972 counted lines), but the rules request every session that built the entry, so organizer acceptance of the missing original session remains unresolved. See [TRANSCRIPT_WORKFLOW.md](./TRANSCRIPT_WORKFLOW.md).

This is a private local repository. No public repository, wallet signature, bounty registration, join or submission has been made. Local check success is not a prize guarantee or a substitute for server-side review.
