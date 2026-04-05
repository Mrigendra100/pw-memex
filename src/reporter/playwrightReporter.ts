import type { Reporter, TestCase, TestResult, Suite, FullConfig, FullResult } from '@playwright/test/reporter';
import { MemexConfig } from '../memory/memorySchema';
import { parseTrace } from '../parser/traceParser';
import { buildMemory } from '../memory/memoryBuilder';
import { writeMemory, readMemory, findMemoryFile } from '../memory/memoryStore';
import { detectRegression } from '../regression/detector';
import { printReport } from '../regression/reporter';

export default class MemexReporter implements Reporter {
  private options: Partial<MemexConfig>;
  private config!: Required<MemexConfig>;
  private _queue: Array<{ test: TestCase; result: TestResult }> = [];

  constructor(options: Partial<MemexConfig> = {}) {
    this.options = options;
  }

  onBegin(config: FullConfig): void {
    // Auto-detect baseUrl from playwright.config.ts if not explicitly provided
    const playwrightBaseUrl = config.projects[0]?.use?.baseURL;
    // PW_MEMEX_FORCE_LEARN=1 env var overrides config option
    const envForce = process.env.PW_MEMEX_FORCE_LEARN === '1';
    this.config = {
      baseUrl: this.options.baseUrl ?? playwrightBaseUrl ?? '',
      outputDir: this.options.outputDir ?? '.pw-memory',
      screenshotDiffThreshold: this.options.screenshotDiffThreshold ?? 0.1,
      networkTimingMultiplier: this.options.networkTimingMultiplier ?? 3,
      model: this.options.model ?? 'claude-sonnet-4-6',
      forceLearn: envForce || (this.options.forceLearn ?? false),
    };
  }

  // onTestEnd returns void — Playwright does NOT await it.
  // Only queue items here; all async work happens in onEnd.
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'skipped') return;

    const traceAttachment = result.attachments.find(
      a => a.name === 'trace' && a.path
    );
    if (!traceAttachment?.path) {
      if (result.status === 'passed') {
        console.log(
          `pw-memex: trace not found for "${test.title}". ` +
          `Set use: { trace: 'on' } in playwright.config to enable learning.`
        );
      }
      return;
    }

    this._queue.push({ test, result });
  }

  // onEnd returns Promise — Playwright awaits this before exiting.
  async onEnd(_result: FullResult): Promise<void> {
    for (const { test, result } of this._queue) {
      await this._processTest(test, result);
    }
  }

  private async _processTest(test: TestCase, result: TestResult): Promise<void> {
    try {
      const specPath = getSpecFilePath(test);
      const traceAttachment = result.attachments.find(
        a => a.name === 'trace' && a.path
      );
      if (!traceAttachment?.path) return;

      const tracePath = traceAttachment.path;
      const { outputDir, baseUrl, networkTimingMultiplier } = this.config;

      if (result.status === 'passed') {
        const { forceLearn } = this.config;
        // Skip if baseline already exists, unless forceLearn is set
        const existing = findMemoryFile(test.title, outputDir, specPath ?? undefined);
        if (existing && !forceLearn) return;

        console.log(`pw-memex: learning from "${test.title}"...`);
        const parsedTrace = await parseTrace(tracePath);
        const memory = await buildMemory(
          test.title,
          specPath ?? tracePath,
          parsedTrace,
          baseUrl,
        );
        const outPath = writeMemory(memory, outputDir, specPath ?? undefined);
        console.log(`pw-memex: baseline written → ${outPath}`);

      } else if (result.status === 'failed' || result.status === 'timedOut') {
        const memoryPath = findMemoryFile(test.title, outputDir, specPath ?? undefined);
        if (!memoryPath) {
          console.log(`pw-memex: no baseline yet for "${test.title}", skipping compare.`);
          return;
        }

        const baseline = readMemory(memoryPath);
        if (!baseline) return;

        const parsedTrace = await parseTrace(tracePath);
        const errorMsg = result.errors[0]?.message;
        const detection = await detectRegression(baseline, parsedTrace, errorMsg, {
          networkTimingMultiplier,
        });
        printReport(detection, test.title);
      }
    } catch (err: any) {
      console.error(`pw-memex: error processing "${test.title}":`, err);
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}

function getSpecFilePath(test: TestCase): string | null {
  let suite: Suite | undefined = test.parent;
  while (suite) {
    if (suite.type === 'file') return suite.title;
    suite = suite.parent;
  }
  return null;
}
