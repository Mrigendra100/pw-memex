import { TestMemory } from '../memory/memorySchema';
import { RegressionDiff, DetectionResult, FailureType } from './detector';
import { callClaude } from '../claude/client';

export async function classifyFailure(
  baseline: TestMemory,
  diff: RegressionDiff,
  errorMessage?: string
): Promise<DetectionResult> {

  const prompt = `You are a senior QA engineer classifying a Playwright test failure.

## Test
"${baseline.meta.test}"

## What this test normally does
${baseline.aiSummary}

## Failure error message
${errorMessage || 'No specific error message provided — test timed out or assertion failed silently.'}

## Diff vs baseline
- Missing selectors (${diff.missingSelectors.length}): ${diff.missingSelectors.slice(0, 5).join(', ') || 'none'}
- New selectors not in baseline (${diff.newSelectors.length}): ${diff.newSelectors.slice(0, 5).join(', ') || 'none'}
- Network status changes: ${diff.networkStatusChanges.map(c => `${c.endpoint} ${c.was}→${c.now}`).join(', ') || 'none'}
- Timing regressions: ${diff.timingRegressions.map(t => `${t.endpoint} ${t.baselineP95}ms→${t.current}ms`).join(', ') || 'none'}
- Screenshot changes: ${diff.screenshotDiffs.length} page(s) look different
- Step count delta: ${diff.missingSteps > 0 ? `-${diff.missingSteps} steps` : diff.extraSteps > 0 ? `+${diff.extraSteps} steps` : 'unchanged'}

## Failure categories
- REAL_REGRESSION: actual app bug — functionality broken, data missing, flow broken
- BROKEN_SELECTOR: element exists but selector no longer matches after a UI refactor
- FLAKY_NETWORK: timing or transient network issue, likely not a code bug, safe to retry
- VISUAL_DRIFT: page looks different but core functionality still works

## Your response
Return ONLY valid JSON. No markdown, no explanation. Exactly this shape:
{
  "failureType": "REAL_REGRESSION" | "BROKEN_SELECTOR" | "FLAKY_NETWORK" | "VISUAL_DRIFT",
  "confidence": 0.0-1.0,
  "details": "one clear sentence explaining the likely root cause",
  "healingSuggestion": "if BROKEN_SELECTOR: the exact selector string to try instead. For all other types: null"
}`;

  try {
    const raw = await callClaude(prompt, { jsonMode: true, maxTokens: 512 });
    const parsed = JSON.parse(raw);

    return {
      failureType: parsed.failureType as FailureType,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      details: parsed.details || 'No details returned.',
      healingSuggestion: parsed.healingSuggestion || undefined,
      diff,
    };
  } catch (e) {
    console.error('Classifier error:', e);
    return {
      failureType: 'REAL_REGRESSION',
      confidence: 0.5,
      details: 'Classification failed — treating as real regression until proven otherwise.',
      diff,
    };
  }
}
