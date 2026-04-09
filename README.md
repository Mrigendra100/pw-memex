# pw-memex

> Turn Playwright traces into regression intelligence.

pw-memex reads the trace files your Playwright tests already produce and uses Claude to build a semantic memory of what each test does. On subsequent failures, it diffs the new trace against that memory and classifies the failure — so you know immediately whether to investigate the app, fix a selector, retry a flaky request, or update a visual baseline.

---

## How it works

**Learn mode** (first passing run): Parses the trace, calls Claude to build a `.memory.md` baseline capturing every action, network request, and screenshot the test touched. This file lives in your repo alongside your specs.

**Compare mode** (every subsequent failure): Parses the new trace, diffs it against the baseline, and classifies the failure:

| Classification | Meaning | Action |
|---|---|---|
| `REAL_REGRESSION` | App functionality is broken | Investigate immediately |
| `BROKEN_SELECTOR` | Element exists, selector changed | Auto-heal with suggested replacement |
| `FLAKY_NETWORK` | Timing / transient network issue | Retry, investigate infra |
| `VISUAL_DRIFT` | Page looks different, functionality intact | Update baseline or raise with design |

The memory file is human-readable markdown, git-diffable, and AI-parseable. A change to it in a PR is itself a signal that expected behaviour changed.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.0.0 |
| Playwright | >= 1.40.0 |
| AI provider API key | Anthropic, OpenAI, or Gemini (one required) |

pw-memex reads traces produced by your existing test runner — it does not replace Playwright.

---

## Installation

```bash
npm install pw-memex
```

Or clone and build locally:

```bash
git clone https://github.com/Mrigendra100/pw-memex.git
cd pw-memex
npm install
npm run build
```

---

## Setup

### 1. Add your API key

Copy `.env.example` to `.env` and configure your preferred AI provider:

**Anthropic (default)**
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Optional — defaults to claude-sonnet-4-5
ANTHROPIC_MODEL=claude-sonnet-4-6
```

**OpenAI**
```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Optional — defaults to gpt-4o
OPENAI_MODEL=gpt-4o

# Optional — force max_completion_tokens for a custom/forked model name
# (auto-enabled for gpt-5*, o1*, o3*, o4* — only set this for unrecognised names)
# OPENAI_USE_COMPLETION_TOKENS=1
```
Install the SDK: `npm install openai`

> pw-memex automatically picks the correct token-limit parameter per model:
> `max_tokens` for legacy models (`gpt-4`, `gpt-4o`, `gpt-3.5-turbo`, …) and
> `max_completion_tokens` for newer reasoning models (`gpt-5*`, `o1*`, `o3*`, `o4*`).

**Google Gemini**
```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key-here

# Optional — defaults to gemini-1.5-pro
GEMINI_MODEL=gemini-1.5-pro
```
Install the SDK: `npm install @google/generative-ai`

> `AI_PROVIDER` defaults to `anthropic` — existing setups require no changes.

### 2. Add the reporter to `playwright.config.ts`

The reporter hooks into your existing test run automatically — no separate commands needed.

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['pw-memex/reporter', {
      outputDir: '.pw-memory',   // where .md baselines are written
    }],
    ['html'],
  ],
  use: {
    trace: 'on',   // required — pw-memex reads these trace files
  },
});
```

> **Important:** `trace: 'on'` is required. `'on-first-retry'` will not produce traces for passing tests, so the reporter cannot learn from them.
>
> **Reporter order matters:** list `pw-memex/reporter` **before** `['html']` so the pw-memex classification is picked up by the HTML reporter and shown alongside each failing test in `npx playwright show-report`.

### HTML report integration

When a test fails, pw-memex attaches its classification to the test result in two forms, both visible in `npx playwright show-report`:

- **Annotation chip** at the top of the test (e.g. `pw-memex: BROKEN SELECTOR (100%)`) with a short description and suggested fix
- **Markdown attachment** named `pw-memex analysis — <FAILURE_TYPE>` — the full report with details, affected endpoints, missing selectors, and network/timing changes

The same report is also printed to stdout, so nothing about the CLI experience changes.

### 3. Reporter options

All options are optional:

