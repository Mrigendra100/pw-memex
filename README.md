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
| Playwright | >= 1.40.0 (in your test project) |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) |

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

1. Copy `.env.example` to `.env` and add your API key:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Optional overrides
ANTHROPIC_MODEL=claude-sonnet-4-6
MEMEX_OUTPUT_DIR=.pw-memory
```

2. Enable trace recording in your `playwright.config.ts`:

```ts
use: {
  trace: 'on-first-retry', // or 'on' to always record
}
```

3. (Optional) Add a `pw-memex.config.ts` to your project root:

```ts
import { MemexConfig } from 'pw-memex';

const config: MemexConfig = {
  baseUrl: 'http://localhost:3000',
  outputDir: '.pw-memory',
  screenshotDiffThreshold: 0.1,  // fraction of pixels allowed to differ (0–1)
  networkTimingMultiplier: 3,    // flag if response time > baseline × this
  model: 'claude-sonnet-4-6',
};

export default config;
```

---

## Usage

```bash
# Learn: build a memory baseline from a passing trace
pw-memex learn test-results/my-test/trace.zip --test "my test name" --output .pw-memory

# Compare: classify a failure against an existing baseline
pw-memex compare test-results/my-test/trace.zip .pw-memory/my-test-name.memory.md --error "element not found"

# List all saved baselines
pw-memex list --dir .pw-memory
```

---

## Project structure

```
src/
├── index.ts                  # CLI entry point (commander)
├── runner/
│   └── traceRunner.ts        # Orchestrates learn / compare flow
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
    └── client.ts             # Anthropic SDK wrapper (single point of API calls)
```

---

## Memory file format

Each test gets a `.memory.md` file with YAML front-matter and markdown sections:

```markdown
---
test: my-test
created: 2026-04-05T10:00:00Z
baseUrl: http://localhost:3000
---

## Actions
- navigate → /login
- fill #email → user@example.com
- click button[type=submit]

## Network
- POST /api/auth 200 (142ms)

## Screenshots
- step-1.png (hash: abc123)
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

## License

MIT
