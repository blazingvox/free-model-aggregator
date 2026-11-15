# free-model-aggregator

[![make.fun · free-model-aggregator-01](https://make.fun/badge/free-model-aggregator-01.svg)](https://make.fun/bounty/free-model-aggregator-01?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)
[![rank](https://make.fun/badge/free-model-aggregator-01/blazingvox/free-model-aggregator/rank.svg)](https://make.fun/bounty/free-model-aggregator-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)
[![reward](https://make.fun/badge/free-model-aggregator-01/blazingvox/free-model-aggregator/reward.svg)](https://make.fun/bounty/free-model-aggregator-01?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-01)

An OpenAI- and Anthropic-compatible gateway that routes across ten simulated free-tier providers, selects an eligible high-quality model, exposes catalogs, and fails over on provider errors. It uses Node.js built-ins and targets Node 22.

## Run and test

```sh
node --experimental-strip-types main.ts
node --experimental-strip-types --test test/*.test.ts
node --experimental-strip-types main.ts --list
```

The dependency-free unit suite covers provider configuration, catalog normalization, protocol conversion, and SSE framing. See [TEST_RESULTS.md](./TEST_RESULTS.md) for the private rebuild's local practice-grade and checker results.

The practice grade reports `ranked yes, prize yes, efficiency no (coverage_below_gate)`; this is not a guarantee of an award. `gitleaks` was unavailable locally, and the site runs its own secret scan at submission.

## Streaming behavior

The gateway accepts and returns SSE. OpenAI-to-OpenAI SSE is passed through as it arrives. Cross-wire translated streams from Anthropic or Gemini are buffered to completion before translated SSE is sent, so those paths do not provide token-by-token latency.

## Provenance and entry status

This proposed replacement was rebuilt from the official Make.fun starter in three authentic recorded Codex sessions. The official local checker passed the transcript authorship and usage-pricing checks; the practice grade reports `ranked yes, prize yes, efficiency no (coverage_below_gate)`, so efficiency remains ineligible and no award is guaranteed. The exact transcript archive remains separate from the repository and is identified in [TRANSCRIPT_WORKFLOW.md](./TRANSCRIPT_WORKFLOW.md). No Make.fun wallet entry message has been signed and no entry has been submitted.

The existing Make.fun badges, `.makefun/owner.json`, and GitHub About metadata are preserved. The metadata is not changed by this private proposal.
