# feat: Improve Session Q&A performance, UX, and answer quality

## Summary

Enhances the Session Q&A drawer with better performance, richer instant answers, persistent history, and polished UX -- all without adding any new dependencies.

## Key Changes

### Performance

- **Expanded instant classifier** (9 → 18 patterns): Files, commands, turn ranges, first/last turn, session format, user messages, event count, specific tool detail. Questions like "what files were edited?" or "how many times was bash used?" now answer in <5ms instead of hitting the model.
- **Paraphrase-aware answer caching**: Model answers are cached by question fingerprint. Rephrased questions ("what tools were used?" vs "which tools did it call?") get the same cached answer instantly. Cache is per-session, cleared on session switch or Clear button.
- **Question-aware context windowing**: Instead of always sending top-20 tools + 5 user messages to the model, the context is tailored to the question topic. Error questions get error samples, file questions get file operations, turn questions get full turn events. This produces smaller, more relevant context for faster model responses.
- **Session rotation with recap**: After 6 model-backed questions, a compact recap of the last 4 Q&A pairs is injected into the context so the model retains conversational continuity without carrying the full token weight of all prior exchanges.

### UX

- **Answer timing display**: Every answer shows how long it took. Instant answers show "⚡ instant · 1ms". Model answers show "answered in 8.3s". Cached answers show "↻ cached answer · 0ms".
- **Persistent Q&A history**: Conversations survive session navigation via localStorage. Return to a session and your prior Q&A is restored. The Clear button removes both in-memory and persisted state.
- **Turn reference linking**: Broad regex covering `[Turn 5]`, `[Turn 0, Turn 5]`, `[Turn 10 - 20]`, `[Turns 0-5]`, unbracketed `Turn 3`, and case-insensitive variants. Each turn index is a clickable link that jumps to the Replay view.
- **Inline code rendering**: Backtick-wrapped text in answers renders as styled `code` spans.
- **Keyboard polish**: Up-arrow recalls last question when input is empty.
- **Progress indicators**: Shows "Connecting to AI...", "Receiving answer...", "Thinking..." during model calls instead of a blank spinner.
- **Graceful SDK fallback**: When the Copilot SDK isn't running, shows "AI answers unavailable -- instant answers still work" instead of a cryptic timeout error.
- **60s timeout** (up from 30s): If the model has already started streaming when timeout hits, completes gracefully instead of showing an error.

### System prompt improvements

- Explicit rules: markdown format, `[Turn N]` linking, no speculation
- 300-word limit for concise responses
- "Show top 5-10 for long lists" instruction

## New instant answer patterns

| Pattern | Example question | Response time |
|---------|-----------------|---------------|
| files | "What files were edited?" | <5ms |
| commands | "What commands were run?" | <5ms |
| turnRange | "What happened in turns 0-5?" | <5ms |
| firstTurn | "What was the first thing done?" | <5ms |
| lastTurn | "What was the last turn?" | <5ms |
| format | "What format is this session?" | <1ms |
| userMsgs | "What did the user ask?" | <5ms |
| events | "How many events?" | <1ms |
| toolDetail | "How many times was bash used?" | <5ms |

## Testing

- **325 unit tests passing** (18 new classifier tests)
- **Build clean** (Vite production build)
- All existing tests unmodified and passing

## Screenshots

### Empty Q&A drawer
![Q&A drawer empty](docs/screenshots/qa-drawer-empty.png)

### Instant answer with timing
![Instant timing](docs/screenshots/qa-instant-timing.png)

### User messages with clickable turn references
![User messages](docs/screenshots/qa-user-messages.png)

## Files changed

| File | Change |
|------|--------|
| `src/hooks/useQA.js` | Persistent history, answer caching, session rotation, timing, progress phases |
| `src/lib/qaClassifier.js` | 9 new patterns, question fingerprinting, context windowing |
| `src/lib/qaAgent.js` | Improved system prompt, context formatting for new fields |
| `src/components/QADrawer.jsx` | Turn linking, code rendering, timing display, keyboard UX, progress |
| `src/__tests__/qaClassifier.test.js` | 18 new tests for all new patterns |

## Non-goals (intentional)

- No new npm dependencies added
- No changes to the drawer UI form factor (keeps slide-over design)
- No SQLite or lunr.js -- stays lightweight
