import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RunResult {
  passed: boolean;
  tracePaths: string[];
  errorOutput?: string;
}

/**
 * Runs a Playwright test suite and returns paths to all generated trace files.
 * Requires `use: { trace: 'on' }` or `trace: 'retain-on-failure'` in your playwright.config.ts.
 */
export function runPlaywright(
  specPattern: string,
  options: {
    resultsDir?: string;
    extraArgs?: string;
    projectName?: string;
  } = {}
): RunResult {
  const resultsDir = options.resultsDir || 'test-results';

  const args = [
    `npx playwright test`,
    specPattern,
    `--output=${resultsDir}`,
    options.projectName ? `--project=${options.projectName}` : '',
    options.extraArgs || '',
  ].filter(Boolean).join(' ');

  let passed = true;
  let errorOutput: string | undefined;

  try {
    execSync(args, { stdio: 'inherit' });
  } catch (e: any) {
    passed = false;
    errorOutput = e.stderr?.toString() || e.message;
  }

  // Collect all trace.zip files produced by this run
  const tracePaths = findTraceFiles(resultsDir);

  return { passed, tracePaths, errorOutput };
}

export function findTraceFiles(resultsDir: string): string[] {
  if (!fs.existsSync(resultsDir)) return [];

  const results: string[] = [];
  walkDir(resultsDir, results);
  return results;
}

function walkDir(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, results);
    } else if (entry.name === 'trace.zip') {
      results.push(fullPath);
    }
  }
}
