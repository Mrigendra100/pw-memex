export interface MemexConfig {
  baseUrl: string;
  outputDir: string;
  screenshotDiffThreshold: number;
  networkTimingMultiplier: number;
  model: string;
  /** Re-learn and overwrite the memory file even if a baseline already exists. */
  forceLearn: boolean;
}

export interface TestMemory {
  meta: MemoryMeta;
  routeJourney: string;
  steps: MemoryStep[];
  selectorAnchors: SelectorAnchor[];
  networkCalls: NetworkBaseline[];
  pageStates: PageState[];
  screenshots: ScreenshotRecord[];
  assertions: AssertionRecord[];
  aiSummary: string;
}

export interface MemoryMeta {
  test: string;
  suite: string;
  baseline: string;           // ISO timestamp of first passing run
  baseUrl: string;
  status: 'passed' | 'failed';
  duration?: number;
  playwrightVersion?: string;
}

export interface MemoryStep {
  index: number;
  type: string;
  selector?: string;
  value?: string;
  url?: string;
  duration?: number;
}

export interface SelectorAnchor {
  stepIndex: number;
  stepType: string;
  primary: string;
  fallbacks: string[];
  stability: 'HIGH' | 'MEDIUM' | 'LOW';
  lastSeen: string;           // ISO timestamp — helps detect staleness
}

export interface NetworkBaseline {
  key: string;                // "METHOD /path"
  method: string;
  path: string;
  expectedStatuses: number[];
  timingBaseline: {
    p50: number;              // ms
    p95: number;              // ms
    sampleCount: number;
  };
}

export interface PageState {
  name: string;
  url?: string;
  urlPattern?: string;
  visibleSelectors: string[];
  hiddenSelectors?: string[];
  disabledSelectors?: string[];
  approximateDuration?: number; // how long this state lasts in ms
}

export interface ScreenshotRecord {
  stepIndex: number;
  label: string;
  hash: string;
  timestamp: string;
}

export interface AssertionRecord {
  type: 'url' | 'visible' | 'text' | 'value' | 'count' | 'other';
  selector?: string;
  expected?: string;
  raw: string;
}
