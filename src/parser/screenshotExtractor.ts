import { TraceEvent } from './traceParser';
import * as crypto from 'crypto';

export interface ScreenshotEntry {
  stepIndex: number;
  actionType?: string;
  buffer: Buffer;
  hash: string;
  width?: number;
  height?: number;
}

export function extractScreenshots(
  events: TraceEvent[],
  resources: Map<string, Buffer>
): ScreenshotEntry[] {
  const screenshots: ScreenshotEntry[] = [];
  let stepIndex = 0;

  for (const e of events) {
    // Playwright stores screenshots as screencast frames or snapshot attachments
    const sha = e.sha1 || e.snapshotName;

    if (!sha) continue;

    const isScreenshot =
      e.type === 'screencast-frame' ||
      e.type === 'snapshot' ||
      (e.type === 'action' && e.metadata?.['screenshot']);

    if (!isScreenshot) continue;

    // Try multiple resource key formats Playwright uses across versions
    // In PW 1.40+, sha1 on screencast-frame is already the full filename
    const buf =
      resources.get(`resources/${sha}`) ||
      resources.get(`screenshots/${sha}`) ||
      resources.get(sha) ||
      // screencast-frame: sha1 = "page@<id>-<timestamp>.jpeg", stored at resources/<sha1>
      resources.get(`resources/${sha}.jpeg`) ||
      resources.get(`resources/${sha}.png`);

    if (!buf) continue;

    screenshots.push({
      stepIndex: stepIndex++,
      actionType: e.type,
      buffer: buf,
      hash: hashBuffer(buf),
    });
  }

  return screenshots;
}

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export function compareScreenshots(
  buf1: Buffer,
  buf2: Buffer,
  threshold = 0.1
): { match: boolean; diffRatio: number } {
  // Minimal PNG comparison using pixelmatch
  try {
    const { PNG } = require('pngjs');
    const pixelmatch = require('pixelmatch');

    const img1 = PNG.sync.read(buf1);
    const img2 = PNG.sync.read(buf2);

    if (img1.width !== img2.width || img1.height !== img2.height) {
      return { match: false, diffRatio: 1.0 };
    }

    const diff = new PNG({ width: img1.width, height: img1.height });
    const mismatch = pixelmatch(
      img1.data, img2.data, diff.data,
      img1.width, img1.height,
      { threshold: 0.1 }
    );

    const totalPixels = img1.width * img1.height;
    const diffRatio = mismatch / totalPixels;

    return { match: diffRatio <= threshold, diffRatio };
  } catch {
    // Fallback: compare hashes only
    const hash1 = hashBuffer(buf1);
    const hash2 = hashBuffer(buf2);
    return { match: hash1 === hash2, diffRatio: hash1 === hash2 ? 0 : 1 };
  }
}
