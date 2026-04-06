# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.3] - 2026-04-06

### Fixed
- **Locator timeout failures were misclassified as `VISUAL_DRIFT`** when screenshots changed alongside the failure. A test that timed out waiting for a renamed button (e.g. `"Sign Out tempered"` instead of `"Sign Out"`) would accumulate screenshot diffs and incorrectly trigger the visual-drift fast path before reaching the classifier.
- Reporter now passes the **full error stack and call log** to the detector — previously only `errors[0].message` was forwarded, stripping the Playwright call log that identifies the failing locator.

### Added
- `isLocatorFailure()` — detects locator-type errors from Playwright error messages (`locator.waitFor`, `waiting for`, `strict mode violation`, etc.)
- `extractFailedSelector()` — parses the Playwright call log to extract the human-readable description of the failing locator (e.g. `getByRole('button', { name: 'Sign Out tempered' })`)
- Locator failures now route to **Claude for AI-powered root cause analysis** with full context: baseline steps, selector anchors with fallbacks, and the complete error including call log
- Classifier prompt enriched with baseline test flow and all known selector anchors — Claude can now suggest the exact corrected selector or code change
- Output section renamed from `Healing suggestion` to `Fix` for clarity

---

## [0.1.2] - 2026-04-06

### Added
- **`forceLearn` reporter option** — set `forceLearn: true` in reporter config to overwrite existing memory baselines every run
- **`PW_MEMEX_FORCE_LEARN=1` environment variable** — one-off force-learn without changing config; takes precedence over the config option
- **`pw-memex test` CLI command** — thin wrapper around `playwright test` that strips `--learn` before forwarding all other args. Enables `npx pw-memex test tests/my.spec.ts --learn` without Playwright rejecting the unknown flag
- **`deriveSelectorVariants()`** — derives alternative selector forms from the primary selector captured in the trace:
  - `textarea[name="q"]` → `[name="q"]` (drops tag, attribute-only)
  - `form#loginForm` → `#loginForm`, `[id="loginForm"]`
  - `#someId` → `[id="someId"]`
  - `button:has-text("Submit")` → `text=Submit`
  - `div.container` → `.container`
  - `[data-testid=...]` and `[aria-label=...]` — skipped (already optimal)
- Memory files now show `fallback1`, `fallback2`, etc. under each selector anchor

### Fixed
- `[id="..."]` selectors were scoring as default (35) in the stability ranker instead of semantic ID (70), matching `#id`. Fixed by adding `sel.includes('[id=')` to the score-70 rule.

---

## [0.1.1] - 2026-04-05

### Fixed
- **Memory files were never written when using the Playwright reporter.** Playwright's `Reporter` interface declares `onTestEnd` as returning `void` — it does not await the returned `Promise`. All async work (trace parsing, Claude call, file write) was being abandoned when Playwright exited after `onEnd`. Fixed by moving all async processing to `onEnd`, which Playwright does await (`Promise<void> | void` return type).
- Reporter now logs `pw-memex: baseline written → <path>` only after the file is confirmed written — previously this log could appear before the async work completed.

---

## [0.1.0] - 2026-04-05

### Added
- Initial release
- **`pw-memex learn <trace.zip>`** — parse a passing Playwright trace and write a `.memory.md` baseline
- **`pw-memex compare <trace.zip> <memory.md>`** — diff a failing trace against a baseline and classify the failure
- **`pw-memex list`** — list all memory baselines in the output directory
- **Playwright reporter** (`pw-memex/reporter`) — drop-in reporter that auto-learns on pass and auto-compares on failure
- **Four failure classifications**: `REAL_REGRESSION`, `BROKEN_SELECTOR`, `FLAKY_NETWORK`, `VISUAL_DRIFT`
- **Rule-based fast paths** for server errors (5xx), auth failures (401/403), pure selector failures, timing regressions, and visual drift — Claude is invoked only for ambiguous cases
- **Selector anchor stability ranking** — scores selectors by fragility (`data-testid` > `aria-label` > `#id` > `[name=]` > `text=` > positional) and surfaces fallbacks in the memory file
- **Human-readable `.memory.md` format** — YAML front-matter + markdown sections, git-diffable and editable by hand
- **AI summary** — Claude writes a plain-English description of what each test does, which selectors are fragile, and what a failure likely means
