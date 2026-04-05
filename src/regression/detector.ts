import { TestMemory } from '../memory/memorySchema';
import { ParsedTrace } from '../parser/traceParser';
import { classifyFailure } from './classifier';

export type FailureType =
  | 'PASS'
  | 'REAL_REGRESSION'
  | 'BROKEN_SELECTOR'
  | 'FLAKY_NETWORK'
  | 'VISUAL_DRIFT';

export interface RegressionDiff {
  missingSelectors: string[];
  newSelectors: string[];
  networkStatusChanges: { endpoint: string; was: number; now: number }[];
  timingRegressions: { endpoint: string; baselineP95: number; current: number }[];
  screenshotDiffs: { stepIndex: number; baselineHash: string; currentHash: string }[];
  missingSteps: number;
  extraSteps: number;
}

export interface DetectionResult {
  failureType: FailureType;
  confidence: number;
  details: string;
  healingSuggestion?: string;
  affectedEndpoints?: string[];
  diff: RegressionDiff;
}

export async function detectRegression(
  baseline: TestMemory,
  newTrace: ParsedTrace,
  failureError?: string,
  config?: { networkTimingMultiplier?: number }
): Promise<DetectionResult> {

  const timingMultiplier = config?.networkTimingMultiplier || 3;
  const diff = computeDiff(baseline, newTrace, timingMultiplier);

  // ── Rule-based fast paths before invoking Claude ──────────────────────────

  // Backend error: status code changed to 5xx
  const serverErrors = diff.networkStatusChanges.filter(c => c.now >= 500);
  if (serverErrors.length > 0) {
    return {
      failureType: 'REAL_REGRESSION',
      confidence: 0.97,
      details: `Server error(s) detected: ${serverErrors.map(e => `${e.endpoint} returned ${e.now}`).join('; ')}`,
      affectedEndpoints: serverErrors.map(e => e.endpoint),
      diff,
    };
  }

  // Auth error: 401/403 where 200 was expected
  const authErrors = diff.networkStatusChanges.filter(c => c.now === 401 || c.now === 403);
  if (authErrors.length > 0) {
    return {
      failureType: 'REAL_REGRESSION',
      confidence: 0.93,
      details: `Auth failure: ${authErrors.map(e => `${e.endpoint} → ${e.now}`).join(', ')}. Check session handling or API keys.`,
      affectedEndpoints: authErrors.map(e => e.endpoint),
      diff,
    };
  }

  // Pure selector failure: no network changes, just missing selectors
  const onlyBrokenSelectors =
    diff.missingSelectors.length > 0 &&
    diff.networkStatusChanges.length === 0 &&
    diff.timingRegressions.length === 0;

  if (onlyBrokenSelectors) {
    const healable = baseline.selectorAnchors.filter(a =>
      diff.missingSelectors.includes(a.primary) && a.fallbacks.length > 0
    );

    const suggestion = healable.length > 0
      ? healable.map(a =>
          `Replace \`${a.primary}\` → try \`${a.fallbacks[0]}\` (${assessStability(a.fallbacks[0])} stability)`
        ).join('\n')
      : 'No known fallback selectors. Inspect the DOM manually.';

    return {
      failureType: 'BROKEN_SELECTOR',
      confidence: 0.90,
      details: `${diff.missingSelectors.length} selector(s) no longer found. Network and flow appear intact.`,
      healingSuggestion: suggestion,
      diff,
    };
  }

  // Timing regression: slow API, no error codes
  const onlyTiming =
    diff.timingRegressions.length > 0 &&
    diff.networkStatusChanges.length === 0 &&
    diff.missingSelectors.length === 0;

  if (onlyTiming) {
    return {
      failureType: 'FLAKY_NETWORK',
      confidence: 0.78,
      details: `Timing regression on: ${diff.timingRegressions.map(t => `${t.endpoint} (${t.baselineP95}ms → ${t.current}ms)`).join(', ')}`,
      affectedEndpoints: diff.timingRegressions.map(t => t.endpoint),
      diff,
    };
  }

  // Visual only: screenshots differ but no selectors or network issues
  const onlyVisual =
    diff.screenshotDiffs.length > 0 &&
    diff.missingSelectors.length === 0 &&
    diff.networkStatusChanges.length === 0;

  if (onlyVisual) {
    return {
      failureType: 'VISUAL_DRIFT',
      confidence: 0.72,
      details: `${diff.screenshotDiffs.length} screenshot(s) changed. Functionality appears intact — check with design team.`,
      diff,
    };
  }

  // Ambiguous: hand off to Claude for deeper analysis
  return classifyFailure(baseline, diff, failureError);
}

function computeDiff(
  baseline: TestMemory,
  newTrace: ParsedTrace,
  timingMultiplier: number
): RegressionDiff {

  const baselineSelectors = baseline.selectorAnchors.map(a => a.primary);
  const currentSelectors = newTrace.actions
    .filter(a => a.selector)
    .map(a => a.selector!);

  const missingSelectors = baselineSelectors.filter(s => !currentSelectors.includes(s));
  const newSelectors = currentSelectors.filter(s => !baselineSelectors.includes(s));

  const networkStatusChanges: RegressionDiff['networkStatusChanges'] = [];
  for (const bl of baseline.networkCalls) {
    const current = newTrace.networkCalls.find(
      c => c.method === bl.method && c.path === bl.path
    );
    if (current && !bl.expectedStatuses.includes(current.status)) {
      networkStatusChanges.push({
        endpoint: bl.path,
        was: bl.expectedStatuses[0],
        now: current.status,
      });
    }
  }

  const timingRegressions: RegressionDiff['timingRegressions'] = [];
  for (const bl of baseline.networkCalls) {
    const current = newTrace.networkCalls.find(
      c => c.method === bl.method && c.path === bl.path
    );
    if (current && current.duration > bl.timingBaseline.p95 * timingMultiplier) {
      timingRegressions.push({
        endpoint: bl.path,
        baselineP95: bl.timingBaseline.p95,
        current: Math.round(current.duration),
      });
    }
  }

  const screenshotDiffs: RegressionDiff['screenshotDiffs'] = [];
  for (const blShot of baseline.screenshots) {
    const currentShot = newTrace.screenshots.find(s => s.stepIndex === blShot.stepIndex);
    if (currentShot && currentShot.hash !== blShot.hash) {
      screenshotDiffs.push({
        stepIndex: blShot.stepIndex,
        baselineHash: blShot.hash,
        currentHash: currentShot.hash,
      });
    }
  }

  return {
    missingSelectors,
    newSelectors,
    networkStatusChanges,
    timingRegressions,
    screenshotDiffs,
    missingSteps: Math.max(0, baseline.steps.length - newTrace.actions.length),
    extraSteps: Math.max(0, newTrace.actions.length - baseline.steps.length),
  };
}

function assessStability(selector: string): string {
  if (selector.includes('data-testid')) return 'HIGH';
  if (selector.startsWith('role=') || selector.includes('[type=')) return 'MEDIUM';
  return 'LOW';
}
