# Local test results

## Official practice grader

Command: `node cli/makefun.mjs grade-local --kit . --bot /workspace/free-model-aggregator/solution --driver process --instances 3 --save /workspace/free-model-aggregator/local-run-node22 --json`.

| Practice trial | Score | Quality | Served | Wire | Failover | Catalog | Upstream calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 99/100 | 99 | 100 | 100 | 100 | 100 | 25 |
| 1 | 99/100 | 99 | 100 | 100 | 100 | 100 | 29 |
| 2 | 99/100 | 99 | 100 | 100 | 100 | 100 | 30 |

All three trials finished, all 20/20 requests in each trial were valid, and every replay matched its live pass. There were no timeouts or nondeterministic trials. The grader reported zero spend and zero model-gateway requests. The test ran on Node 22.23.4, matching the kit's declared runtime; there was no runtime-version mismatch.

## Remaining caveats

The harness reported `prize_eligible: false` with `no_transcripts`, `coverage_below_gate`, and `cost_unpriced`. This is not a score failure: it is a separate submission/transcript gate. No transcript was manufactured. The process driver also runs unisolated on loopback and does not replicate the server's Docker network sandbox, although all three local fixture replays passed.
