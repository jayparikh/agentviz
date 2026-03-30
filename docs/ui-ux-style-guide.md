# AGENTVIZ UI/UX Style Guide

> The definitive design system reference for AGENTVIZ.
> Every commit that touches UI must conform to these rules.
> Coding agents should use this document during code review to flag violations.

---

## Design Philosophy

AGENTVIZ follows a "quiet power tool" aesthetic inspired by Linear, Raycast, and Vercel.
The interface should feel fast, focused, and information-dense without ever feeling cluttered.

**Core principles:**

1. **Content over chrome** -- the data is the hero, not the UI
2. **Color means something** -- never decorative, always semantic
3. **Depth through lines, not shadows** -- thin borders create hierarchy
4. **Motion is functional** -- snappy transitions confirm actions, never entertain
5. **One accent color** -- blue (#6475e8) is the only primary action color

---

## 1. Color System

All colors live in `src/lib/theme.js`. Components should reference `theme.*` tokens.

**Known exceptions:** `LiveIndicator.jsx` hardcodes `#34d399` (teal green) and
`CompareView.jsx` hardcodes `#a78bfa` (purple) for the Session B accent.
`index.html` defines `--av-*` CSS custom properties for hover/focus utility classes.
These are legacy exceptions -- new code should use theme tokens.

### Backgrounds

| Token | Hex | Use |
|-------|-----|-----|
| `theme.bg.base` | `#000000` | Page background, true black |
| `theme.bg.surface` | `#0f0f16` | Cards, panels, raised surfaces |
| `theme.bg.raised` | `#1a1a24` | Selected items, active states |
| `theme.bg.overlay` | `rgba(0,0,0,0.7)` | Overlay backdrop |
| `theme.bg.hover` | `#20202e` | Hover feedback |
| `theme.bg.active` | `#26263a` | Active/pressed feedback |

### Text

Five-level hierarchy. Use the minimum contrast level that communicates the information.

| Token | Hex | Use |
|-------|-----|-----|
| `theme.text.primary` | `#f0f0f2` | Body text, values, important content |
| `theme.text.secondary` | `#a1a1a8` | Labels, metadata, descriptions |
| `theme.text.muted` | `#717178` | Disabled text, tertiary info |
| `theme.text.dim` | `#585860` | Section headers (uppercase), subtle labels |
| `theme.text.ghost` | `#454548` | Placeholders, gutter numbers, near-invisible |

### Accent

One color. Used for: selection, focus rings, primary actions, active tab indicators.

| Token | Hex | Use |
|-------|-----|-----|
| `theme.accent.primary` | `#6475e8` | Links, focus, selected, CTA |
| `theme.accent.hover` | `#7585f0` | Hover state of accent elements |
| `theme.accent.muted` | `#6475e820` | Subtle accent background (13% opacity) |

### Semantic

| Token | Hex | Use |
|-------|-----|-----|
| `theme.semantic.success` | `#10d97a` | Positive outcomes, output track, "done" |
| `theme.semantic.warning` | `#d14d4d` | Caution, modified files |
| `theme.semantic.error` | `#ef4444` | Errors, failures |
| `theme.semantic.errorBg` | `#ef444415` | Error row/card background |
| `theme.semantic.errorBorder` | `#ef444430` | Error container border |
| `theme.semantic.errorText` | `#f87171` | Error text (lighter for readability) |
| `theme.semantic.info` | `#6475e8` | Informational (same as accent) |

### Agent Colors

Subtle. The content matters, not who said it.

| Token | Hex | Use |
|-------|-----|-----|
| `theme.agent.user` | `#8b8b99` | User messages |
| `theme.agent.assistant` | `#6475e8` | Assistant messages |
| `theme.agent.system` | `#a78bfa` | System messages |

### Track Colors

Balanced luminance so no track visually dominates another.

| Token | Hex | Use |
|-------|-----|-----|
| `theme.track.reasoning` | `#94a3b8` | Thinking/reasoning events |
| `theme.track.tool_call` | `#3b9eff` | Tool invocations |
| `theme.track.context` | `#a78bfa` | Context loading |
| `theme.track.output` | `#10d97a` | Output/results |

### Data Visualization Scales

Track colors (above) work for categorical data. For sequential/intensity data (heatmaps,
sparklines, progress indicators), use these scales built from the existing palette:

**Single-hue intensity scale (blue):**
Use `alpha(theme.accent.primary, opacity)` with increasing opacity for low-to-high values.

| Intensity | Opacity | Use |
|-----------|---------|-----|
| Lowest | `0.06` | Baseline/empty cells |
| Low | `0.15` | Below average |
| Medium | `0.30` | Near average |
| High | `0.50` | Above average |
| Highest | `0.80` | Peak/outlier values |

**Diverging scale (good-to-bad):**
For metrics where direction matters (autonomy: high=good, errors: low=good):

| Value | Color | Use |
|-------|-------|-----|
| Good | `alpha(theme.semantic.success, 0.15)` to `alpha(theme.semantic.success, 0.50)` | High autonomy, zero errors |
| Neutral | `alpha(theme.accent.primary, 0.10)` | Average values |
| Bad | `alpha(theme.semantic.error, 0.15)` to `alpha(theme.semantic.error, 0.50)` | Low autonomy, many errors |

**Health indicator (left-edge color bar):**
For session review-priority coding:

| State | Color | Threshold |
|-------|-------|-----------|
| Healthy | `theme.semantic.success` | reviewScore < 3 |
| Needs review | `theme.accent.primary` | reviewScore 3-8 |
| Problems | `theme.semantic.error` | reviewScore > 8 |
| Unknown | `theme.border.strong` | No metrics available (discovered-only) |

### Alpha/Opacity Helper

Use the `alpha()` function from `theme.js` to create transparent variants:

```jsx
import { alpha } from "../lib/theme.js";

background: alpha(theme.accent.primary, 0.08)  // 8% accent
```

**Standard opacity levels:**

| Opacity | Use |
|---------|-----|
| `0.03` | Very subtle background tint |
| `0.06` | Subtle section highlight |
| `0.08` | Medium highlight, error/success backgrounds |
| `0.10` | Status button backgrounds |
| `0.15` | Gutter backgrounds, stronger highlights |
| `0.20` | Search match highlight |
| `0.50` | Semi-transparent borders, overlays |
| `0.60` | Modal backdrop |
| `0.75` | Heavy overlay |

---

## 2. Typography

### Font Families

| Token | Stack | Use |
|-------|-------|-----|
| `theme.font.mono` | `'JetBrains Mono', monospace` | Default for ALL UI -- body text, labels, buttons, inputs, metrics, timestamps, data |
| `theme.font.ui` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...` | **BrandWordmark and nav tab buttons only** |

JetBrains Mono is loaded via Google Fonts in `index.html`. It is the primary typeface for
all content -- including tool labels, coach metrics, dropdowns, and stat values.
`font.ui` is intentionally limited to two places: the brand wordmark (`BrandWordmark` component)
and the view-switcher tab buttons in `AppHeader`. Using it elsewhere is a violation.

### Font Scale

| Token | Size | Use |
|-------|------|-----|
| `theme.fontSize.xs` | 10px | Tiny badges, keyboard shortcuts, gutter text |
| `theme.fontSize.sm` | 11px | Section headers, secondary labels, timestamps |
| `theme.fontSize.base` | 12px | Default body text, most content |
| `theme.fontSize.md` | 13px | Input fields, slightly emphasized text |
| `theme.fontSize.lg` | 15px | Brand wordmark, play button text |
| `theme.fontSize.xl` | 18px | Drop zone heading, large headings |
| `theme.fontSize.xxl` | 24px | Hero metrics, large numbers |
| `theme.fontSize.hero` | 32px | Landing page hero |

### Typography Patterns

**Section headers** -- uppercase, letter-spaced, dim. Two variants exist:
```jsx
// Standard (ReplayView sidebar)
{
  fontSize: theme.fontSize.sm,
  color: theme.text.dim,
  textTransform: "uppercase",
  letterSpacing: 2,
  marginBottom: 8,
}

// Compact (StatsView, WaterfallInspector, InboxView)
{
  fontSize: theme.fontSize.xs,
  color: theme.text.dim,
  textTransform: "uppercase",
  letterSpacing: 1,
  marginBottom: 8,
}
```

**Brand wordmark** -- UI font, tight tracking, accent dot:
```jsx
{
  fontSize: theme.fontSize.lg,
  fontWeight: 600,
  fontFamily: theme.font.ui,
  letterSpacing: "-0.5px",
  color: theme.text.primary,
}
// Always renders: AGENTVIZ<span style={{ color: theme.accent.primary }}>.</span>
```

**Metric values** -- large, bold, colored:
```jsx
{
  fontSize: 22,
  fontWeight: 700,
  color: valueColor,  // semantic color based on metric
}
```

**Code/data content** -- mono, pre-wrap:
```jsx
{
  fontFamily: theme.font.mono,
  fontSize: theme.fontSize.md,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
}
```

### Rules

- Default font is **mono**. Use `theme.font.ui` ONLY for the `BrandWordmark` component and the view-switcher tab buttons.
  Everything else -- buttons, dropdowns, labels, metric values, stat numbers, loading screen, coach panel -- must use `theme.font.mono`.
- Font weight: `400` normal, `500` medium (tool labels), `600` semi-bold (headers, brand), `700` bold (metric values, solo/mute).
- Never use font weights above 700.
- `letterSpacing: 2` for uppercase section labels. `letterSpacing: 1` for uppercase badges.
  `letterSpacing: "-0.5px"` only for the brand wordmark.
- `lineHeight: 1.6` for readable body text. `lineHeight: 1.8` for loose descriptive text. `lineHeight: 2.2` for spaced metadata lists.

---

## 3. Spacing

All spacing follows a **4px base grid**. Use `theme.space.*` tokens.

| Token | Value | Use |
|-------|-------|-----|
| `theme.space.xs` | 2px | Micro gaps, badge padding-y |
| `theme.space.sm` | 4px | Icon-text gap in compact elements |
| `theme.space.md` | 8px | Standard inner padding, small gaps |
| `theme.space.lg` | 12px | Card padding, section gaps |
| `theme.space.xl` | 16px | Panel padding, sidebar gutters |
| `theme.space.xxl` | 24px | Large section spacing |
| `theme.space.xxxl` | 32px | Hero spacing |
| `theme.space.huge` | 40px | Major layout gaps |
| `theme.space.giant` | 56px | Oversized spacing |

### Padding Conventions

| Context | Padding | Example |
|---------|---------|---------|
| Toolbar buttons | `2px 8px` | ToolbarButton |
| Play/control buttons | `4px 12px` | Timeline controls |
| Cards and panels | `12px 14px` | MetricCard |
| Section containers | `14px 16px` | StatsView overview |
| Modal inputs | `14px 18px` | CommandPalette input |
| Result rows | `8px 18px` | CommandPalette results |
| Drop zone | `48px 32px` | FileUploader |
| Error boundary | `16px` all | ErrorBoundary |

### Gap Conventions

| Context | Gap |
|---------|-----|
| Icon + text in button | `4px` |
| Live indicator elements | `5px` |
| Toolbar items | `8px` |
| List items | `10px` |
| Command palette items | `10px` |
| Inspector sections | `14px` |
| Section headers to content | `8px` |
| Major view sections | `16-24px` |

---

## 4. Borders and Depth

Depth is created through **thin borders**, not shadows. Shadows are used sparingly for floating elements.

### Border Colors

| Token | Hex | Use |
|-------|-----|-----|
| `theme.border.subtle` | `#1a1a24` | Nearly invisible dividers, diff gutters |
| `theme.border.default` | `#232333` | Standard separators, card borders |
| `theme.border.strong` | `#2e2e42` | Emphasized dividers, drag handles |
| `theme.border.focus` | `#6475e8` | Focus rings (same as accent) |

### Border Patterns

**Standard card/panel:**
```jsx
border: "1px solid " + theme.border.default
```

**Dashed drop zone:**
```jsx
border: "2px dashed " + (isDragOver ? theme.accent.primary : theme.border.strong)
```

**Colored left-accent (selection/error):**
```jsx
borderLeft: isSelected ? "2px solid " + barColor : "2px solid transparent"
```

**Section divider line:**
```jsx
<div style={{ flex: 1, height: 1, background: theme.border.default }} />
```

### Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `theme.radius.sm` | 4px | Small buttons, badges, tooltips |
| `theme.radius.md` | 6px | Standard radius for buttons, inputs |
| `theme.radius.lg` | 8px | Cards, error boundaries, metric cards |
| `theme.radius.xl` | 10px | Grouped button containers |
| `theme.radius.xxl` | 12px | Modals, large panels, drop zone |
| `theme.radius.full` | 9999px | Pills, circular indicators |

### Shadows

Minimal. Used only for floating/elevated elements.

| Token | Value | Use |
|-------|-------|-----|
| `theme.shadow.sm` | `0 1px 2px rgba(0,0,0,0.3)` | Subtle lift |
| `theme.shadow.md` | `0 4px 12px rgba(0,0,0,0.25)` | Modals, command palette |
| `theme.shadow.lg` | `0 12px 32px rgba(0,0,0,0.35)` | Large floating panels |
| `theme.shadow.inset` | `inset 0 1px 2px rgba(0,0,0,0.2)` | Pressed/inset effect |

**Rule:** Shadows appear only on floating elements (modals, tooltips, dropdowns).
Cards and panels rely on borders, not shadows, for depth.

---

## 5. Icons

All icons come from **Lucide React** via the `Icon` component (`src/components/Icon.jsx`).

### Registry Rule

Every icon used in the app must be:
1. Imported from `lucide-react` at the top of `Icon.jsx`, AND
2. Added to the `ICON_MAP` object in `Icon.jsx`.

Importing an icon from `lucide-react` without adding it to `ICON_MAP` results in a **silent
null render** -- the element renders as an empty space with no error thrown. In development
mode, `Icon.jsx` emits a `console.warn` for unknown names to help catch this.

When adding a new icon, both steps are required in the same commit.

### Defaults

| Property | Default | Notes |
|----------|---------|-------|
| `size` | 14px | Standard inline icon |
| `strokeWidth` | 1.5 | Consistent weight |

### Size Scale

| Size | Use |
|------|-----|
| 10-11px | Tiny inline indicators (error dot, status) |
| 12px | Toolbar button icons |
| 13-14px | Standard icons in lists, cards |
| 16px | Search input icon, prominent actions |
| 32px | Hero/landing page icon |

### Color Rules

- Icons inherit color from their parent text by default.
- Track icons use their track color: `style={{ color: theme.track[trackName] }}`.
- Error icons use `theme.semantic.error`.
- Action icons in toolbars use `theme.text.muted`.
- The search icon in CommandPalette uses `theme.accent.primary`.

### Usage

```jsx
import Icon from "../components/Icon.jsx";

<Icon name="search" size={16} style={{ color: theme.accent.primary }} />
<Icon name="alert-circle" size={11} style={{ color: theme.semantic.error }} />
```

---

## 6. Interactive States

### Hover

Three CSS utility classes handle hover/active (defined in `index.html`):

| Class | Hover | Active | Use |
|-------|-------|--------|-----|
| `.av-btn` | `var(--av-bg-hover)` | `var(--av-bg-active)` | Buttons, clickable controls |
| `.av-interactive` | `var(--av-bg-hover)` | -- | Rows, cards, list items |
| `.av-search` | Focus: `border-color: var(--av-focus)` | -- | Borderless search inputs (nav) |
| `.av-search-wrap` | Focus-within: `border-color: var(--av-focus)` | -- | Boxed search wrappers (inbox, Q&A) |

**Inline hover pattern** (when CSS class is insufficient):
```jsx
background: isSelected ? theme.bg.raised : "transparent",
transition: "background " + theme.transition.fast,
```

### Focus

```css
*:focus-visible { outline: 2px solid var(--av-focus); outline-offset: 2px; }
*:focus:not(:focus-visible) { outline: none; }
```

- Focus ring: 2px solid `#6475e8` with 2px offset.
- Only shows on keyboard navigation (`:focus-visible`).
- Mouse clicks suppress the ring (`:focus:not(:focus-visible)`).

### Disabled

```jsx
opacity: disabled ? 0.6 : 1,
cursor: disabled ? "default" : "pointer",
```

- Opacity: `0.6` (never fully hide -- the element should still be visible).
- Cursor: `default` (not `not-allowed` -- keeps the UI calm).

### Selected/Active

- Background: `theme.bg.raised` for selected items.
- Border: `theme.accent.primary` (2px left border or outline).
- Text color: stays `theme.text.primary` (selection is shown via background, not text color).

### Muted/Solo (Track-specific)

- Muted track: `opacity: 0.15`, `transition: opacity theme.transition.smooth`.
- Solo active button: Inverted colors (track color background, primary text).
- Mute active button: `theme.semantic.error` background.

---

## 7. Animation and Transitions

### Timing

| Token | Duration | Use |
|-------|----------|-----|
| `theme.transition.fast` | `80ms ease-out` | Hover/active background, border changes |
| `theme.transition.base` | `150ms ease-out` | Standard state transitions |
| `theme.transition.smooth` | `200ms ease-out` | Drag feedback, opacity changes |
| `theme.transition.slow` | `300ms ease-out` | Layout transitions |

**Rules:**
- `ease-out` only. Never `ease-in` or `linear` for UI transitions (exception: playhead uses `linear`).
- No decorative motion. Every animation must confirm a user action or communicate state.
- Prefer transitions on `background`, `border-color`, `color`, `opacity`, `transform`.
  Existing code also animates `width` (CompareView bars) and uses `transition: "all ..."` in some
  places -- these are tolerated but new code should prefer explicit property lists.

### CSS Keyframe Animations

Defined in `index.html`:

| Name | Duration | Easing | Use |
|------|----------|--------|-----|
| `fadeIn` | varies | -- | Entry animations |
| `spin` | `0.8s` | `linear` | Loading spinner |
| `pulse` | `1.4s` | `ease-in-out` | Live indicator dot |

GraphView also uses SVG `<animate>` and `<animateMotion>` for active-node glow pulses
and edge-flow dots. These are not covered by the CSS reduced-motion rule (see below).

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

CSS animations and transitions are automatically disabled when the user prefers reduced motion.
**Caveat:** SVG `<animate>` and `<animateMotion>` elements (used in GraphView) are not covered
by this CSS rule. New SVG animations should check `prefers-reduced-motion` via JS or be wrapped
in a conditional.

---

## 8. Layout Patterns

### Full-Viewport Shell

The app shell uses `ShellFrame` at the top level. Individual views (ReplayView, TracksView, etc.)
are rendered as children -- they are not each independently wrapped in `ShellFrame`.
```jsx
{
  width: "100%",
  height: "100vh",
  background: theme.bg.base,
  color: theme.text.primary,
  fontFamily: theme.font.mono,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
}
```

### Resizable Split Panels

`ResizablePanel` provides drag-to-resize splits:
- Default split: `72% / 28%` (main content / sidebar inspector).
- Minimum panel size: `120px` (configurable via `minPx`).
- Drag handle: `6px` wide, `2px` visible indicator line, `24px` long.
- Handle color: `theme.border.strong`, cursor: `col-resize` or `row-resize`.
- Split ratio persists to `localStorage`.

### Sidebar Inspector

Found in ReplayView, WaterfallView, GraphView. Spacing varies by view:
- ReplayView: `paddingLeft: 16px`, `gap: 14px`.
- WaterfallView: `padding: theme.space.lg` (12px), `gap: theme.space.lg` (12px).
- GraphView: `padding: 16px`.
- All use independent vertical scroll (`overflowY: auto`).

### Grid Layout

Used for metric cards:
```jsx
display: "grid",
gridTemplateColumns: "1fr 1fr 1fr",
gap: 12,
```

Prefer flexbox for everything else. Grid is reserved for uniform card grids.

### Clickable Content Cards

For card grids where each card represents a navigable item (sessions, experiments, etc.):

```jsx
// Card container
<button style={{
  background: theme.bg.surface,
  border: "1px solid " + theme.border.default,
  borderRadius: theme.radius.lg,
  padding: "12px 14px",
  textAlign: "left",
  cursor: "pointer",
  width: "100%",
  transition: theme.transition.fast,
  position: "relative",
  overflow: "hidden",
}}>
```

**States:**
- Default: `border: 1px solid theme.border.default`, `background: theme.bg.surface`
- Hover: `border-color: theme.border.strong`, `background: theme.bg.hover`
- Use the `.av-interactive` class or inline `transition: theme.transition.fast`

**Left-edge accent bar (optional):**
Use a `::before`-style absolute-positioned div for color-coded status:
```jsx
<div style={{
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  width: 3,
  borderRadius: "3px 0 0 3px",
  background: healthColor, // from theme.semantic.* or Data Visualization Scales
}} />
```

**Card content layout:**
- Header row: flex with `justifyContent: space-between` for title + timestamp
- Metrics row: flex with `gap: 12` for inline stat chips
- Summary: single line, truncated with `textOverflow: ellipsis`
- Use `theme.text.secondary` for labels, `theme.text.primary` for values

**Cards must be `<button>` elements**, not clickable `<div>`. Set `textAlign: "left"` to
override the button default. This ensures keyboard accessibility.

**Two-tier rendering:**
When a card may have full data or partial data (e.g., parsed vs discovered-only sessions),
dim the partial cards:
- Full data: normal rendering
- Partial data: `opacity: 0.7` on the metrics row, show "Not yet analyzed" in `theme.text.dim`

### Overflow Handling

- Text truncation: `overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap`.
- Always set `minWidth: 0` on flex children that contain truncated text.
- Virtual scrolling for large lists (ReplayView, WaterfallView) with overscan.
- `maxWidth: 560px` centered for modal and drop zone content.

**Toolbar containers with dropdowns must NOT use `overflow: hidden`.**
Applying `overflow: hidden` to a toolbar or header row clips any absolutely-positioned
dropdowns, menus, or tooltips that extend outside its bounds. Instead:
- Set `position: relative` on the container to establish a stacking context.
- Set `zIndex: theme.z.active` (2) on the container so it layers above scroll content.
- Set `zIndex: theme.z.tooltip` (10) on the dropdown itself.

---

## 9. Modals and Overlays

### Overlay Variants

Three overlay patterns exist:

**Command Palette** -- centered near top, blurred backdrop:
```jsx
{
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(4px)",
  zIndex: theme.z.modal,
}
```

**Dialog Modal** (ShortcutsModal) -- centered, heavier backdrop, no blur:
```jsx
{
  position: "fixed",
  inset: 0,
  background: alpha(theme.bg.base, 0.75),
  zIndex: 9000,
}
```

**Landing Overlay** (drag-drop) -- near-opaque:
```jsx
{
  background: alpha(theme.bg.base, 0.92),
}
```

**Slide-over Drawer** (QADrawer) -- anchored to right edge, full height:
```jsx
{
  position: "fixed",
  top: 0,
  right: 0,
  height: "100dvh",
  width: 400,
  background: theme.bg.surface,
  borderLeft: "1px solid " + theme.border.default,
  boxShadow: theme.shadow.lg,
  zIndex: theme.z.modal,
  boxSizing: "border-box",
  overflow: "hidden",
}
```
Drawers use flex column layout with a scrollable middle area (`flex: 1; minHeight: 0; overflowY: auto`) and a fixed input area at bottom. Dismiss via close button, Escape key, or a footer "Disable" link.

All overlays dismiss on backdrop click via `e.stopPropagation()` on the inner container.

### Modal Container

```jsx
{
  width: 560,
  background: theme.bg.surface,
  border: "1px solid " + theme.border.strong,
  borderRadius: theme.radius.xxl,
  boxShadow: theme.shadow.md,
  overflow: "hidden",
}
```

### Z-Index Scale

| Token | Value | Use |
|-------|-------|-----|
| `theme.z.base` | 1 | Normal flow elements |
| `theme.z.active` | 2 | Active/dragging elements |
| `theme.z.playhead` | 3 | Timeline playhead |
| `theme.z.tooltip` | 10 | Tooltips, hover cards |
| `theme.z.overlay` | 50 | Overlay backgrounds |
| `theme.z.modal` | 100 | Modals, command palette |

New code should use `theme.z.*` tokens. The codebase has legacy hardcoded z-indexes
(e.g. `9000` in ShortcutsModal, `999` in AppLandingState) -- these should be migrated
to theme tokens over time but are not blocking issues.

---

## 10. Tooltips

```jsx
{
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: "50%",
  transform: "translateX(-50%)",
  background: theme.bg.overlay || theme.bg.surface,
  border: "1px solid " + theme.border.default,
  borderRadius: theme.radius.lg,
  padding: "8px 12px",
  fontSize: theme.fontSize.xs,
  color: theme.text.secondary,
  whiteSpace: "normal",
  width: 220,
  lineHeight: 1.5,
  zIndex: theme.z.modal,
  pointerEvents: "none",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
}
```

**Rules:**
- `pointerEvents: "none"` -- tooltips must never block clicks.
- Show on `onMouseEnter`, hide on `onMouseLeave`.
- Position above the element by default (`bottom: calc(100% + 8px)`).
- Max width: `220px` for standard tooltips, `500px` for rich hover cards.
- Appear without delay for instant feedback (exception: waterfall uses 30ms).

---

## 11. Scrollbars

Custom scrollbars match the dark theme (defined in `index.html`):

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #3a3a3f; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #585860; }
```

- Thin (6px), unobtrusive, transparent track.
- Thumb matches `theme.border.strong` range.
- These rules must not be overridden.

---

## 12. Empty States

Empty states should be centered, muted, and calm. The preferred pattern:

```jsx
{
  padding: "20px 18px",
  textAlign: "center",
  color: theme.text.dim,
  fontSize: theme.fontSize.md,
}
// "No results found"
```

- Prefer `theme.text.dim` for empty-state text color.
- Keep the message short and specific ("No results found", "Drop a file to begin").
- Never show empty tables or empty grids -- replace with a centered message.

**Note:** Some existing views use `theme.text.muted` or `theme.text.ghost` for empty states.
New code should target the pattern above.

---

## 13. Error States

### Inline Error Text

```jsx
<span style={{
  color: theme.semantic.error,
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
}}>
  <Icon name="alert-circle" size={11} /> error
</span>
```

### Error Container

Two variants exist:

**ErrorBoundary** (catch-all):
```jsx
{
  background: theme.bg.surface,
  border: "1px solid " + theme.semantic.errorBorder,
  borderRadius: theme.radius.lg,
  padding: 16,
  color: theme.text.secondary,
}
```

**Error cards/rows** (inline in lists):
```jsx
{
  background: theme.semantic.errorBg,
  border: "1px solid " + theme.semantic.errorBorder,
}
```

### Error Cards/Rows

- Background: `theme.semantic.errorBg` (`#ef444415`).
- Border: `1px solid theme.semantic.errorBorder` (`#ef444430`).
- Text: `theme.semantic.errorText` (`#f87171`) for the error message itself.
- Icon: `alert-circle` at 11px in `theme.semantic.error`.

---

## 14. Loading States

Two loading patterns exist:

**Primary loading screen** (AppLoadingState) -- border spinner:
```jsx
<div style={{
  width: 20,
  height: 20,
  border: "2px solid " + theme.border.strong,
  borderTopColor: theme.accent.primary,
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
}} />
```

**Inline loading** (DebriefView) -- rotating Unicode star:
```jsx
<span style={{
  animation: "spin 1.2s linear infinite",
  display: "inline-block",
}}>
  {"\u2726"}
</span>
```

- Never use a progress bar unless you have real progress data.
- Keep loading states minimal -- no skeleton screens or shimmer effects.

---

## 15. Data Display and Formatting

### Durations

| Range | Format | Example |
|-------|--------|---------|
| null or 0 | `"--"` | Missing/zero data |
| < 10ms | `"<10ms"` | Sub-threshold |
| < 1s | `"{n}ms"` | `"234ms"` |
| < 60s | `"{n.1}s"` | `"12.3s"` |
| >= 60s | `"{n.1}m"` | `"2.5m"` |

### Numbers

- Use `.toLocaleString()` for thousands (tokens, event counts).
- Use `.toFixed(1)` for decimals (time, percentages).
- Cost formatting via `formatCost()`:
  - `$0.00` for zero
  - `<$0.01` for sub-cent
  - `$0.XXX` (3 decimals) for < $1
  - `$X.XX` (2 decimals) for >= $1

### Color Coding for Values

- Token input counts: `theme.accent.primary`.
- Token output counts: `theme.semantic.success`.
- Error counts: `theme.semantic.error`.
- Neutral metrics: `theme.text.primary`.

### Diff Display

| Line type | Background | Gutter | Marker | Text |
|-----------|-----------|--------|--------|------|
| Insert | `alpha(success, 0.08)` | `alpha(success, 0.15)` | `theme.semantic.success` | `theme.text.primary` |
| Delete | `alpha(error, 0.08)` | `alpha(error, 0.15)` | `theme.semantic.error` | `theme.text.primary` |
| Context | transparent | transparent | `theme.text.ghost` | `theme.text.secondary` |

- Gutter width: `38px` each (old line number, new line number).
- Marker width: `16px` (centered `+`, `\u2212`, or space).
- Line height: `20px`.

---

## 16. Keyboard Interaction

### Global Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `ArrowRight` / `ArrowLeft` | Seek forward / back 2s |
| `1` - `5` | Switch view (Replay, Tracks, Waterfall, Graph, Stats) |
| `e` / `E` | Jump to next / previous error |
| `/` | Focus search input |
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `?` | Toggle shortcuts modal |

### Command Palette Navigation

- `ArrowDown` / `ArrowUp`: Move selection.
- `Enter`: Execute selected action.
- `Escape`: Close palette.
- Mouse enter updates selection index (follows mouse).

### Focus Management

- Command palette auto-focuses the input on open.
- Modals close on backdrop click or Escape (no formal focus trap yet -- this is a known gap).
- Keyboard shortcuts are registered via a centralized `useKeyboardShortcuts` hook
  with ref-based stable listeners.

---

## 17. Branding

- Product name: **AGENTVIZ** (all caps, no spaces).
- Always use the `BrandWordmark` component for the logo. It renders the accent dot automatically.
  Never inline the brand markup manually.
- `<title>` tag: `AGENTVIZ`.

---

## 18. Inline Styles Only

**AGENTVIZ uses zero CSS files for component styling.** All styles are inline `style={}` objects.

### Rules

1. All color values should come from `theme.*` tokens. Legacy exceptions exist (see Section 1) but new code must not add more.
2. All spacing should reference `theme.space.*` or use values from the 4px grid.
3. Use `Object.assign({}, baseStyle, overrideStyle)` for style composition.
4. The only CSS lives in `index.html` (and is duplicated in `src/lib/exportHtml.js` for HTML export):
   global resets, scrollbar styles, utility classes (`.av-btn`, `.av-interactive`, `.av-search`),
   keyframe animations, and focus styles.
5. Never add new CSS classes. If a new shared style pattern is needed, create a component.
6. Never add CSS files, CSS modules, styled-components, or any CSS-in-JS library.

---

## 19. Component Conventions

### Props-Only Architecture

- No global state management (no Redux, Zustand, Context).
- Components receive data as props. State lives in hooks (`usePlayback`, `useSearch`, etc.).
- Shared UI primitives: `ShellFrame`, `BrandWordmark`, `ToolbarButton`, `ExportStatusButton`,
  `ResizablePanel`, `Icon`, `ErrorBoundary`.

### Shared UI Primitives

| Component | Purpose |
|-----------|---------|
| `ShellFrame` | Full-viewport flex-column container |
| `BrandWordmark` | "AGENTVIZ." logo with accent dot |
| `ToolbarButton` | Standard button with icon + text |
| `ExportStatusButton` | Async operation button (idle/loading/done/error) |
| `ResizablePanel` | Drag-to-resize split panel |
| `Icon` | Lucide icon wrapper with defaults |
| `ErrorBoundary` | React error boundary with recovery |

When building new UI, check if an existing primitive fits before creating a new component.

### Landing-State vs Session-State Views

Views fall into two categories:

**Session-state views** (require a loaded session): Replay, Tracks, Waterfall, Graph, Stats, Coach.
These are registered in `APP_VIEWS` in `constants.js`, appear as tabs in `AppHeader`, and are
switched via keyboard shortcuts 1-5. They receive session data (events, turns, metadata) as props
via `renderActiveView()` in `App.jsx`.

**Landing-state views** (operate on the session list): Landing page, Compare landing, Dashboard.
These render when no session is loaded (`!session.events`). They receive `allSessions` (the merged
library + discovered list) and `onOpenSession` as props. They are NOT in `APP_VIEWS` and do NOT
get keyboard shortcuts -- they are selected by app state, not user toggle.

New aggregate/multi-session views belong in the landing state. New single-session analysis views
belong in the session state (add to `APP_VIEWS`).

### Feature Flags

Experimental features are gated via `useFeatureFlag(key)`. Flags are stored in localStorage
with the prefix `av_flag_`. Enable flags via browser console:

```js
localStorage.setItem('av_flag_qa-drawer', 'true')
```

The Q&A drawer uses this pattern. When the flag is disabled, the drawer is hidden from the
UI and the `Cmd+Shift+K` shortcut is a no-op.

---

## 20. Accessibility

### Target State

These are goals for the project. Some are not fully implemented yet.

- All interactive elements must be keyboard accessible.
- Use semantic HTML (`<button>`, not `<div onClick>`) -- some legacy clickable divs remain.
- `prefers-reduced-motion` is respected for CSS (see Section 7). SVG animations need JS guards.
- Focus ring visible on keyboard navigation, hidden on mouse click.
- `aria-label` on icon-only buttons -- coverage is currently incomplete.

### Recommended

- Color is never the only indicator of state (always pair with text or icon).
- Minimum touch target: 24x24px for interactive elements.
- Scrollable regions should be keyboard-navigable.
- Modals should implement focus trapping (currently close-on-Escape only).

---

## Review Checklist

When reviewing a PR that touches UI, verify each of these:

- [ ] **Colors**: Color values reference `theme.*` tokens. No new hardcoded hex in components.
- [ ] **Typography**: Font family uses `theme.font.mono` for all UI. `theme.font.ui` is only used in `BrandWordmark` and nav tab buttons. Font sizes use `theme.fontSize.*`.
- [ ] **Spacing**: Padding and gaps use values from the 4px grid or `theme.space.*` tokens.
- [ ] **Borders**: Border colors use `theme.border.*`. Radius uses `theme.radius.*`.
- [ ] **Shadows**: Only on floating elements (modals, tooltips). Uses `theme.shadow.*`.
- [ ] **Hover/Focus**: Interactive elements use `.av-btn` or `.av-interactive` class, or inline transition with `theme.transition.fast`.
- [ ] **Disabled state**: `opacity: 0.6`, `cursor: "default"`.
- [ ] **Icons**: Uses `Icon` component with Lucide. Default size 14, strokeWidth 1.5. New icons are both imported from `lucide-react` AND added to `ICON_MAP` in `Icon.jsx`.
- [ ] **Modals**: Uses one of the documented overlay variants. Click-to-dismiss.
- [ ] **Inline styles only**: No new CSS files or classes added.
- [ ] **No em dashes**: Use `--` or commas instead.
- [ ] **Reduced motion**: New CSS animations respect `prefers-reduced-motion`. New SVG animations check via JS.
- [ ] **Semantic HTML**: Buttons are `<button>`, not clickable `<div>`.
- [ ] **Error states**: Use `theme.semantic.error*` tokens. Always pair color with icon or text.
- [ ] **Empty states**: Centered message with `theme.text.dim` and `theme.fontSize.md`.
- [ ] **Brand**: Product name is "AGENTVIZ" (all caps). Uses `BrandWordmark` component.
- [ ] **Data formatting**: Durations, numbers, and costs follow the formatting rules in Section 15.
- [ ] **z-index**: Uses `theme.z.*` tokens for new code. No new arbitrary values.
- [ ] **Transitions**: `ease-out` only. Duration uses `theme.transition.*`. No decorative motion.
