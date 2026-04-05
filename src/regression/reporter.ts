import { DetectionResult, FailureType } from './detector';
import * as fs from 'fs';
import * as path from 'path';

const ICONS: Record<FailureType, string> = {
  PASS: '✓',
  REAL_REGRESSION: '✗',
  BROKEN_SELECTOR: '⚡',
  FLAKY_NETWORK: '~',
  VISUAL_DRIFT: '◈',
};

const LABELS: Record<FailureType, string> = {
  PASS: 'PASS',
  REAL_REGRESSION: 'REAL REGRESSION',
  BROKEN_SELECTOR: 'BROKEN SELECTOR',
  FLAKY_NETWORK: 'FLAKY NETWORK',
  VISUAL_DRIFT: 'VISUAL DRIFT',
};

export function printReport(result: DetectionResult, testTitle: string): void {
  const icon = ICONS[result.failureType];
  const label = LABELS[result.failureType];
  const pct = Math.round(result.confidence * 100);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${icon}  ${label}  (${pct}% confidence)`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Test:    ${testTitle}`);
  console.log(`  Details: ${result.details}`);

  if (result.healingSuggestion) {
    console.log(`\n  Healing suggestion:`);
    result.healingSuggestion.split('\n').forEach(line => {
      console.log(`    ${line}`);
    });
  }

  if (result.affectedEndpoints?.length) {
    console.log(`\n  Affected endpoints:`);
    result.affectedEndpoints.forEach(e => console.log(`    • ${e}`));
  }

  if (result.diff.missingSelectors.length > 0) {
    console.log(`\n  Missing selectors (${result.diff.missingSelectors.length}):`);
    result.diff.missingSelectors.slice(0, 5).forEach(s => console.log(`    • ${s}`));
  }

  if (result.diff.networkStatusChanges.length > 0) {
    console.log(`\n  Network status changes:`);
    result.diff.networkStatusChanges.forEach(c =>
      console.log(`    • ${c.endpoint}: ${c.was} → ${c.now}`)
    );
  }

  console.log(`${'─'.repeat(60)}\n`);
}

export function writeJsonReport(
  result: DetectionResult,
  testTitle: string,
  outputDir: string
): string {
  const report = {
    test: testTitle,
    timestamp: new Date().toISOString(),
    failureType: result.failureType,
    confidence: result.confidence,
    details: result.details,
    healingSuggestion: result.healingSuggestion,
    diff: result.diff,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const slug = testTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const outPath = path.join(outputDir, `${slug}-report.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}
