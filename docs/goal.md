# Project Goals

## 1. Publish to npm
Ship pw-memex as a public npm package so teams can install it with `npm install pw-memex` without cloning the repo.

---

## 2. VS Code extension
Build a VS Code extension that adds pw-memex actions alongside Playwright's native **Run test** and **Debug test** buttons in the test explorer. The extension should surface at minimum:
- **Learn** — generate a memory baseline from the last passing trace
- **Compare** — classify the most recent failure against the baseline

---

## 3. Zero-config Playwright reporter
Create a `pw-memex-reporter.ts` that plugs into `playwright.config.ts` as a reporter. It should handle the learn/compare lifecycle automatically:
- **On first pass** (no `.memory.md` exists for the test) → run **learn** and write the baseline
- **On any subsequent failure** (baseline exists) → run **compare** and print the classification report

No manual CLI invocation required.

---

## 4. Memory file structure
Organise `.pw-memory/` by spec file, then by test case:

```
.pw-memory/
└── <spec-file-name>/          ← folder named after the spec, without the .spec.ts suffix
    └── <test-case-name>.md    ← one file per test case (slugified title)
```

Example:
```
.pw-memory/
└── search-results/
    └── search-results-are-displayed-for-a-query.md
```
