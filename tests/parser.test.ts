import { test, expect } from '@playwright/test';
import * as path from 'path';
import { parseTrace } from '../src/parser/traceParser';

test('parseTrace returns actions and network calls', async () => {
  const tracePath = path.join(__dirname, 'fixtures/sample-trace.zip');
  const trace = await parseTrace(tracePath);

  expect(trace.actions.length).toBeGreaterThan(0);
  expect(trace.networkCalls.length).toBeGreaterThan(0);
  expect(trace.events.length).toBeGreaterThan(0);
});

test('selector ranking puts data-testid first', () => {
  const selectors = [
    'text=Submit',
    'button:nth-child(2)',
    '[data-testid="submit"]',
    'button[type="submit"]',
  ];

  const ranked = selectors.sort((a, b) => {
    const score = (s: string) => s.includes('data-testid') ? 100 : s.startsWith('text=') ? 30 : 50;
    return score(b) - score(a);
  });

  expect(ranked[0]).toBe('[data-testid="submit"]');
});
