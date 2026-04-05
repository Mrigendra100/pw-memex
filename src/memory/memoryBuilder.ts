import { ParsedTrace, ActionEntry, NetworkEntry } from '../parser/traceParser';
import { callClaude } from '../claude/client';
import {
  TestMemory, MemoryStep, SelectorAnchor,
  NetworkBaseline, ScreenshotRecord, AssertionRecord
} from './memorySchema';

export async function buildMemory(
  testTitle: string,
  suitePath: string,
  trace: ParsedTrace,
  baseUrl: string
): Promise<TestMemory> {

  const steps = buildSteps(trace.actions);
  const selectorAnchors = buildSelectorAnchors(trace.actions);
  const networkCalls = buildNetworkBaseline(trace.networkCalls);
  const screenshots = buildScreenshotRecords(trace.screenshots, trace.actions);
  const assertions = extractAssertions(trace.actions);
  const routeJourney = buildRouteJourney(trace.actions, baseUrl);

  const aiSummary = await generateAISummary(
    testTitle, steps, networkCalls, selectorAnchors
  );

  return {
    meta: {
      test: testTitle,
      suite: suitePath,
      baseline: new Date().toISOString(),
      baseUrl,
      status: 'passed',
    },
    routeJourney,
    steps,
    selectorAnchors,
    networkCalls,
    pageStates: [],       // populated in v0.2 via DOM snapshot parsing
    screenshots,
    assertions,
    aiSummary,
  };
}

function buildSteps(actions: ActionEntry[]): MemoryStep[] {
  return actions.map((a, i) => ({
    index: i,
    type: a.type,
    selector: a.selector,
    value: a.value,
    url: a.url,
    duration: a.duration,
  }));
}

function buildSelectorAnchors(actions: ActionEntry[]): SelectorAnchor[] {
  const anchors: SelectorAnchor[] = [];

  actions.forEach((action, i) => {
    if (!action.selector) return;

    const allSelectors = [
      action.selector,
      ...(action.allSelectors || []),
    ].filter((s, idx, arr) => s && arr.indexOf(s) === idx); // deduplicate

    const ranked = rankSelectorsByStability(allSelectors);

    anchors.push({
      stepIndex: i,
      stepType: action.type,
      primary: ranked[0],
      fallbacks: ranked.slice(1),
      stability: assessStability(ranked[0]),
      lastSeen: new Date().toISOString(),
    });
  });

  return anchors;
}

function rankSelectorsByStability(selectors: string[]): string[] {
  const stabilityScore = (sel: string): number => {
    if (sel.includes('data-testid') || sel.includes('data-test-id')) return 100;
    if (sel.includes('aria-label') || sel.startsWith('role=')) return 85;
    if (sel.match(/^#[a-zA-Z]/) || sel.includes('[id=')) return 70;  // semantic ID
    if (sel.includes('[type=') || sel.includes('[name=')) return 60;
    if (sel.includes('placeholder')) return 55;
    if (sel.startsWith('text=') || sel.startsWith('has-text=')) return 40;
    if (sel.includes('nth-child') || sel.includes('nth-of-type')) return 15;
    if (sel.match(/\d+/)) return 10;                  // positional — very fragile
    return 35;
  };

  return [...selectors].sort((a, b) => stabilityScore(b) - stabilityScore(a));
}

function assessStability(selector: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (selector.includes('data-testid') || selector.includes('aria-label')) return 'HIGH';
  if (selector.startsWith('role=') || selector.includes('[type=')) return 'MEDIUM';
  return 'LOW';
}

function buildNetworkBaseline(calls: NetworkEntry[]): NetworkBaseline[] {
  const grouped = new Map<string, NetworkEntry[]>();

  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(call);
  }

  return Array.from(grouped.entries()).map(([key, entries]) => {
    const durations = entries.map(e => e.duration).sort((a, b) => a - b);
    const p50Idx = Math.floor(durations.length * 0.5);
    const p95Idx = Math.min(Math.floor(durations.length * 0.95), durations.length - 1);

    return {
      key,
      method: entries[0].method,
      path: entries[0].path,
      expectedStatuses: [...new Set(entries.map(e => e.status))],
      timingBaseline: {
        p50: Math.round(durations[p50Idx] || 0),
        p95: Math.round(durations[p95Idx] || 0),
        sampleCount: entries.length,
      },
    };
  });
}

function buildScreenshotRecords(screenshots: any[], actions: ActionEntry[]): ScreenshotRecord[] {
  return screenshots.map(s => ({
    stepIndex: s.stepIndex,
    label: actions[s.stepIndex]
      ? `after-${actions[s.stepIndex].type}`
      : `step-${s.stepIndex}`,
    hash: s.hash,
    timestamp: new Date().toISOString(),
  }));
}

function extractAssertions(actions: ActionEntry[]): AssertionRecord[] {
  return actions
    .filter(a => a.type === 'expect')
    .map(a => ({
      type: inferAssertionType(a.description || ''),
      selector: a.selector,
      expected: a.value,
      raw: a.description || '',
    }));
}

function inferAssertionType(desc: string): AssertionRecord['type'] {
  if (desc.includes('URL') || desc.includes('url')) return 'url';
  if (desc.includes('visible') || desc.includes('hidden')) return 'visible';
  if (desc.includes('text') || desc.includes('Text')) return 'text';
  if (desc.includes('value') || desc.includes('Value')) return 'value';
  if (desc.includes('count') || desc.includes('Count')) return 'count';
  return 'other';
}

function buildRouteJourney(actions: ActionEntry[], baseUrl: string): string {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const a of actions) {
    if (a.type !== 'navigate' || !a.url) continue;
    try {
      const path = new URL(a.url).pathname;
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    } catch {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        paths.push(a.url);
      }
    }
  }

  return paths.join(' → ') || '/';
}

async function generateAISummary(
  testTitle: string,
  steps: MemoryStep[],
  network: NetworkBaseline[],
  anchors: SelectorAnchor[]
): Promise<string> {

  const fragileAnchors = anchors.filter(a => a.stability === 'LOW');
  const stepSummary = steps
    .map(s => `${s.type}${s.selector ? `: ${s.selector}` : ''}${s.url ? `: ${s.url}` : ''}`)
    .join('\n');

  const networkSummary = network
    .map(n => `${n.method} ${n.path} → ${n.expectedStatuses.join('/')} (p50: ${n.timingBaseline.p50}ms)`)
    .join('\n');

  const prompt = `You are a senior QA engineer documenting a Playwright test.
Write a 3–4 sentence plain English summary of what this test does, which parts are most likely to break, and what a failure most likely means. Be specific and actionable. No bullet points, no headings.

Test title: "${testTitle}"

Steps performed:
${stepSummary}

Network calls observed:
${networkSummary}

Low-stability selectors that may break first:
${fragileAnchors.map(a => a.primary).join(', ') || 'none'}

Write only the summary paragraph.`;

  try {
    return await callClaude(prompt, { maxTokens: 512 });
  } catch {
    return `This test covers: ${testTitle}. ${steps.length} steps recorded across ${network.length} API calls.`;
  }
}
