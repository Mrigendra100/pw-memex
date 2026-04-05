import { TraceEvent } from './traceParser';

export interface NetworkEntry {
  method: string;
  url: string;
  path: string;
  status: number;
  requestBody?: any;
  responseHeaders?: Record<string, string>;
  duration: number;
  timestamp: number;
  requestId: string;
}

export function extractNetwork(events: TraceEvent[]): NetworkEntry[] {
  const completed: NetworkEntry[] = [];

  // ── Playwright 1.40+ format: resource-snapshot events in .network file ──
  for (const e of events) {
    if (e.type === 'resource-snapshot') {
      const snap = e.snapshot || {};
      const request = snap.request || {};
      const response = snap.response || {};

      const url: string = request.url || snap.url || '';
      if (!url) continue;

      const method = (request.method || 'GET').toUpperCase();
      const status = response.status || 0;

      let networkPath = '/';
      try { networkPath = new URL(url).pathname; } catch { /* ignore malformed */ }

      // snap.time = total request duration in ms (HAR format)
      // snap._monotonicTime = monotonic clock time in ms
      const duration = Math.round(snap.time || 0);
      const startTime = snap._monotonicTime || 0;

      // Flatten response headers array → object
      const responseHeaders: Record<string, string> = {};
      if (Array.isArray(response.headers)) {
        for (const h of response.headers) {
          responseHeaders[h.name] = h.value;
        }
      }

      completed.push({
        method,
        url,
        path: networkPath,
        status,
        requestBody: safeParseBody(request.postData),
        responseHeaders,
        duration: Math.max(0, duration),
        timestamp: startTime * 1000,
        requestId: snap._requestId || url,
      });
    }
  }

  // ── Legacy CDP format: Network.requestWillBeSent / Network.responseReceived ──
  if (completed.length === 0) {
    const pendingRequests = new Map<string, {
      url: string; method: string; body?: any; timestamp: number;
    }>();

    for (const e of events) {
      if (!e.params) continue;

      if (e.method === 'Network.requestWillBeSent') {
        const { requestId, request } = e.params;
        pendingRequests.set(requestId, {
          url: request?.url || '',
          method: (request?.method || 'GET').toUpperCase(),
          body: safeParseBody(request?.postData),
          timestamp: e.time || 0,
        });
      }

      if (e.method === 'Network.responseReceived') {
        const { requestId, response } = e.params;
        const pending = pendingRequests.get(requestId);
        if (!pending) continue;

        let networkPath = '/';
        try { networkPath = new URL(pending.url).pathname; } catch { /* ignore */ }

        completed.push({
          method: pending.method,
          url: pending.url,
          path: networkPath,
          status: response?.status || 0,
          requestBody: pending.body,
          responseHeaders: response?.headers,
          duration: Math.round((e.time || 0) - pending.timestamp),
          timestamp: pending.timestamp,
          requestId,
        });

        pendingRequests.delete(requestId);
      }
    }
  }

  return completed.filter(c => isRelevantRequest(c));
}

function safeParseBody(raw?: string): any {
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

function isRelevantRequest(entry: NetworkEntry): boolean {
  const url = entry.url.toLowerCase();
  const path = entry.path.toLowerCase();
  const pathWithoutQuery = path.split('?')[0];

  // ── Drop static asset extensions ─────────────────────────────────────────
  const ignoredExtensions = [
    '.js', '.mjs', '.css', '.map',
    '.woff', '.woff2', '.ttf', '.eot',
    '.ico', '.svg', '.gif',
    '.png', '.jpg', '.jpeg', '.webp', '.avif',
  ];
  if (ignoredExtensions.some(ext => pathWithoutQuery.endsWith(ext))) return false;

  // ── Drop known noise hosts ────────────────────────────────────────────────
  const ignoredHosts = [
    'google-analytics.com', 'googletagmanager.com',
    'hotjar.com', 'sentry.io', 'doubleclick.net',
    'fonts.gstatic.com', 'gstatic.com',
  ];
  if (ignoredHosts.some(h => url.includes(h))) return false;

  // ── Drop telemetry / beacon paths ─────────────────────────────────────────
  const ignoredPaths = [
    '/gen_204', '/client_204', '/log', '/beacon',
    '/_/log', '/pagead/', '/gtag/', '/gtm',
    '/verify/', '/async/hpba',
    '/xjs/', '/og/_/',               // Google internal JS/CSS bundle paths
    '/complete/search',              // autocomplete — fires on every keystroke
    '/images/',                      // image paths without extension
    '/shared_dict/',
  ];
  if (ignoredPaths.some(p => path.startsWith(p) || path.includes(p))) return false;

  return true;
}
