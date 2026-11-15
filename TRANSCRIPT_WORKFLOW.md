# Authentic transcript workflow

## What Make.fun accepts

The official kit's `makefun bundle` command can collect Cue session records from `~/.cue/agents/*/sessions`. It supports a dry run and can collect sessions whose tools name files inside the repository. The official transcript gate requires recorded/exported session records, not a manually reconstructed conversation. Its current rules also require enough transcript-to-code attribution, at least one authored line in `main.ts`, five assistant turns with text/thinking, and two assistant writes/edits affecting a final source file. The `thinking_fresh` check may be skipped as a note when no pre-write anchor is available; it is not a reason to invent one after the fact.

## Current status

This sandbox has no `~/.cue/agents` directory, and the solution folder is not a Git repository. The local grader therefore had no official Cue transcript to bundle and reported `prize_eligible: false` (`no_transcripts`, `coverage_below_gate`, `cost_unpriced`). The compacted task history is not a Make.fun-recognized Cue session export, so it was not repackaged or used as a transcript. No `makefun init`, repository creation, GitHub publication, account action, signing, joining, or submission has been performed.

## What is needed next

On the computer where the original Cue session is genuinely recorded, place/open the reviewed project in a local Git repository that can be matched to that session. Use the kit's official bundler in dry-run mode first:

```sh
node <kit>/cli/makefun.mjs bundle \
  --repo <local-repository> \
  --out <bundle.tar.gz> \
  --cue-dir ~/.cue/agents \
  --dry-run
```

Confirm that it finds the original session and filters the relevant project work. Then run the same command without `--dry-run` to create the real bundle, and provide that authentic `.tar.gz` for local verification. The official grader accepts a bundle through `grade-local --bundle <bundle.tar.gz>`; that check can confirm the transcript gate without publishing or submitting anything.

If the original recorded session is not available, it cannot be recreated retroactively. The remaining legitimate route is to continue the project in a coding-agent client that records its sessions, with meaningful new edits to the actual code and the required transcript coverage; the original implementation should not be passed off as work performed in that new session. The official rules name Cue as a discoverable session source and also mention Superbot as an alternative recorder.


## Environment checked for a new recorded session

The current sandbox has no installed Codex, Claude, Cursor Agent, Gemini CLI, OpenCode, Aider, or Superbot command; no corresponding local session stores or local model server were found. This shell also has no model API credentials available. Official Codex setup needs either a ChatGPT sign-in or a custom provider using the Responses API, so I have not started it, signed in, or made any model calls. The existing sandbox project has not been initialized as a Git repository. To create a qualifying new session, the next step needs either a user-supplied recorded-agent environment/bundle or explicit authorization and access for an appropriate client/account; any paid plan, payment, or unapproved usage remains out of scope.
