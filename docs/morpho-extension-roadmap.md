# Morpho extension — UI, features, and modes

This document plans **extension-only** work (CDP-injected UI inside Amazon Music’s web app). It does **not** cover native process injection or audio DLL hooking.

## Goals

1. **Visual polish** — Less flat gray; glassy, slightly translucent panels so Amazon Music remains visible behind the panel; subtle accent (tinted border / buttons) without hurting readability.
2. **More features** — Ship useful controls that use the same supported surfaces as today: internal Player module (`0903`) and native bridge (`6586`), plus read-only Vuex state.
3. **Modes** — Two modes selectable from the extension chrome:
   - **Panel** — Default Morpho UI (Group Listening, tempo, pitch probe, chat, etc.).
   - **Layout** — Optional page-level CSS the user controls (custom rules in a textarea). Intended for light layout tweaks; not a full theme engine.
4. **Fallback** — If Layout mode or custom CSS breaks the app, the user can **reload the page** (`Ctrl+R`). That resets in-page state; Morpho must **re-inject** the extension (e.g. run `npm run inject:extension` or the launcher). Optionally **Ctrl+Shift+M** clears injected layout CSS without a full reload (implemented in-extension).

## Product positioning

- Safe to describe publicly: “Overlay / companion panel for Amazon Music Desktop, injected via developer tooling.”
- Avoid: implying DRM circumvention, binary patching, or injection into the audio engine.

## Phase 1 (implemented in code after this doc)

- Restyle panel + tab: translucency, gradient wash, accent borders, improved toggle.
- **Panel mode additions:**
  - **Now playing** line (title — artist) from Vuex.
  - **Quick actions:** previous / next track, **thumbs up / down** via `rateEntity` when available.
  - **Copy** current track line to clipboard (with fallback for older CEF).
- **Layout mode:**
  - Textarea for **custom CSS**, Apply / Clear.
  - Persist CSS in `localStorage`; re-apply on extension load if present.
  - **Ctrl+Shift+M** removes Morpho layout `<style>` nodes (emergency off).
- In-panel hint: *If the page looks wrong after Layout changes, press Ctrl+R to reload, then run Morpho inject again.*

## Phase 2 (later)

- Preset layout toggles (e.g. density) behind feature flags, only after validating selectors against current Amazon Music DOM.
- Optional accent color from album art (sample img in-page — careful with performance and CORS).
- Group Listening: richer sync (track change) without breaking Amazon ToS.

## Technical notes

- Injected script targets **older CEF** — no `?.` / `??`; use `&&` guards.
- All new UI lives in `buildInjectMorphoExtensionExpression` in `src/main/cdp/amazonBridge.ts`.
- Testing: `npm run build:main` → `npm run inject:extension` with Amazon Music running and remote debugging enabled.
- Home-page network reconnaissance: `npm run recon:home-network` (or `scripts/run-home-network-recon.ps1`) captures CDP `Network.*` events + in-page fetch/XHR snippets into `logs/home-network-recon-*.jsonl`.
