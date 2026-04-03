---
name: sync-artifacts
description: Synchronize all four AGENTVIZ artifacts after a UI change -- README, style guide, CLAUDE.md, and screenshots. Detects what drifted, drafts updates, and regenerates screenshots.
user-invocable: true
---

# AGENTVIZ Artifact Sync

You enforce the **Four-Artifact Sync Rule**: every UI change must update all four artifacts before committing. Your job is to detect what changed, figure out which artifacts drifted, and fix them -- including regenerating screenshots.

The four artifacts:
1. **README.md** -- feature descriptions, architecture section, file tree
2. **docs/ui-ux-style-guide.md** -- token values, patterns, rules
3. **docs/screenshots/** -- all 8 screenshot SVGs
4. **CLAUDE.md** -- architecture section, conventions, file tree

## Step 1: Detect What Changed

Diff the current branch against the base branch to understand what was modified:

```bash
# What branch are we on?
git rev-parse --abbrev-ref HEAD

# What files changed vs main?
git diff --name-only main...HEAD

# What's the full diff?
git diff main...HEAD --stat
```

Categorize the changes:

| Category | Glob | Artifact impact |
|----------|------|-----------------|
| Components | `src/components/**/*.jsx` | All four artifacts potentially |
| Hooks | `src/hooks/**/*.js` | README + CLAUDE.md architecture |
| Library | `src/lib/**/*.{js,ts}` | README + CLAUDE.md architecture |
| Theme tokens | `src/lib/theme.js` | Style guide + screenshots |
| Server/routes | `server.js`, `routes/**` | README + CLAUDE.md architecture |
| Config | `package.json`, `vite.config.js` | README commands section |
| Tests | `src/lib/__tests__/**` | None (tests don't affect artifacts) |
| Docs only | `docs/**`, `README.md`, `CLAUDE.md` | Self-contained, just validate consistency |

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

### 2b. CLAUDE.md

Same file tree check as README (CLAUDE.md has its own architecture section). Also verify:
- **Conventions list** -- are there new patterns introduced that should be documented?
- **Key data types** -- did the event/turn/metadata shape change?
- **Commands** -- do the listed commands still match `package.json` scripts?

### 2c. docs/ui-ux-style-guide.md

Check if changes introduced:
- **New theme tokens** in `theme.js` that aren't documented in the style guide
- **New UI patterns** (e.g., a new overlay type, a new interactive state)
- **New component conventions** that should be added to the guide
- **New known exceptions** to the color/font/spacing rules

```bash
# Compare theme.js exports against style guide mentions
grep -oP "theme\.\w+\.\w+" src/lib/theme.js | sort -u > /tmp/theme-tokens.txt
grep -oP "theme\.\w+\.\w+" docs/ui-ux-style-guide.md | sort -u > /tmp/guide-tokens.txt
diff /tmp/theme-tokens.txt /tmp/guide-tokens.txt
```

### 2d. docs/screenshots/

Screenshots need regeneration if **any visual change** occurred -- component changes, theme token changes, layout changes, new views, or view modifications.

The 8 required screenshots:
- `landing.svg` -- landing page (before loading a session)
- `session-hero.svg` -- hero image at top of README (identical to replay-view)
- `replay-view.svg` -- main replay view
- `tracks-view.svg` -- tracks (DAW-style) view
- `waterfall-view.svg` -- waterfall view
- `graph-view.svg` -- graph (DAG) view
- `stats-view.svg` -- stats view
- `coach-view.svg` -- AI coach view

## Step 3: Draft Artifact Updates

For each artifact that needs updating, make the changes directly. Do not ask for permission -- make the edits, then present a summary of what changed.

### README.md updates

- Regenerate the file tree section to match current `src/` structure
- Add new features to the Features section
- Update keyboard shortcuts table if new shortcuts were added
- Update architecture descriptions if hooks/contexts/routes changed
- Keep the same formatting style as existing content

### CLAUDE.md updates

- Regenerate the architecture file tree to match current `src/` structure
- Update conventions list if new patterns were introduced
- Update data type shapes if event/turn/metadata changed
- Update commands if package.json scripts changed
- Keep inline comments on each file (e.g., `# Playback state: time, playing, speed, seek, playPause`)

### Style guide updates

- Document new theme tokens with their dark/light values and intended use
- Add new patterns to the appropriate section
- Add new component conventions
- Update the review checklist if new rules are needed

## Step 4: Regenerate Screenshots

If visual changes occurred, regenerate all 8 screenshots. Even if you think only one view changed, regenerate all of them -- theme changes affect everything.

> **PRIVACY: Never capture personal session data.** Use `?demo=empty` for the landing page and "load a demo session" for all session views. No real user sessions should appear in screenshots.

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

1. **Landing** (`landing.svg`)
   - Navigate to `http://127.0.0.1:3000?demo=empty`
   - Wait for page to fully render
   - Capture screenshot

2. **Load demo session**
   - Navigate to `http://127.0.0.1:3000` (without `?demo=empty`)
   - Click "load a demo session"
   - Wait for the session to load and the replay view to render

3. **Replay** (`replay-view.svg`)
   - Should already be on the Replay tab after loading demo
   - Capture screenshot

4. **Session hero** (`session-hero.svg`)
   - Do NOT capture separately -- copy the replay-view PNG
   - They must be byte-identical

5. **Tracks** (`tracks-view.svg`)
   - Click the "Tracks" tab
   - Wait for track lanes to render
   - Capture screenshot

6. **Waterfall** (`waterfall-view.svg`)
   - Click the "Waterfall" tab
   - Wait for waterfall rows to render
   - Capture screenshot

7. **Graph** (`graph-view.svg`)
   - Click the "Graph" tab
   - Wait for ELKjs layout to complete (nodes positioned)
   - Capture screenshot

8. **Stats** (`stats-view.svg`)
   - Click the "Stats" tab
   - Wait for metrics to render
   - Capture screenshot

9. **Coach** (`coach-view.svg`)
   - Click the "Coach" tab
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

### PNG to SVG conversion

For each captured PNG, encode as base64 and wrap in SVG:

```bash
b64=$(base64 -w 0 file.png)
echo "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"1400\" height=\"860\"><image href=\"data:image/png;base64,${b64}\" width=\"1400\" height=\"860\"/></svg>" > docs/screenshots/file.svg
```

**Critical:** Generate `session-hero.svg` from the same PNG as `replay-view.svg`:
```bash
cp replay-view.png session-hero.png
# Then encode session-hero.png to SVG using the same command above
```

### Validation

```bash
# All 8 files exist and are non-empty
ls -la docs/screenshots/*.svg

# Hero and replay are identical
diff docs/screenshots/session-hero.svg docs/screenshots/replay-view.svg
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
ls -la docs/screenshots/*.svg
```

## Step 6: Report

Present a summary of everything that was synced:

```
## Artifact Sync Report

### Changes detected
- [list of changed source files and their categories]

### README.md
- [what was updated, or "No changes needed"]

### CLAUDE.md
- [what was updated, or "No changes needed"]

### docs/ui-ux-style-guide.md
- [what was updated, or "No changes needed"]

### docs/screenshots/
- [which screenshots were regenerated, or "No changes needed"]
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

If "just check" is requested, audit all four artifacts but only report drift -- do not make changes.

## Important Principles

- **Always regenerate ALL 8 screenshots**, not just the view that changed. Theme or layout changes ripple.
- **session-hero.svg must equal replay-view.svg**. This is the most common mistake.
- **Use `?demo=empty`** for the landing page screenshot. Never capture with personal session data visible.
- **Match existing style** when updating README/CLAUDE.md. Read the surrounding content before writing.
- **Don't remove content** from artifacts unless the corresponding code was actually removed.
- **Run the full validation suite** (build + typecheck + test) after making changes.
