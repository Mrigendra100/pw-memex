import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import {
  TestMemory, SelectorAnchor, NetworkBaseline,
  ScreenshotRecord
} from './memorySchema';

export function writeMemory(memory: TestMemory, outputDir: string, specPath?: string): string {
  let filePath: string;

  if (specPath) {
    const specSlug = extractSpecSlug(specPath);
    const testSlug = slugify(memory.meta.test);
    const dir = path.join(outputDir, specSlug);
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${testSlug}.md`);
  } else {
    fs.mkdirSync(outputDir, { recursive: true });
    const slug = slugify(memory.meta.test);
    filePath = path.join(outputDir, `${slug}.memory.md`);
  }

  fs.writeFileSync(filePath, serializeToMarkdown(memory), 'utf8');
  return filePath;
}

export function readMemory(filePath: string): TestMemory | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(raw);
    return parseFromMarkdown(data, content);
  } catch (e) {
    console.error(`Failed to parse memory file: ${filePath}`, e);
    return null;
  }
}

export function findMemoryFile(testTitle: string, memoryDir: string, specPath?: string): string | null {
  if (!fs.existsSync(memoryDir)) return null;

  // 1. Hierarchical path (new structure)
  if (specPath) {
    const specSlug = extractSpecSlug(specPath);
    const testSlug = slugify(testTitle);
    const nested = path.join(memoryDir, specSlug, `${testSlug}.md`);
    if (fs.existsSync(nested)) return nested;
  }

  // 2. Flat path (legacy structure — migration grace period)
  const slug = slugify(testTitle);
  const flat = path.join(memoryDir, `${slug}.memory.md`);
  if (fs.existsSync(flat)) return flat;

  // 3. Recursive scan matching meta.test field
  for (const file of walkMemoryFiles(memoryDir)) {
    const mem = readMemory(file);
    if (mem?.meta.test === testTitle) return file;
  }

  return null;
}

export function listMemoryFiles(memoryDir: string): string[] {
  if (!fs.existsSync(memoryDir)) return [];
  return walkMemoryFiles(memoryDir);
}

function walkMemoryFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMemoryFiles(fullPath));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.memory.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Serialisation ────────────────────────────────────────────────────────────

function serializeToMarkdown(mem: TestMemory): string {
  // js-yaml (used by gray-matter) cannot serialize undefined values — omit them
  const frontmatter: Record<string, any> = {
    test: mem.meta.test,
    suite: mem.meta.suite,
    baseline: mem.meta.baseline,
    baseUrl: mem.meta.baseUrl,
    status: mem.meta.status,
  };
  if (mem.meta.duration !== undefined) frontmatter.duration = mem.meta.duration;

  const sections: string[] = [];

  sections.push(`## Route journey\n${mem.routeJourney}`);

  sections.push(
    `## Steps\n` +
    mem.steps.map((s, i) =>
      `${i + 1}. **${s.type}**` +
      (s.selector ? `\n   selector: \`${s.selector}\`` : '') +
      (s.url ? `\n   url: ${s.url}` : '') +
      (s.value ? `\n   value: \`${s.value}\`` : '') +
      (s.duration ? `\n   duration: ${s.duration}ms` : '')
    ).join('\n')
  );

  sections.push(
    `## Selector anchors\n` +
    mem.selectorAnchors.map(a =>
      `### Step ${a.stepIndex} — ${a.stepType} (${a.stability} stability)\n` +
      `- primary:   \`${a.primary}\`\n` +
      a.fallbacks.map((f, i) => `- fallback${i + 1}: \`${f}\``).join('\n')
    ).join('\n\n')
  );

  sections.push(
    `## Network calls\n` +
    mem.networkCalls.map(n =>
      `### ${n.key}\n` +
      `- expected status: ${n.expectedStatuses.join(', ')}\n` +
      `- timing p50: ${n.timingBaseline.p50}ms\n` +
      `- timing p95: ${n.timingBaseline.p95}ms\n` +
      `- samples: ${n.timingBaseline.sampleCount}`
    ).join('\n\n')
  );

  if (mem.assertions.length > 0) {
    sections.push(
      `## Assertions\n` +
      mem.assertions.map(a =>
        `- [${a.type}] ${a.selector ? `\`${a.selector}\`` : ''} ${a.expected ? `→ ${a.expected}` : ''}`
      ).join('\n')
    );
  }

  if (mem.screenshots.length > 0) {
    sections.push(
      `## Screenshots\n` +
      mem.screenshots.map(s =>
        `- step-${s.stepIndex} (${s.label}): \`${s.hash}\``
      ).join('\n')
    );
  }

  sections.push(`## AI summary\n${mem.aiSummary}`);

  return matter.stringify(sections.join('\n\n'), frontmatter);
}

function parseFromMarkdown(frontmatter: any, _content: string): TestMemory {
  // Full markdown parsing in v0.2 — for now, reconstruct from frontmatter
  // The content sections are human-readable; structured data is in frontmatter + YAML blocks
  return {
    meta: {
      test: frontmatter.test || '',
      suite: frontmatter.suite || '',
      baseline: frontmatter.baseline || '',
      baseUrl: frontmatter.baseUrl || '',
      status: frontmatter.status || 'passed',
      duration: frontmatter.duration,
    },
    routeJourney: extractSection(_content, 'Route journey'),
    steps: [],          // TODO: parse steps section
    selectorAnchors: parseSelectorAnchors(_content),
    networkCalls: parseNetworkBaselines(_content),
    pageStates: [],
    screenshots: parseScreenshots(_content),
    assertions: [],
    aiSummary: extractSection(_content, 'AI summary'),
  };
}

function extractSection(content: string, heading: string): string {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

function parseSelectorAnchors(content: string): SelectorAnchor[] {
  const anchors: SelectorAnchor[] = [];
  const section = extractSection(content, 'Selector anchors');
  const blocks = section.split(/### /).filter(Boolean);

  for (const block of blocks) {
    const stepMatch = block.match(/Step (\d+) — (\w+) \((\w+) stability\)/);
    if (!stepMatch) continue;

    const lines = block.split('\n').filter(l => l.includes('`'));
    const selectors = lines.map(l => {
      const m = l.match(/`(.+?)`/);
      return m ? m[1] : '';
    }).filter(Boolean);

    anchors.push({
      stepIndex: parseInt(stepMatch[1]),
      stepType: stepMatch[2],
      primary: selectors[0] || '',
      fallbacks: selectors.slice(1),
      stability: stepMatch[3] as 'HIGH' | 'MEDIUM' | 'LOW',
      lastSeen: new Date().toISOString(),
    });
  }

  return anchors;
}

function parseNetworkBaselines(content: string): NetworkBaseline[] {
  const baselines: NetworkBaseline[] = [];
  const section = extractSection(content, 'Network calls');
  const blocks = section.split(/### /).filter(Boolean);

  for (const block of blocks) {
    const key = block.split('\n')[0].trim();
    if (!key) continue;

    const [method, ...pathParts] = key.split(' ');
    const networkPath = pathParts.join(' ');

    const statusMatch = block.match(/expected status: (.+)/);
    const p50Match = block.match(/timing p50: (\d+)ms/);
    const p95Match = block.match(/timing p95: (\d+)ms/);
    const samplesMatch = block.match(/samples: (\d+)/);

    baselines.push({
      key,
      method: method || 'GET',
      path: networkPath || '/',
      expectedStatuses: statusMatch
        ? statusMatch[1].split(',').map(s => parseInt(s.trim())).filter(Boolean)
        : [200],
      timingBaseline: {
        p50: p50Match ? parseInt(p50Match[1]) : 0,
        p95: p95Match ? parseInt(p95Match[1]) : 0,
        sampleCount: samplesMatch ? parseInt(samplesMatch[1]) : 1,
      },
    });
  }

  return baselines;
}

function parseScreenshots(content: string): ScreenshotRecord[] {
  const records: ScreenshotRecord[] = [];
  const section = extractSection(content, 'Screenshots');

  for (const line of section.split('\n').filter(Boolean)) {
    const match = line.match(/step-(\d+) \((.+?)\): `(.+?)`/);
    if (match) {
      records.push({
        stepIndex: parseInt(match[1]),
        label: match[2],
        hash: match[3],
        timestamp: new Date().toISOString(),
      });
    }
  }

  return records;
}

function extractSpecSlug(specPath: string): string {
  const base = path.basename(specPath).replace(/\.spec\.(ts|js|mts|mjs|cts|cjs)$/, '');
  return slugify(base);
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
