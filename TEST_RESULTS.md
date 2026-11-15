# Test results

## Offline tests

Runtime: Node.js v22.23.4. `node --experimental-strip-types --test test/*.test.ts` passed 18 tests across two files. The tests cover provider schema extraction and validation, auth/base URL forms, ratings and workload parsing, OpenAI/Anthropic/Gemini catalog normalization, fail-closed capability checks, deterministic ordering, probe-error key redaction, request/response conversion, tool and image mapping, usage and stop mapping, SSE event order, and upstream SSE reassembly. They use temporary local files and stubbed fetch. `node --experimental-strip-types main.ts --list` exited 0 with `{"providers":[]}` when no trial prompt or environment URL was set.

## Local Make.fun checks

The official checker on this private replacement copy passed 14 checks, with 0 failed, 5 skipped, and 5 additional checks evaluated at submission. `thinking_reproduces` passed at 470/1,433 counted lines (32.7% as displayed by the checker; 0 pasted); `thinking_priced` passed with 104/104 usage records priced to known models. The local grade reports `ranked yes, prize yes, efficiency no (coverage_below_gate)`; the efficiency flag remains ineligible. The separate transcript-provenance usage estimate is $0.104609, not the grader's $0 model-request spend.

The three practice fixtures each finished at 99/100, with byte-for-byte replay matches; the mean was 99/100 (catalog 100, failover 100, quality 99, served 100, wire 100, working 1). The process-driver grader made 0 model requests and recorded $0 spend. These practice results are not the sealed final grade or a guarantee of an award.

Transcript bundle SHA-256: `bda950e175b9f9e8ac2ea6c243f67bb053ae52399ecd76aabfefa5d7a9c518dc`. The exact archive remains separate from the repository and has not been uploaded. No Make.fun wallet entry message has been signed and no entry has been submitted.

The local checker reports that `gitleaks` is not installed here; the site also runs it at submission. The archive was created by the official bundler with its built-in redaction. For streaming, OpenAI-to-OpenAI SSE is passed through; cross-wire translated streams are buffered to completion before the translated SSE response is sent, so those paths do not provide token-by-token latency.

The exact checker and grade were rerun on the separate private replacement copy; the review summary records any difference from the original rebuild path.
