# Preserved A/B Evidence

This directory preserves the reviewed `yam-ab-v2` targeted run for
`safe-upload-path`.

- Run id: `yam-ab-2026-07-30T03-58-32-936Z-9cd14cc1`
- Baseline commit: `bfc09e66e23cc0ea05a3e04fb9efa0a7cc3664db`
- Model: `gpt-5.6-sol`
- Reasoning effort: `medium`
- Repetitions: three per arm
- Automated result: both arms passed 3/3 with no hard-gate regression
- Blind review: three ties, no unresolved safety concern
- Final decision: `retain_baseline_or_inconclusive`

The JSON files, six run receipts, and six submitted implementations are exact
copies from the retained result directory. `unblinding-key.json` is preserved
only because review was already finalized and the arm mapping is required for
audit. Do not expose an unblinding key before a future review is complete.

The runner discarded raw Codex JSONL and removed its editable OS-temporary work
root after observing every child exit. No pricing estimate was produced because
the run had no explicit pricing contract.

Verify archive integrity from this directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Treat this directory as immutable. Preserve a future run in a new directory
instead of replacing these files.
