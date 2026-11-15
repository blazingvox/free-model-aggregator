# Local test results

## Verified behavior

Runtime: Node 22.23.4. The dependency-free command `node --experimental-strip-types --test transforms.test.ts stream.test.ts` passes all 26 tests. Coverage includes protocol conversion, split UTF-8/CRLF SSE decoding, bounded frames, incremental output, tool identity/block order, error-first preflight, structured quota errors, abort before/during replay, listener cleanup and backpressure.

| Practice trial | Score | Quality | Served | Wire | Failover | Catalog | Upstream calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 99/100 | 99 | 100 | 100 | 100 | 100 | 25 |
| 1 | 99/100 | 99 | 100 | 100 | 100 | 100 | 29 |
| 2 | 99/100 | 99 | 100 | 100 | 100 | 100 | 30 |

All three trials finished; all 20 requests per trial were valid. Every live/replay state matched byte-for-byte, and L1 regrade reproduced the result. Zero timeouts and zero nondeterministic trials. No external model-gateway requests; trial spend $0.

## Transcript checks

For the published baseline commit `a0bc59eb8e3d5e6f106683b1ec8243815b70099b`, the official local checker reports 14 passed, 0 failed, 5 skipped, and 5 checked only at submission. It parses six genuine Codex sessions: 302 messages, 127 matched tool results, 48 assistant text/thinking turns and 133 priced usage records. The transcripts account for 619/1,972 counted lines (31.3894523%), with 44 authored lines in `main.ts`. The local grader reports `ranked=true`, `prize_eligible=true`, `efficiency_eligible=false` with reason `coverage_below_gate`. Efficiency eligibility is distinct from the 30% transcript reproduction check.

## Important limits

The initial build transcript is unavailable. These six sessions document only later work; the local checker does not settle whether this satisfies the organizer's requirement to upload every session that built the entry. This must be disclosed, not concealed.

## Public repository and entry status

As of 2026-11-15, the public GitHub repository is [blazingvox/free-model-aggregator](https://github.com/blazingvox/free-model-aggregator); the results above describe the published baseline commit named above. No Make.fun wallet entry message has been signed and no entry has been submitted. The published baseline still needs the official README badges and GitHub About branding, and the wallet-only account needs `.makefun/owner.json` at the submitted commit. The process driver uses local loopback rather than the server's Docker isolation. Gitleaks is not installed; built-in checks found no model provider key and bundle redaction reported no secrets, but the server also runs Gitleaks. Repository ownership, branding, creation date, pushed commit, duplicate snapshot and the escrow entry signature remain server-side checks. Local results do not settle the missing-session policy question.
