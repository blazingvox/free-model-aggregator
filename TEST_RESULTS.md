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

The official local checker reports 14 passed, 0 failed, 5 skipped, and 5 checked only at submission. It parses six genuine Codex sessions: 302 messages, 127 matched tool results, 48 assistant text/thinking turns and 133 priced usage records. The transcripts account for 619/1,972 counted lines (31.3894523%), with 44 authored lines in main.ts. The local grader reports ranked=true, prize_eligible=true, efficiency_eligible=false with reason coverage_below_gate. Efficiency eligibility is distinct from the 30% transcript reproduction check; no further edits were made merely to pursue it.

## Important limits

The initial build transcript is unavailable. These six sessions document only later work; the local checker does not settle whether this satisfies the organizer's requirement to upload every session that built the entry. This must be disclosed, not concealed.

The process driver uses local loopback rather than the server's Docker isolation. Gitleaks is not installed; built-in checks found no model provider key and bundle redaction reported no secrets, but the server also runs Gitleaks. Repository ownership/publication, creation date, pushed commit, duplicate snapshot and the escrow entry signature are server-side checks. No public repo or submission exists yet.
