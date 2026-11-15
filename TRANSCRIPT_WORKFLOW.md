# Transcript provenance and entry status

The implementation in this proposed replacement was written in a fresh private rebuild from the official starter. The official Make.fun bundler found all 3 authentic Codex sessions that worked on that rebuild; none was filtered, rewritten, or reconstructed. The unchanged local archive contains those three sessions and has SHA-256 `bda950e175b9f9e8ac2ea6c243f67bb053ae52399ecd76aabfefa5d7a9c518dc`.

The local checker reports 104 priced usage records and passes the required authorship-reproduction threshold. The local practice grade reports `ranked yes, prize yes, efficiency no (coverage_below_gate)`. These are local results only. The checker notes that `gitleaks` is not installed in this environment; the site also runs it when an entry is submitted.

The transcript archive is separate from the Git repository and remains unchanged. No wallet entry message has been signed, no entry has been submitted, and this proposal has not been pushed. Under the official `makefun submit` flow, the signed Make.fun entry v1 message names the site, competition, repository URL, exact commit SHA, SHA-256 of the uploaded transcript bundle, payout wallet, fresh nonce, and timestamp. That signature would bind the reviewed commit and the exact bundle together; no such signature exists yet.

Sources: [Make.fun entry rules](https://make.fun/skill.md) and the official kit's `RULES.txt`.