```ts
['pw-memex/reporter', {
  outputDir: '.pw-memory',          // default: '.pw-memory'
  baseUrl: 'http://localhost:3000', // auto-detected from playwright.config if omitted
  screenshotDiffThreshold: 0.1,     // fraction of pixels allowed to differ (0–1)
  networkTimingMultiplier: 3,       // flag if response time > baseline × this
  model: 'claude-sonnet-4-6',       // Claude model to use for AI summaries
  forceLearn: false,                // re-learn and overwrite baselines every run
}]
```

---

## Usage

### Automatic (via reporter)

Once the reporter is configured, learning and comparison happen automatically:

- **Passing test, no baseline** → reporter learns and writes `.pw-memory/<spec>/<test>.md`
- **Passing test, baseline exists** → reporter skips (baseline is up to date)
- **Failing test, baseline exists** → reporter compares and prints a classified failure report

### Force re-learn

Use this when you have fixed a selector or changed app behaviour and want to update the baseline.

**Option 1 — `pw-memex test` wrapper** (recommended):

```bash
# Re-learns all tests in the file (overwrites existing baselines)
npx pw-memex test tests/filename.spec.ts --learn

# --learn works alongside any other Playwright flags
npx pw-memex test tests/filename.spec.ts --learn --headed --project=chromium
```

**Option 2 — environment variable** (one-off, no config change):

```bash
PW_MEMEX_FORCE_LEARN=1 npx playwright test tests/filename.spec.ts
```

**Option 3 — reporter config** (always re-learns every run):

```ts
['pw-memex/reporter', { outputDir: '.pw-memory', forceLearn: true }]
```

### CLI commands

```bash
# Run tests via pw-memex (recommended — enables --learn flag)
npx pw-memex test tests/my.spec.ts
npx pw-memex test tests/my.spec.ts --learn              # force re-learn
npx pw-memex test tests/my.spec.ts --learn --headed     # --learn + any Playwright flag

# Learn: build a memory baseline from a trace file directly
npx pw-memex learn test-results/my-test/trace.zip \
  --test "my test name" \
  --suite tests/my.spec.ts \
  --output .pw-memory

# Compare: classify a failure against an existing baseline
npx pw-memex compare test-results/my-test/trace.zip .pw-memory/my-test.md \
  --error "element not found"

# List all saved baselines
npx pw-memex list --dir .pw-memory
```

---

## Memory file format

Each test gets a `.memory.md` file under `.pw-memory/<spec-name>/<test-name>.md`:

```markdown
---
test: TC01 - Search results are displayed for a query
suite: tests/googleSearch.spec.ts
baseline: 2026-04-06T10:00:00.000Z
baseUrl: https://www.google.com/
status: passed
---

## Route journey
/

## Steps
1. **navigate**
   url: https://www.google.com/
2. **fill**
   selector: `[aria-label="Search"]`
   value: `playwright`

## Selector anchors
### Step 1 — fill (MEDIUM stability)
- primary:   `[aria-label="Search"]`
- fallback1: `textarea[name=q]`

## Network calls
### GET /
- expected status: 200
- timing p50: 312ms

## AI summary
This test navigates to Google and submits a search query ...
```

The file is human-readable, git-diffable, and safe to edit by hand. Committing it signals to reviewers that expected test behaviour changed.

---

## Project structure

```
src/
├── index.ts                  # CLI entry point (learn / compare / list / test)
├── reporter/
│   └── playwrightReporter.ts # Playwright reporter (auto learn + compare)
├── parser/
│   ├── traceParser.ts        # Unzips and reads Playwright trace archives
│   ├── actionExtractor.ts    # Pulls actions (clicks, fills, navigations)
│   ├── networkExtractor.ts   # Pulls network requests / responses
│   └── screenshotExtractor.ts# Extracts and diffs screenshots
├── memory/
│   ├── memorySchema.ts       # TypeScript types for memory files and config
│   ├── memoryBuilder.ts      # Calls Claude to produce the baseline markdown
│   └── memoryStore.ts        # Reads / writes .memory.md files on disk
├── regression/
│   ├── detector.ts           # Diffs current trace data against baseline
│   ├── classifier.ts         # Maps diff signals to a failure category
│   └── reporter.ts           # Formats and outputs the classification report
└── claude/
    └── client.ts             # AI provider wrapper — Anthropic, OpenAI, Gemini (single point of API calls)
```

---

## Scripts

```bash
npm run build   # tsc → dist/
npm run dev     # ts-node src/index.ts (no build step)
npm start       # node dist/index.js
npm test        # playwright test tests/
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a full history of changes per version.

---

## License

MIT
