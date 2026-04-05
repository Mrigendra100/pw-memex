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

  return { events: rawEvents, resources, actions, networkCalls, screenshots };
}
