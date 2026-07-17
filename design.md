# Quill Design System

> **Sprint 7 status:** Quiet Studio is the active design standard for new and refactored UI. Adoption and product verification are still in progress; this document is a decision guide, not evidence that every legacy route has migrated.

## Outcome

Quill is an English-language, writer-first SPA. The Quiet Studio makes the manuscript and the next author decision easy to see while revealing real memory intelligence only when it helps the writer. It should feel calm and editorial, never like a collection of engineering dashboards.

## Quick reference

| Concern | Standard |
|---|---|
| Theme | One polished light interface for Sprint 7; no dark-mode expansion in this scope. |
| Type | Newsreader for manuscript reading and editorial headings; Spline Sans for controls and data. |
| Color | Semantic paper, ink, pine-teal, amber, coral, and violet tokens—not page-specific color literals. |
| Icons | Lucide icons for interactive UI chrome; text labels remain available where meaning would otherwise be unclear. |
| Feedback | Every async action has an honest status, direct recovery guidance, and a retry path when retry is safe. |
| Motion | CSS only, subtle by default, and reduced or removed for `prefers-reduced-motion`. |
| Accessibility | Skip link, visible keyboard focus, semantic controls, WCAG AA contrast, and live status announcements. |
| Story map | Cytoscape with fCoSE is the intended relationship-map runtime; React Flow is not the Sprint 7 target. |

## Information architecture

The primary navigation has five destinations. Legacy deep links may redirect into these destinations, but the navigation itself should not expose an internal taxonomy of peer screens.

| Destination | Writer job | Scope |
|---|---|---|
| **Home** | Choose a universe, continue work, start a demo, or create a universe. | Library and universe entry points. |
| **Write** | Draft, manage chapters, import material, and receive live analysis. | The uninterrupted manuscript workflow. |
| **Explore** | Understand the story world and its relationships. | Entities, relationship map, and timeline. |
| **Memory** | See what Quill recalls, why, and what it intentionally deprioritizes. | Recall evidence and memory lifecycle. |
| **Review** | Decide what to do about author-facing intelligence. | Candidates, contradictions, plot holes, and craft notes. |

## Foundations

### Typography

- **Newsreader** carries manuscript text, editorial headings, and reading-oriented numerals.
- **Spline Sans** carries controls, labels, navigation, metadata, and data-dense surfaces.
- Use type hierarchy and whitespace before adding decoration. The manuscript remains the most readable element on a writing screen.

### Semantic color system

All interface colors are defined as semantic tokens in `frontend/src/index.css`; components consume the role, never a hard-coded hex value.

| Token family | Meaning | Typical use |
|---|---|---|
| Paper | Warm light canvas and elevated surfaces. | App background, cards, inputs, manuscript framing. |
| Ink | High-legibility foreground and structural borders. | Body text, headings, dividers, disabled hierarchy. |
| Pine-teal | Active intelligence and primary action. | Primary buttons, active navigation, connected state. |
| Amber | Attention that needs monitoring, not alarm. | Progress, queued or running analysis, informational emphasis. |
| Coral | Risk, failure, conflict, or destructive action. | Errors, contradictions, failed requests, recovery prompts. |
| Violet | Memory-specific meaning. | Recall provenance, memory lifecycle, and memory-only emphasis. |

Rules:

- Use semantic roles so color remains meaningful across screens.
- Build depth with paper surfaces, borders, whitespace, and type hierarchy—not ornamental gradients or decorative data effects.
- Do not use color as the sole state indicator; pair it with text, shape, or an accessible status label.
- Keep contrast at WCAG AA or better for the foreground/background pair actually rendered.

### Surfaces and layout

- Keep the chrome light, quiet, and visually subordinate to the manuscript.
- Prefer contained paper surfaces with deliberate spacing over dense panels and permanent sidebars.
- The top app bar establishes global orientation. Contextual controls, such as chapter navigation, belong inside the relevant destination and can collapse when they compete with writing.
- Keep Home cards focused: one clear primary action and no more than two secondary metrics per universe card.

