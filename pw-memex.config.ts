import { MemexConfig } from './src/memory/memorySchema';

const config: MemexConfig = {
  baseUrl: 'http://localhost:3000',
  outputDir: '.pw-memory',
  screenshotDiffThreshold: 0.1,   // 0–1, fraction of pixels allowed to differ
  networkTimingMultiplier: 3,      // flag if response time > baseline * this
  model: 'claude-sonnet-4-5',
};

export default config;
