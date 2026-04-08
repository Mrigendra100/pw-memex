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
    console.log(`\n  Fix:`);
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

/**
 * Builds a markdown version of the detection report for embedding in the
 * Playwright HTML report as a `text/markdown` attachment.
 */
export function buildMarkdownReport(result: DetectionResult, testTitle: string): string {
  const icon = ICONS[result.failureType];
  const label = LABELS[result.failureType];
  const pct = Math.round(result.confidence * 100);

  const lines: string[] = [];
  lines.push(`# ${icon} pw-memex — ${label} (${pct}% confidence)`);
  lines.push('');
  lines.push(`**Test:** ${testTitle}`);
  lines.push('');
  lines.push(`## Details`);
  lines.push(result.details);

  if (result.healingSuggestion) {
    lines.push('');
    lines.push(`## Fix`);
    lines.push('');
    lines.push(result.healingSuggestion);
  }

  if (result.affectedEndpoints?.length) {
    lines.push('');
    lines.push(`## Affected endpoints`);
    result.affectedEndpoints.forEach(e => lines.push(`- ${e}`));
  }

  if (result.diff.missingSelectors.length > 0) {
    lines.push('');
    lines.push(`## Missing selectors (${result.diff.missingSelectors.length})`);
    result.diff.missingSelectors.slice(0, 10).forEach(s => lines.push(`- \`${s}\``));
  }

  if (result.diff.networkStatusChanges.length > 0) {
    lines.push('');
    lines.push(`## Network status changes`);
    result.diff.networkStatusChanges.forEach(c =>
      lines.push(`- \`${c.endpoint}\`: ${c.was} → ${c.now}`)
    );
  }

  if (result.diff.timingRegressions.length > 0) {
    lines.push('');
    lines.push(`## Timing regressions`);
    result.diff.timingRegressions.forEach(t =>
      lines.push(`- \`${t.endpoint}\`: ${t.baselineP95}ms → ${t.current}ms`)
    );
  }

  if (result.diff.screenshotDiffs.length > 0) {
    lines.push('');
    lines.push(`## Screenshot diffs`);
    lines.push(`${result.diff.screenshotDiffs.length} page(s) look different from the baseline.`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Builds a one-line annotation summary for the Playwright HTML report
 * (shown as a chip/label next to the test title).
 */
export function buildAnnotationSummary(result: DetectionResult): { type: string; description: string } {
  const label = LABELS[result.failureType];
  const pct = Math.round(result.confidence * 100);
  const type = `pw-memex: ${label} (${pct}%)`;

  let description = result.details;
  if (result.healingSuggestion) {
    description += `\n\nFix: ${result.healingSuggestion}`;
  }
  return { type, description };
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
