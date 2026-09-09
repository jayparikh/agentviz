---
name: sync-artifacts
description: Synchronize AGENTVIZ documentation after a UI change -- README, style guide, palette, screenshots, and shared agent guidance. Detects drift and regenerates screenshots with approval.
user-invocable: true
---

# AGENTVIZ Artifact Sync

Read repository-root `AGENTS.md` first. You enforce its **Five-artifact sync**
rule: review all five artifact groups for UI changes and update any drift before
committing. Do not make no-op edits. Screenshot regeneration requires explicit
approval; issue edits are outside this skill's authorization.

The five artifacts:
1. **README.md** -- feature descriptions, architecture section, file tree
2. **docs/ui-ux-style-guide.md** -- token values, patterns, rules
3. **docs/color-palette.html** -- visual swatch reference for every color token (dark + light)
4. **docs/screenshots/** -- all 8 screenshot PNGs
5. **Agent guidance** -- `AGENTS.md` for shared rules and `docs/architecture.md` for implementation details

`CLAUDE.md` and `.github/copilot-instructions.md` are short entry points. Keep
their approval reminders and links intact; do not duplicate shared rules or
architecture in them. Repository memory does not replace checked-in guidance.

## Step 1: Detect What Changed

Diff the current branch against the base branch to understand what was modified:

```bash
# What branch are we on?
git rev-parse --abbrev-ref HEAD

# What files changed vs main?
git diff --name-only main

# What's the full diff?
git diff main --stat
```

Use `git diff main` for the full review, including staged and unstaged work. A three-dot comparison ending at HEAD omits uncommitted changes.

Categorize the changes:

| Category | Glob | Artifact impact |
|----------|------|-----------------|
| Components | `src/components/**/*.jsx` | All five artifacts potentially |
| Hooks | `src/hooks/**/*.js` | README + docs/architecture.md; AGENTS.md if conventions change |
| Library | `src/lib/**/*.{js,ts}` | README + docs/architecture.md; AGENTS.md if conventions change |
| Theme tokens | `src/lib/theme.js` | Style guide + color-palette.html + screenshots |
| Server/routes | `server.js`, `routes/**` | README + docs/architecture.md; AGENTS.md if conventions change |
| Config | `package.json`, `vite.config.js` | README commands section |
| Tests | `src/__tests__/**`, `tests/e2e/**` | None (tests don't affect artifacts) |
| Docs only | `docs/**`, `README.md`, `AGENTS.md`, agent entry points | Self-contained, just validate consistency and links |

## Step 2: Audit Each Artifact

For each artifact, check whether the current content matches the code reality.

### 2a. README.md

**File tree** (lines ~320-400): Compare against actual `src/` structure.

```bash
# Generate current file tree
find src/ -type f \( -name "*.jsx" -o -name "*.js" -o -name "*.ts" \) | sort
```

Check for:
- **New files** that exist in `src/` but aren't listed in the README file tree
- **Removed files** that are listed in the README but no longer exist
- **Renamed files** where the old name is in README but the new name isn't
- **New features** described in component code but not in the Features section
- **New keyboard shortcuts** added in `useKeyboardShortcuts.js` but not listed in README
- **Architecture changes** (new hooks, new contexts, new routes)
- **Command changes** in `package.json` scripts that aren't reflected in README

### 2b. Shared agent guidance

Check the implementation map in `docs/architecture.md` against the source. Also verify:
- **Shared rules in AGENTS.md** -- are there new conventions to document?
- **Key data types in docs/architecture.md** -- did the event/turn/metadata shape change?
- **Commands in README.md** -- do they still match `package.json` scripts?
- **Entry points** -- do CLAUDE.md and Copilot instructions still link to AGENTS.md and retain the issue-approval reminder?

### 2c. docs/ui-ux-style-guide.md

Check if changes introduced:
- **New theme tokens** in `theme.js` that aren't documented in the style guide
- **New UI patterns** (e.g., a new overlay type, a new interactive state)
- **New component conventions** that should be added to the guide
- **New known exceptions** to the color/font/spacing rules

Compare the token definitions and style-guide mentions in memory using the existing Node runtime. Do not write scratch files outside the repository.

### 2d. docs/color-palette.html

`docs/color-palette.html` is the visual swatch reference -- every color token rendered as a colored box with its hex value, for both dark and light mode. It must stay in sync with the hex values in `src/lib/theme.js`.

Check if:
- **Any hex values in `color-palette.html` differ from the corresponding values in `theme.js`** -- this is the most common drift source
- **New tokens added to `theme.js`** that have no swatch row in the palette
- **Removed tokens** that still appear in the palette

Extract hex values with `#[0-9a-fA-F]{6}` and compare the two sets in memory. Verify missing values against the corresponding dark/light tokens rather than treating HTML framing colors as palette tokens.

The style guide and color-palette.html must agree: if a token's hex value appears in the style guide table, the same hex must appear in the corresponding swatch in `color-palette.html`.

### 2e. docs/screenshots/

If **any visual change** occurred -- component changes, theme token changes, layout changes, new views, or view modifications -- identify the screenshots that may be stale. Before regenerating anything, ask the user whether they want all screenshots regenerated. Do not regenerate screenshots without explicit confirmation.

The 8 required screenshots:
- `landing.png` -- landing page (before loading a session)
- `session-hero.png` -- hero image at top of README (identical to replay-view)
- `replay-view.png` -- main replay view
- `tracks-view.png` -- tracks (DAW-style) view
- `waterfall-view.png` -- waterfall view
- `graph-view.png` -- graph (DAG) view
- `stats-view.png` -- stats view
- `coach-view.png` -- AI coach view

## Step 3: Draft Artifact Updates

For local text artifacts within the requested task, make the needed edits and
summarize them. This does not authorize GitHub issue edits or screenshot
regeneration; follow the approval rules in `AGENTS.md`.

### README.md updates

- Regenerate the file tree section to match current `src/` structure
- Add new features to the Features section
- Update keyboard shortcuts table if new shortcuts were added
- Update architecture descriptions if hooks/contexts/routes changed
- Keep the same formatting style as existing content

### Shared agent guidance updates

- Update the implementation map in `docs/architecture.md` to match current `src/` structure
- Update shared conventions in `AGENTS.md` if new patterns were introduced
- Update data shape examples in `docs/architecture.md` if event/turn/metadata changed
- Update README commands if package.json scripts changed
- Keep inline comments on each file (e.g., `# Playback state: time, playing, speed, seek, playPause`)

### Style guide updates

- Document new theme tokens with their dark/light values and intended use
- Add new patterns to the appropriate section
- Add new component conventions
- Update the review checklist if new rules are needed

### color-palette.html updates

`docs/color-palette.html` is an HTML file with inline hex values as both swatch backgrounds and text labels. When `theme.js` color values change:

- Find every `<div class="swatch" style="background:#XXXXXX">` row for the changed token and update the background hex
- Update the matching `<div class="hex">#XXXXXX</div>` label in the same row
- If a token was added, insert a new `<div class="row">` following the pattern of adjacent rows
- If a token was removed, delete its row
- Verify the dark-mode and light-mode columns are updated separately (the file has a `.mode.dark` block and a `.mode.light` block)
- Update the `<div class="banner">` summary at the top if you are documenting a batch of palette changes

## Step 4: Confirm and Regenerate Screenshots

If visual changes occurred, use `ask_user` to ask whether the user wants all 8 screenshots regenerated. If they decline, skip screenshot generation and record "Skipped by user request" in the final report. If they approve, regenerate all 8 screenshots. Even if you think only one view changed, regenerate all of them because theme changes can affect everything.

> **PRIVACY: Never capture personal session data.** Use `?demo=empty` for the landing page and "Load a demo session" for all session views. No real user sessions should appear in screenshots.

### Capture workflow

Use Playwright MCP browser tools (navigate, click, screenshot, evaluate) for all captures.

**Setup:**
```bash
npm run dev
```

**Browser configuration:**
- Navigate to `http://127.0.0.1:3000`
- Set viewport to **1400 x 860** (exact)
- Wait for fonts to load (JetBrains Mono from Google Fonts)

**Capture sequence:**

1. **Landing** (`landing.png`)
   - Navigate to `http://127.0.0.1:3000?demo=empty`
   - Wait for page to fully render
   - Capture screenshot

2. **Load demo session**
   - Stay on the privacy-safe `?demo=empty` page
   - Click "Load a demo session" (or "Demo"), then open Investigate
   - Wait for the session evidence to render

3. **Replay** (`replay-view.png`)
   - Open Investigate (the workflow's Replay surface)
   - Capture screenshot

4. **Session hero** (`session-hero.png`)
   - Do NOT capture separately -- copy the replay-view PNG
   - They must be byte-identical

5. **Tracks** (`tracks-view.png`)
   - Open Analyze, then click the "Tracks" tab
   - Wait for track lanes to render
   - Capture screenshot

6. **Waterfall** (`waterfall-view.png`)
   - Click the "Waterfall" tab
   - Wait for waterfall rows to render
   - Capture screenshot

7. **Graph** (`graph-view.png`)
   - Click the "Graph" tab
   - Wait for ELKjs layout to complete (nodes positioned)
   - Capture screenshot

8. **Stats** (`stats-view.png`)
   - Click the "Stats" tab
   - Wait for metrics to render
   - Capture screenshot

9. **Coach** (`coach-view.png`)
   - Open Improve (the workflow's Coach surface)
   - **Before capturing**, hide the error banner by evaluating:
     ```js
     document.querySelectorAll('*').forEach(el => {
       if (el.children.length === 0 && el.textContent.trim().startsWith('AI analysis failed')) {
         let n = el;
         for (let i = 0; i < 6; i++) {
           if (n.parentElement?.textContent.trim().startsWith('AI analysis failed')) n = n.parentElement;
           else break;
         }
         n.style.display = 'none';
       }
     });
     ```
   - Capture screenshot

### Saving screenshots

Screenshots are saved directly as PNG files to `docs/screenshots/`. No SVG conversion is needed.

**Critical:** Generate `session-hero.png` by copying `replay-view.png`:
```bash
cp docs/screenshots/replay-view.png docs/screenshots/session-hero.png
```

### Validation

```bash
# All 8 files exist and are non-empty
ls -la docs/screenshots/*.png

# Hero and replay are identical
diff docs/screenshots/session-hero.png docs/screenshots/replay-view.png
```

## Step 5: Final Validation

After all artifacts are updated:

```bash
# Build still works
npm run build

# Types still check
npm run typecheck

# Tests still pass
npm test

# All 8 screenshots exist and are non-empty
ls -la docs/screenshots/*.png
```

## Step 6: Report

Present a summary of everything that was synced:

```
## Artifact Sync Report

### Changes detected
- [list of changed source files and their categories]

### README.md
- [what was updated, or "No changes needed"]

### Agent guidance (AGENTS.md and docs/architecture.md)
- [what was updated, or "No changes needed"]

### docs/ui-ux-style-guide.md
- [what was updated, or "No changes needed"]

### docs/color-palette.html
- [which swatch rows were updated, or "No changes needed"]

### docs/screenshots/
- [which screenshots were regenerated, or "No changes needed"]
- If regeneration was declined: "Skipped by user request"
- Hero/replay match: [PASS/FAIL]

### Validation
- Build: [PASS/FAIL]
- Typecheck: [PASS/FAIL]
- Tests: [PASS/FAIL]
- Screenshots: [8/8 present]
```

## When to Run

Invoke this skill:
- **After any UI change** before committing
- **Before opening a PR** that touches components, hooks, or theme
- **After a design token change** in `theme.js`
- **After adding a new view or feature**

```
/sync-artifacts
```

Or with a specific focus:

```
/sync-artifacts screenshots only
/sync-artifacts just check, don't fix
```

If "just check" is requested, audit all five artifacts but only report drift -- do not make changes.

## Important Principles

- **Always ask before regenerating screenshots.** If approved, regenerate all 8 rather than only the visibly affected view because theme or layout changes can ripple.
- **session-hero.png must equal replay-view.png**. This is the most common mistake.
- **Use `?demo=empty`** for the landing page screenshot. Never capture with personal session data visible.
- **Match existing style** when updating README, AGENTS.md, and docs/architecture.md. Read the surrounding content before writing.
- **Don't remove content** from artifacts unless the corresponding code was actually removed.
- **Keep color-palette.html and the style guide in lockstep**: when a hex value changes in `theme.js`, update both the style guide table and the color-palette.html swatch row in the same commit.
- **Run the full validation suite** (build + typecheck + test) after making changes.
