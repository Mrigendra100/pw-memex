import { TraceEvent } from './traceParser';

export interface ActionEntry {
  type: 'click' | 'fill' | 'navigate' | 'press' | 'check' | 'select' | 'wait' | 'expect' | 'other';
  selector?: string;
  allSelectors?: string[];
  value?: string;
  url?: string;
  timestamp: number;
  duration?: number;
  description?: string;
}

export function extractActions(events: TraceEvent[]): ActionEntry[] {
  const actions: ActionEntry[] = [];

  // First pass: collect all 'after' events by callId for duration calculation
  const afterEvents = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'after' && e.callId && e.endTime) {
      afterEvents.set(e.callId, e.endTime);
    }
  }

  for (const e of events) {
    // Playwright 1.40+ records user actions under type 'before'
    // Action identity comes from class+method (e.g. "Frame.goto"), NOT apiName
    if (e.type === 'before') {
      const apiName: string =
        e.apiName ||
        (e.class && e.method ? `${e.class}.${e.method}` : '');
      if (!apiName) continue;

      // Skip internal browser-setup calls
      if (e.class === 'BrowserContext' && e.method === 'newPage') continue;

      const params = e.params || {};
      const startTime = e.startTime || e.time || 0;
      const endTime = e.callId ? afterEvents.get(e.callId) : undefined;

      const entry: ActionEntry = {
        type: mapActionType(apiName),
        selector: params.selector || extractSelectorFromApiName(apiName),
        allSelectors: collectFallbackSelectors(params),
        value: maskSensitiveValue(params.text || params.value),
        timestamp: startTime,
        duration: endTime ? Math.round(endTime - startTime) : undefined,
        description: apiName,
      };

      if (entry.type === 'navigate' && params.url) {
        entry.url = params.url;
      }

      actions.push(entry);
    }

    // Legacy format: some older traces still use type 'action'
    if (e.type === 'action') {
      const meta = e.metadata || {};
      const apiName: string = meta.apiName || e.apiName || '';
      const params = meta.params || {};

      const entry: ActionEntry = {
        type: mapActionType(apiName),
        selector: params.selector || extractSelectorFromApiName(apiName),
        allSelectors: collectFallbackSelectors(params),
        value: maskSensitiveValue(params.text || params.value),
        timestamp: e.time || 0,
        duration: meta.endTime ? Math.round(meta.endTime - (e.time || 0)) : undefined,
        description: apiName,
      };

      if (entry.type === 'navigate' && params.url) {
        entry.url = params.url;
      }

      actions.push(entry);
    }

    // Navigation events emitted by the browser
    if (e.type === 'event' && e.method === 'Page.frameNavigated' && e.params?.frame?.url) {
      actions.push({
        type: 'navigate',
        url: e.params.frame.url,
        timestamp: e.time || 0,
      });
    }

    if (e.type === 'event' && e.method === 'Page.navigate' && e.params?.url) {
      actions.push({
        type: 'navigate',
        url: e.params.url,
        timestamp: e.time || 0,
      });
    }
  }

  return deduplicateNavigations(actions);
}

function mapActionType(apiName: string): ActionEntry['type'] {
  const lower = apiName.toLowerCase();
  // method part only (e.g. "Frame.goto" → "goto")
  const method = lower.includes('.') ? lower.split('.').pop()! : lower;
  if (method === 'click' || method === 'tap' || method === 'dblclick') return 'click';
  if (method === 'fill' || method === 'type' || method === 'selecttext') return 'fill';
  if (method === 'goto' || method === 'navigate') return 'navigate';
  if (method === 'press' || lower.includes('keyboard')) return 'press';
  if (method === 'check' || method === 'uncheck') return 'check';
  if (method === 'selectoption') return 'select';
  if (method.startsWith('waitfor') || method === 'waitfortimeout') return 'wait';
  if (method.startsWith('expect') || method.includes('assert') || method === 'querycount') return 'expect';
  return 'other';
}

function extractSelectorFromApiName(apiName: string): string | undefined {
  const match = apiName.match(/locator\(['"](.+?)['"]\)/);
  return match ? match[1] : undefined;
}

function collectFallbackSelectors(params: Record<string, any>): string[] {
  const selectors: string[] = [];
  if (params.selector) selectors.push(params.selector);
  if (params.hasText) selectors.push(`text=${params.hasText}`);
  if (params.role) selectors.push(`role=${params.role}`);
  return [...new Set(selectors)];
}

function maskSensitiveValue(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.includes('@') && value.includes('.')) return '[email]';
  if (value.length >= 8 && /[A-Z]/.test(value) && /[0-9]/.test(value)) return '[password]';
  return value;
}

function deduplicateNavigations(actions: ActionEntry[]): ActionEntry[] {
  return actions.filter((action, i) => {
    if (action.type !== 'navigate') return true;
    const prev = actions[i - 1];
    return !prev || prev.type !== 'navigate' || prev.url !== action.url;
  });
}
