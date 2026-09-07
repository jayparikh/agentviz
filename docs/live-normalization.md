# Incremental live normalization

AGENTVIZ retains normalization state for Claude Code, Copilot CLI, Codex rollout JSONL, and VS Code base-plus-patch JSONL. This replaces the worker-only mitigation in PR #131. The batch `parseSession` path remains an independent oracle for complete normalized events, turns, and metadata.

## Contracts

- JSON decoding consumes complete new records. Blank lines and CRLF are accepted. An unfinished trailing record is buffered; no warning is emitted until an invalid line is complete. Complete JSON records without a trailing newline remain accepted for the existing SSE/client contract.
- `createLiveSessionParser` creates a single-owner accumulator. Append calls consume that state; callers must not branch by appending independently to an old state handle.
- Published results are independent snapshots by default, preserving prior render state even when an early event changes. The worker opts out of this extra copy with `{ snapshot: false }`; `postMessage` performs the required structured clone instead.
- Initial loading visits the initial history once. Ordinary appends retain records, event indices, turns, model counts, usage totals, and indexed duration maxima. No full-history concatenation of record arrays or batch-parser invocation occurs on ordinary appends.
- Sparse numeric indices have a fixed 32-level address space. Sorted timeline/turn lookups use binary search. Metadata publication also depends on the number of distinct models/reasoning efforts, not just the appended record count.
- Reset or file truncation creates a fresh accumulator. The single-flight client discards pending pre-reset batches and their results. An empty normalized session is published as `null`, including VS Code removal of all requests.
- An incompatible format declaration invalidates the format-dependent state. Static non-JSONL formats continue using their existing import parsers; this is not incremental support for arbitrary JSON documents.

## Format-specific dependencies

| Format | Retained state and affected updates |
| --- | --- |
| Claude Code | Synthetic and real timestamps, timestamp-majority decision, absolute-time minima, original event durations, deduplicated usage maxima, first usage-bearing event, session identity, and tool/result indices. A later usage fragment updates the first matching assistant event. An ordinary append recalculates only the previous boundary duration and new events. |
| Copilot CLI | Completion records, tool/message dependency lists, task/subagent identity, reasoning-effort boundaries, explicit turns, and per-turn maxima/error/tool counts. Completion updates keep unchanged `eventIndices` membership in place. Shutdown usage/cost and session metadata use the latest applicable records. |
| Codex | Current model/turn context, lifecycle records, cumulative token totals, web-search association indices, sorted events, explicit/unbound turn membership, and active turn aggregates. Late lifecycle and context changes update relevant turns and formerly unbound events. |
| VS Code | An owned mutable patch tree, cached request offsets, response-part positions, and per-request error counts. Local tool-result/content patches remap the affected response part. Structural response edits recalculate the affected request's proportional timestamps and propagate minimum-spacing changes only until boundaries settle. |

Global changes are not incorrectly treated as constant work. A changed timestamp origin or Claude timestamp-majority decision can affect the entire timeline. An out-of-order event or a structural request edit can shift an entire suffix of public evidence indices. New reasoning-effort or lifecycle information can affect earlier events. These changes explicitly invalidate affected state rather than leaving stale timestamps, memberships, totals, or tool outputs. They may require history-sized work when history-sized output changes.

## Deterministic work and measurements

`normalizationWork` reports records/requests examined, event visits or updates, and turn membership/aggregate updates for the last append. Counts include affected old records, not just newly decoded lines. A VS Code patch plus its normalized request counts as two record/request operations. Counts are instrumentation, not CPU instruction counts. Separate regressions intercept turn-array `splice` to ensure completion updates do not hide history-sized index shifts.

Run the existing Vitest runner:

```powershell
npm test -- src\__tests__\liveNormalizationBenchmark.test.ts
```

The benchmark calls the retained normalizer directly, excluding JSON decoding and publication. It takes medians of 11 equal ten-record batches after 100 and 10,000 historical items. Copilot CLI and Codex retain a single large active turn; VS Code uses independent requests with a user message and response. Timing is observational, not a flaky test threshold. Equal deterministic work is asserted.

Representative Windows results:

| Format | Record/event/turn operations, both histories | Normalization ms, 100 / 10,000 | Snapshot clone ms, 100 / 10,000 |
| --- | --- | --- | --- |
| Claude Code | 10 / 22 / 11 | 0.052 / 0.076 | 0.518 / 40.226 |
| Copilot CLI | 10 / 10 / 10 | 0.092 / 0.147 | 0.385 / 27.763 |
| Codex | 10 / 20 / 12 | 0.105 / 0.178 | 0.483 / 32.735 |
| VS Code | 20 / 30 / 10 | 0.073 / 0.230 | 0.802 / 68.288 |

Snapshot cloning is deliberately measured separately. It is not constant-time, nor is full worker serialization, raw-text transfer, downstream rendering, or derived UI computation. The browser worker test additionally checks actual worker/client delivery and timer progress; main-thread append timings in the existing cleanup benchmark include snapshot copying.

## Regression coverage

- Batch/live parity at every completed fixture prefix, including the multi-agent fixture.
- One-record, three-record, whole-batch, and seeded random byte partitions; blank/CRLF records and unfinished tails.
- Seeded out-of-order records, changed origins, timestamp-majority transitions, late/repeated tool results, cumulative usage, model/effort changes, shutdown, and resume.
- Late Codex lifecycle activation/deactivation and Copilot completion membership regressions found during self-review.
- Bound checks after 100/5,000 historical records, including one VS Code tool-result patch in a request containing 5,000 sibling responses.
- Real HTTP snapshot/SSE append and truncation-reset tests for every live format, plus cursor resume and partial UTF-8 regressions.
- Actual browser worker append parity and queued-reset discard for every live format, alongside the existing v2 and cleanup browser suites.

```powershell
npm test
npm run typecheck
npm run build
npx playwright test 'v2-smoke.spec.js' 'cleanup.spec.js' 'live-normalization.spec.js'
```
