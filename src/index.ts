#!/usr/bin/env node

import { program } from 'commander';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parseTrace } from './parser/traceParser';
import { buildMemory } from './memory/memoryBuilder';
import { writeMemory, readMemory, findMemoryFile, listMemoryFiles } from './memory/memoryStore';
import { detectRegression } from './regression/detector';
import { printReport, writeJsonReport } from './regression/reporter';

dotenv.config();

program
  .name('pw-memex')
  .description('Playwright Memory Extractor — turn traces into regression intelligence')
  .version('0.1.0');

// ─── learn command ────────────────────────────────────────────────────────────

program
  .command('learn <tracePath>')
  .description('Parse a passing trace and write a .memory.md baseline file')
  .option('--test <title>', 'Test title (shown in the memory file)', 'Unknown test')
  .option('--suite <path>', 'Path to the spec file')
  .option('--base-url <url>', 'Base URL of the app under test', 'http://localhost:3000')
  .option('--output <dir>', 'Output directory for .memory.md files', '.pw-memory')
  .action(async (tracePath: string, opts) => {
    console.log(`pw-memex learn: parsing ${path.basename(tracePath)}...`);

    try {
      const trace = await parseTrace(tracePath);

      console.log(
        `  found ${trace.actions.length} actions, ` +
        `${trace.networkCalls.length} network calls, ` +
        `${trace.screenshots.length} screenshots`
      );

      console.log('  generating AI summary...');
      const memory = await buildMemory(
        opts.test,
        opts.suite || tracePath,
        trace,
        opts.baseUrl,
      );

      const outPath = writeMemory(memory, opts.output);
      console.log(`\n  Memory written: ${outPath}`);
      console.log(`  Selectors captured: ${memory.selectorAnchors.length}`);
      console.log(`  Network baselines:  ${memory.networkCalls.length}`);
    } catch (e: any) {
      console.error(`\n  Error: ${e.message}`);
      process.exit(1);
    }
  });

// ─── compare command ──────────────────────────────────────────────────────────

program
  .command('compare <tracePath> <memoryPath>')
  .description('Compare a failing trace against a memory baseline')
  .option('--error <msg>', 'Error message from the failing test run')
  .option('--json <dir>', 'Write a JSON report to this directory')
  .option('--timing-multiplier <n>', 'Flag timings > baseline * n as regressions', '3')
  .action(async (tracePath: string, memoryPath: string, opts) => {
    console.log('pw-memex compare: analysing failure...');

    try {
      const [newTrace, baseline] = await Promise.all([
        parseTrace(tracePath),
        Promise.resolve(readMemory(memoryPath)),
      ]);

      if (!baseline) {
        console.error(`  Cannot read baseline: ${memoryPath}`);
        process.exit(1);
      }

      const result = await detectRegression(baseline, newTrace, opts.error, {
        networkTimingMultiplier: parseFloat(opts.timingMultiplier || '3'),
      });

      printReport(result, baseline.meta.test);

      if (opts.json) {
        const reportPath = writeJsonReport(result, baseline.meta.test, opts.json);
        console.log(`  JSON report: ${reportPath}`);
      }

      // Exit code signals CI pipelines
      if (result.failureType === 'REAL_REGRESSION') process.exit(1);
      if (result.failureType === 'BROKEN_SELECTOR') process.exit(2);
      if (result.failureType === 'FLAKY_NETWORK') process.exit(3);
      if (result.failureType === 'VISUAL_DRIFT') process.exit(4);

    } catch (e: any) {
      console.error(`\n  Error: ${e.message}`);
      process.exit(1);
    }
  });

// ─── list command ─────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all memory baselines in the output directory')
  .option('--dir <path>', 'Memory directory', '.pw-memory')
  .action((opts) => {
    const files = listMemoryFiles(opts.dir);
    if (files.length === 0) {
      console.log('No memory files found. Run `pw-memex learn` first.');
      return;
    }
    console.log(`\nMemory baselines in ${opts.dir}:\n`);
    for (const file of files) {
      const mem = readMemory(file);
      const date = mem?.meta.baseline
        ? new Date(mem.meta.baseline).toLocaleDateString()
        : '?';
      console.log(`  ${path.basename(file)}`);
      console.log(`    test:     ${mem?.meta.test || '?'}`);
      console.log(`    baseline: ${date}`);
      console.log(`    anchors:  ${mem?.selectorAnchors.length || 0} selectors`);
      console.log('');
    }
  });

program.parse(process.argv);
