import type { Reporter, TestCase, TestResult, Suite, FullConfig, FullResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import { MemexConfig } from '../memory/memorySchema';
import { parseTrace } from '../parser/traceParser';
import { buildMemory } from '../memory/memoryBuilder';
import { writeMemory, readMemory, findMemoryFile } from '../memory/memoryStore';
import { detectRegression, DetectionResult } from '../regression/detector';
import { printReport, buildMarkdownReport, buildAnnotationSummary } from '../regression/reporter';

type PassedItem = {
  kind: 'passed';
  test: TestCase;
  result: TestResult;
};

type FailedItem = {
  kind: 'failed';
  test: TestCase;
  result: TestResult;
  // Detection is kicked off during onTestEnd so it runs in parallel with
  // subsequent tests. Awaited in onEnd before we mutate the test result.
  detectionPromise: Promise<DetectionResult | null>;
};

type QueueItem = PassedItem | FailedItem;

export default class MemexReporter implements Reporter {
  private options: Partial<MemexConfig>;
  private config!: Required<MemexConfig>;
  private _queue: QueueItem[] = [];

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
  // For failed tests we START detection immediately so it runs in parallel with
  // subsequent tests. All promises are awaited in onEnd before mutation.
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

    if (result.status === 'passed') {
      this._queue.push({ kind: 'passed', test, result });
    } else if (result.status === 'failed' || result.status === 'timedOut') {
      // Kick off detection right away — do NOT await.
      const detectionPromise = this._runDetection(test, result).catch(err => {
        console.error(`pw-memex: error during detection for "${test.title}":`, err);
        return null;
      });
      this._queue.push({ kind: 'failed', test, result, detectionPromise });
    }
  }

  // onEnd is awaited by Playwright. Handle learns, await pending detections,
  // then push attachments/annotations so the HTML reporter picks them up.
  async onEnd(_result: FullResult): Promise<void> {
    // 1. Learn from passed tests (sequential — file writes are quick)
    for (const item of this._queue) {
      if (item.kind !== 'passed') continue;
      await this._learnFromPassed(item.test, item.result);
    }

    // 2. Wait for all detection promises to settle in parallel
    const failedItems = this._queue.filter((i): i is FailedItem => i.kind === 'failed');
    const detections = await Promise.all(
      failedItems.map(async i => ({
        test: i.test,
        result: i.result,
        detection: await i.detectionPromise,
      }))
    );

    // 3. For each failed test, attach the markdown report and annotation,
    //    then print the same report to stdout (CLI behavior unchanged).
    for (const { test, result, detection } of detections) {
      if (!detection) continue;

      const markdown = buildMarkdownReport(detection, test.title);

      // Attachment — shows up in the Playwright HTML report as a clickable
      // "pw-memex analysis" item under the failing test.
      result.attachments.push({
        name: `pw-memex analysis — ${detection.failureType}`,
        contentType: 'text/markdown',
        body: Buffer.from(markdown, 'utf8'),
      });

      // Annotation — shows up as a chip/label at the top of the test in the
      // HTML report header, alongside any existing test.info().annotations.
      const summary = buildAnnotationSummary(detection);
      test.annotations.push(summary);

      // CLI output (existing behavior)
      printReport(detection, test.title);
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async _learnFromPassed(test: TestCase, result: TestResult): Promise<void> {
    try {
      const specPath = getSpecFilePath(test);
      const traceAttachment = result.attachments.find(
        a => a.name === 'trace' && a.path
      );
      if (!traceAttachment?.path) return;

      const { outputDir, baseUrl, forceLearn } = this.config;
      const existing = findMemoryFile(test.title, outputDir, specPath ?? undefined);
      if (existing && !forceLearn) return;

      console.log(`pw-memex: learning from "${test.title}"...`);
      const parsedTrace = await parseTrace(traceAttachment.path);
      const memory = await buildMemory(
        test.title,
        specPath ?? traceAttachment.path,
        parsedTrace,
        baseUrl,
      );
      const outPath = writeMemory(memory, outputDir, specPath ?? undefined);
      console.log(`pw-memex: baseline written → ${outPath}`);
    } catch (err: any) {
      console.error(`pw-memex: error learning from "${test.title}":`, err);
    }
  }

  private async _runDetection(
    test: TestCase,
    result: TestResult
  ): Promise<DetectionResult | null> {
    const specPath = getSpecFilePath(test);
    const traceAttachment = result.attachments.find(
      a => a.name === 'trace' && a.path
    );
    if (!traceAttachment?.path) return null;

    const { outputDir, networkTimingMultiplier } = this.config;
    const memoryPath = findMemoryFile(test.title, outputDir, specPath ?? undefined);
    if (!memoryPath) {
      console.log(`pw-memex: no baseline yet for "${test.title}", skipping compare.`);
      return null;
    }

    const baseline = readMemory(memoryPath);
    if (!baseline) return null;

    const parsedTrace = await parseTrace(traceAttachment.path);
    // Collect the full error context: message + stack + all errors
    const errorMsg = result.errors
      .map(e => [e.message, e.stack].filter(Boolean).join('\n'))
      .join('\n---\n') || undefined;

    // Read Playwright's error-context.md — contains accessibility tree,
    // error details, and test source in a compact format
    const errorContextAttachment = result.attachments.find(
      a => a.name === 'error-context' && a.contentType === 'text/markdown'
    );
    let errorContext: string | undefined;
    if (errorContextAttachment?.path) {
      try { errorContext = fs.readFileSync(errorContextAttachment.path, 'utf8'); } catch {}
    } else if (errorContextAttachment?.body) {
      errorContext = errorContextAttachment.body.toString('utf8');
    }

    return await detectRegression(baseline, parsedTrace, errorMsg, {
      networkTimingMultiplier,
    }, errorContext);
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
