import AdmZip from 'adm-zip';
import * as fs from 'fs';
import { extractActions, ActionEntry } from './actionExtractor';
import { extractNetwork, NetworkEntry } from './networkExtractor';
import { extractScreenshots, ScreenshotEntry } from './screenshotExtractor';

export interface TraceEvent {
  type?: string;
  method?: string;
  params?: Record<string, any>;
  metadata?: Record<string, any>;
  time?: number;
  apiName?: string;
  sha1?: string;
  snapshotName?: string;
  // Playwright 1.40+ action event fields
  callId?: string;
  startTime?: number;
  endTime?: number;
  wallTime?: number;
  class?: string;       // e.g. "Frame", "Page", "Locator"
  // resource-snapshot (network) field
  snapshot?: Record<string, any>;
}

export interface ParsedTrace {
  events: TraceEvent[];
  resources: Map<string, Buffer>;
  actions: ActionEntry[];
  networkCalls: NetworkEntry[];
  screenshots: ScreenshotEntry[];
  /** Compact summary of interactive elements (buttons, inputs, links) from the last DOM snapshot */
  pageElementSummary?: string;
}

export { ActionEntry, NetworkEntry, ScreenshotEntry };

export async function parseTrace(tracePath: string): Promise<ParsedTrace> {
  if (!fs.existsSync(tracePath)) {
    throw new Error(`Trace file not found: ${tracePath}`);
  }

  const zip = new AdmZip(tracePath);
  const entries = zip.getEntries();

  const resources = new Map<string, Buffer>();
  const rawEvents: TraceEvent[] = [];

  for (const entry of entries) {
    const name = entry.entryName;
    const data = entry.getData();

    if (name.endsWith('.trace') || name.endsWith('.network')) {
      const lines = data.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          rawEvents.push(JSON.parse(line));
        } catch {
          // skip malformed lines — trace files can have partial writes
        }
      }
    } else {
      resources.set(name, data);
    }
  }

  // Sort all events chronologically
  rawEvents.sort((a, b) => (a.time || 0) - (b.time || 0));

  const actions = extractActions(rawEvents);
  const networkCalls = extractNetwork(rawEvents);
  const screenshots = extractScreenshots(rawEvents, resources);
  const pageElementSummary = extractPageElements(resources);

  return { events: rawEvents, resources, actions, networkCalls, screenshots, pageElementSummary };
}

/**
 * Extracts a compact summary of interactive elements (buttons, inputs, links,
 * elements with role/aria-label) from the largest HTML DOM snapshot in the trace.
 * This gives the classifier visibility into what actually exists on the page.
 */
function extractPageElements(resources: Map<string, Buffer>): string | undefined {
  // Find the largest HTML snapshot (most complete page state)
  let bestHtml = '';
  let bestSize = 0;
  for (const [name, buf] of resources) {
    if (name.endsWith('.html') && buf.length > 100 && buf.length > bestSize) {
      bestSize = buf.length;
      bestHtml = buf.toString('utf8');
    }
  }
  if (!bestHtml) return undefined;

  const elements: string[] = [];

  // Buttons: <button ...>text</button>
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = buttonRe.exec(bestHtml)) !== null) {
    const attrs = m[1];
    const text = stripTags(m[2]).trim();
    if (!text && !attrs.includes('aria-label')) continue;
    const label = text || extractAttr(attrs, 'aria-label') || '';
    if (!label || label.includes('{') || label.includes('}')) continue;
    const id = extractAttr(attrs, 'id');
    const role = extractAttr(attrs, 'role');
    let line = `button: "${label}"`;
    if (id) line += ` #${id}`;
    if (role && role !== 'button') line += ` [role=${role}]`;
    elements.push(line);
  }

  // Inputs: <input ...>
  const inputRe = /<input\b([^>]*)>/gi;
  while ((m = inputRe.exec(bestHtml)) !== null) {
    const attrs = m[1];
    if (extractAttr(attrs, 'type') === 'hidden') continue;
    const id = extractAttr(attrs, 'id');
    const name = extractAttr(attrs, 'name');
    const type = extractAttr(attrs, 'type') || 'text';
    const ariaLabel = extractAttr(attrs, 'aria-label');
    const placeholder = extractAttr(attrs, 'placeholder');
    const role = extractAttr(attrs, 'role');
    let line = 'input';
    if (id) line += `#${id}`;
    line += ` [type=${type}]`;
    if (name) line += ` [name="${name}"]`;
    if (ariaLabel) line += ` [aria-label="${ariaLabel}"]`;
    else if (placeholder) line += ` [placeholder="${placeholder}"]`;
    if (role) line += ` [role=${role}]`;
    elements.push(line);
  }

  // Links: <a ...>text</a>
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = linkRe.exec(bestHtml)) !== null) {
    const attrs = m[1];
    const text = stripTags(m[2]).trim().slice(0, 60);
    const href = extractAttr(attrs, 'href');
    if (!text) continue; // skip links with no visible text
    // Skip links whose text looks like JavaScript/CSS noise
    if (text.includes('{') || text.includes('}') || text.includes(';') || text.length > 80) continue;
    let line = `link: "${text}"`;
    if (href && href.length < 100) line += ` → ${href}`;
    elements.push(line);
  }

  // Select elements: <select ...>
  const selectRe = /<select\b([^>]*)>/gi;
  while ((m = selectRe.exec(bestHtml)) !== null) {
    const attrs = m[1];
    const id = extractAttr(attrs, 'id');
    const name = extractAttr(attrs, 'name');
    const ariaLabel = extractAttr(attrs, 'aria-label');
    let line = 'select';
    if (id) line += `#${id}`;
    if (name) line += ` [name="${name}"]`;
    if (ariaLabel) line += ` [aria-label="${ariaLabel}"]`;
    elements.push(line);
  }

  // Textarea elements: <textarea ...>
  const textareaRe = /<textarea\b([^>]*)>/gi;
  while ((m = textareaRe.exec(bestHtml)) !== null) {
    const attrs = m[1];
    const id = extractAttr(attrs, 'id');
    const name = extractAttr(attrs, 'name');
    const ariaLabel = extractAttr(attrs, 'aria-label');
    const placeholder = extractAttr(attrs, 'placeholder');
    let line = 'textarea';
    if (id) line += `#${id}`;
    if (name) line += ` [name="${name}"]`;
    if (ariaLabel) line += ` [aria-label="${ariaLabel}"]`;
    else if (placeholder) line += ` [placeholder="${placeholder}"]`;
    elements.push(line);
  }

  // Deduplicate and cap
  const unique = [...new Set(elements)];
  const MAX_CHARS = 2000;
  const lines: string[] = [];
  let totalLen = 0;
  for (const line of unique) {
    if (totalLen + line.length + 1 > MAX_CHARS) break;
    lines.push(line);
    totalLen += line.length + 1;
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function extractAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}=["']([^"']*)["']`, 'i');
  const m = attrs.match(re);
  return m ? m[1] : undefined;
}
