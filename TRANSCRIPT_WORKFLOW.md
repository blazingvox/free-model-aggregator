# Authentic transcript workflow

## What was actually recorded

The initial private solution was implemented before a Make.fun-compatible recorder was available. Its original coding session is unavailable. It was not fabricated, retimestamped, summarized into a fake log or retroactively reconstructed.

Codex CLI 0.169.0 was installed and authenticated through the user's ChatGPT login. Six genuine new sessions in this repository made substantive changes: protocol parser regression coverage, incremental SSE translation, response lifecycle/backpressure, error-first preflight, structured provider error classification, and abort/reader ownership cleanup. The official bundler discovers and copies their unchanged harness-recorded logs; its own privacy redaction changes copies only. No API credential is included in the project or bundle.

## Local verification

From the official kit, against the private repository:

```sh
node cli/makefun.mjs bundle --repo /path/to/repository --out /private/path/transcripts.tar.gz --dry-run --json
node cli/makefun.mjs bundle --repo /path/to/repository --out /private/path/transcripts.tar.gz --json
node cli/makefun.mjs check --kit . --repo /path/to/repository --transcripts /private/path/transcripts.tar.gz
node cli/makefun.mjs grade-local --kit . --bot /path/to/repository --driver process --instances 3 --bundle /private/path/transcripts.tar.gz
```

The local checker accepts all checks it can run: six recorded sessions, valid timestamps/tool results, known-model pricing, sufficient turns/revisions, and 619/1,972 attributed lines (31.3894523%; threshold 30%). The entrypoint has 44 authored lines. No anchor was invented: `thinking_fresh` skips for the GitHub route. No `makefun init` was used.

## What these checks do not resolve

The official rules require every session that built the entry and prohibit withheld transcripts. Passing the mechanical coverage gate does not prove that omitting an unavailable earlier session is acceptable. The supplied sessions must be described as later development on an existing solution, never as the whole original build. Organizer confirmation or a genuinely new, fully recorded implementation may be necessary if all build sessions are required without exception. Do not manufacture a missing record or relabel old code as newly authored.

Publication and submission require separate user review. A public GitHub repository must be newly created after the competition opened, hold the approved commit and an OSI license, and satisfy account ownership (or carry the linked-wallet claim file). This bounty's official page reports Solana escrow, so an entry signature over the exact repository, commit, transcript hash, linked payout wallet, nonce and time is required. No new wallet or account should be created and no signing operation should occur without explicit approval.

Sources: https://make.fun/bounty/free-model-aggregator-01 and https://make.fun/api/competitions/free-model-aggregator-01/requirements .
