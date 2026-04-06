import { TestMemory } from '../memory/memorySchema';
import { RegressionDiff, DetectionResult, FailureType } from './detector';
import { callClaude } from '../claude/client';

export async function classifyFailure(
  baseline: TestMemory,
  diff: RegressionDiff,
  errorMessage?: string,
  pageContext?: string
): Promise<DetectionResult> {

  // Build a concise summary of baseline selector anchors for context
  const selectorContext = baseline.selectorAnchors
    .slice(0, 15) // cap to avoid blowing token budget
    .map(a => {
      const fallbacks = a.fallbacks.length > 0
        ? ` | fallbacks: ${a.fallbacks.join(', ')}`
        : '';
      return `  step ${a.stepIndex} (${a.stepType}): \`${a.primary}\` [${a.stability}]${fallbacks}`;
    })
    .join('\n');

  // Build step summary so Claude understands the test flow
  const stepSummary = baseline.steps
    .slice(0, 20)
    .map(s =>
      `  ${s.index + 1}. ${s.type}` +
      (s.selector ? ` → \`${s.selector}\`` : '') +
      (s.url ? ` → ${s.url}` : '') +
      (s.value ? ` = "${s.value}"` : '')
    )
    .join('\n');

  const prompt = `You are a senior QA engineer classifying a Playwright test failure and suggesting a fix.

## Test
"${baseline.meta.test}"
Suite: ${baseline.meta.suite}
Base URL: ${baseline.meta.baseUrl}

## What this test normally does
${baseline.aiSummary}

## Baseline test flow
${stepSummary}

## Known selector anchors from baseline
${selectorContext || '(none recorded)'}

## Failure error message
${errorMessage || 'No specific error message provided — test timed out or assertion failed silently.'}

## Page context at time of failure
${pageContext || '(no page snapshot available)'}

The above may contain a full Playwright error-context document (with page snapshot / accessibility tree, error details, and test source) or a compact summary of interactive page elements. Use it to identify elements that exist on the page but have different text/name/role than expected by the failing locator. For example, if the error says waiting for a button named "Sign Out tempered" but the page snapshot shows button "Sign Out", the fix is to update the locator name to "Sign Out".

## Diff vs baseline
- Missing selectors (${diff.missingSelectors.length}): ${diff.missingSelectors.slice(0, 5).join(', ') || 'none'}
- New selectors not in baseline (${diff.newSelectors.length}): ${diff.newSelectors.slice(0, 5).join(', ') || 'none'}
- Network status changes: ${diff.networkStatusChanges.map(c => `${c.endpoint} ${c.was}→${c.now}`).join(', ') || 'none'}
- Timing regressions: ${diff.timingRegressions.map(t => `${t.endpoint} ${t.baselineP95}ms→${t.current}ms`).join(', ') || 'none'}
- Screenshot changes: ${diff.screenshotDiffs.length} page(s) look different
- Step count delta: ${diff.missingSteps > 0 ? `-${diff.missingSteps} steps` : diff.extraSteps > 0 ? `+${diff.extraSteps} steps` : 'unchanged'}

## Failure categories
- REAL_REGRESSION: actual app bug — functionality broken, data missing, flow broken
- BROKEN_SELECTOR: element exists but selector no longer matches after a UI refactor or text change
- FLAKY_NETWORK: timing or transient network issue, likely not a code bug, safe to retry
- VISUAL_DRIFT: page looks different but core functionality still works

## Instructions
1. Classify the failure into one of the categories above.
2. Explain the root cause in one clear sentence.
3. If BROKEN_SELECTOR: parse the error to identify which locator failed and suggest the corrected selector based on the error context (e.g. if the error says waiting for a button named "Sign Out tempered" but the page has "Sign Out", suggest the corrected name).
4. If REAL_REGRESSION: identify the likely broken component or endpoint.
5. For any type: provide a concrete, actionable fix suggestion — a code snippet or selector change the developer can apply immediately.

## Your response
Return ONLY valid JSON. No markdown, no explanation. Exactly this shape:
{
  "failureType": "REAL_REGRESSION" | "BROKEN_SELECTOR" | "FLAKY_NETWORK" | "VISUAL_DRIFT",
  "confidence": 0.0-1.0,
  "details": "one clear sentence explaining the likely root cause",
  "healingSuggestion": "actionable fix: the exact selector or code change to apply. For FLAKY_NETWORK or VISUAL_DRIFT where no code fix is needed, describe the recommended action."
}`;

  try {
    const raw = await callClaude(prompt, { jsonMode: true, maxTokens: 1024 });
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