## Component and interaction standards

### Icons and controls

- Use `lucide-react` for navigation, controls, status affordances, and compact actions.
- Do not use Unicode glyphs as the interactive icon system. Existing glyphs are legacy content, not a model for new work.
- An icon-only control needs an accessible name, a discoverable tooltip where useful, and a keyboard-reachable focus state.
- Use CSS Modules and focused primitives; do not introduce a visual component framework or Tailwind for this sprint.

### Feedback is a product contract

Each request, save, analysis, recall, import, reset, or clone action communicates one of these states: `queued`, `running`, `completed`, `failed`, or `offline`.

- Show a plain-language status close to the affected work and announce important changes through an accessible live region.
- Use non-blocking feedback for transient confirmation; preserve persistent header status for autosave, WebSocket/Qwen connectivity, active analysis, and unresolved failures.
- Provide loading, empty, success, and failure states. Do not hide errors behind silent catches, browser alerts, or unexplained optimistic rollbacks.
- Offer retry only when it is safe; explain what will be retried and what the writer can do if it fails again.

### Genre selection

`GenreTagPicker` is the shared pattern for universe create and edit flows.

- It supports search, checkable tags, selected-tag summary, removal, and full keyboard operation.
- The closed vocabulary remains server-owned.
- Selection is optional: a universe may have **zero or more** genre tags. Never force a default genre merely to satisfy the UI.

### Motion

- Use lightweight CSS transitions and keyframes only when they clarify status or preserve orientation.
- Keep motion slow, subtle, and interruptible. Do not use scroll-linked choreography or decorative animated data effects.
- Under `prefers-reduced-motion`, remove nonessential motion and avoid animated state changes that obscure feedback.

## Accessibility baseline

- Provide a skip link that moves keyboard focus to the current page’s main content.
- Use a consistent `:focus-visible` treatment across links, buttons, menus, inputs, chips, and custom graph controls.
- Preserve native semantics whenever possible. Custom controls must have equivalent keyboard behavior, labels, and state exposure.
- Use `aria-live` for meaningful asynchronous status changes without stealing focus.
- Ensure responsive layouts preserve reading order and keyboard order at judge-recording and mobile widths.

## Relationship map and data visualization

### Story relationship map

The map is a relationship tool, not an editable architecture diagram.

- The intended runtime is Cytoscape with fCoSE, loaded lazily so it does not delay Home or Write.
- Start with the selected entity’s focused two-hop neighborhood rather than an all-universe graph.
- Render quiet, unlabeled edges and readable entity cards. Relationship meaning appears after selection in a prose inspector with evidence, source chapter, connected entities, and conflicts.
- Pair the canvas with entity search, type filters, reset focus, keyboard navigation, and an accessible relationship list that mirrors the visible graph.

### Other data visuals

Small memory charts should remain native, lightweight visualizations that use the semantic tokens and expose their data in text. Do not add a general charting library for them. Cytoscape is the narrow relationship-map exception, not a replacement for the rest of the visual system.

## Reviewer checklist

- [ ] The page belongs clearly to one of the five primary destinations.
- [ ] Paper, ink, pine-teal, amber, coral, and violet are used by meaning, not decoration.
- [ ] Controls use Lucide icons and retain an accessible name and visible focus.
- [ ] Async states are direct, honest, and recoverable; no silent failure path remains.
- [ ] The page works with keyboard navigation, skip-link entry, sufficient contrast, and reduced motion.
- [ ] Any relationship-map work follows the Cytoscape/fCoSE target and retains a non-canvas equivalent.

## Scope and verification

This file records the Sprint 7 design decisions. Product completion remains governed by [Sprint 7](Docs/Sprints/SPRINT-7.md), especially Task 7.7’s test, accessibility, build, and judge-demo checks.
