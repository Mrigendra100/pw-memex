import type { Reporter, TestCase, TestResult, Suite } from '@playwright/test/reporter';
import { MemexConfig } from '../memory/memorySchema';
import { parseTrace } from '../parser/traceParser';
import { buildMemory } from '../memory/memoryBuilder';
import { writeMemory, readMemory, findMemoryFile } from '../memory/memoryStore';
import { detectRegression } from '../regression/detector';
import { printReport } from '../regression/reporter';

export default class MemexReporter implements Reporter {
  private config: Required<MemexConfig>;

  constructor(options: Partial<MemexConfig> = {}) {
    this.config = {
      baseUrl: options.baseUrl ?? 'http://localhost:3000',
      outputDir: options.outputDir ?? '.pw-memory',
      screenshotDiffThreshold: options.screenshotDiffThreshold ?? 0.1,
      networkTimingMultiplier: options.networkTimingMultiplier ?? 3,
      model: options.model ?? 'claude-sonnet-4-6',
    };
  }

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    try {
      // Skip if the test was skipped
      if (result.status === 'skipped') return;

      // Resolve spec file path by walking up the suite tree
      const specPath = getSpecFilePath(test);

      // Resolve trace attachment path
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

      const tracePath = traceAttachment.path;
      const { outputDir, baseUrl, networkTimingMultiplier } = this.config;

      if (result.status === 'passed') {
        // Only learn if no baseline exists yet (guard against retries)
        const existing = findMemoryFile(test.title, outputDir, specPath ?? undefined);
        if (existing) return;

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
      console.error(`pw-memex: error processing "${test.title}": ${err.message}`);
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
