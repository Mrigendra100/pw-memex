pw-memex/
├── src/
│   ├── index.ts               ← CLI entry point
│   ├── runner/
│   │   └── traceRunner.ts     ← runs playwright with tracing forced on
│   ├── parser/
│   │   ├── traceParser.ts     ← unzips + reads trace.zip
│   │   ├── actionExtractor.ts ← pulls clicks, fills, navigates
│   │   ├── networkExtractor.ts← pulls API calls + responses
│   │   └── screenshotExtractor.ts ← extracts screenshots per step
│   ├── memory/
│   │   ├── memoryBuilder.ts   ← Claude turns parsed data → memory
│   │   ├── memoryStore.ts     ← read/write .memory.md files
│   │   └── memorySchema.ts    ← TypeScript types for memory
│   ├── regression/
│   │   ├── detector.ts        ← diffs new trace vs memory
│   │   ├── classifier.ts      ← Claude classifies the failure type
│   │   └── reporter.ts        ← writes human-readable report
│   └── claude/
│       └── client.ts          ← Anthropic API wrapper
├── package.json
├── tsconfig.json
└── pw-memex.config.ts         ← user config

