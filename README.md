# Meta-Agent Supervisor

> The senior engineer that watches over your coding agents. 🔍

A supervision layer that learns codebase patterns and actively watches over coding agents (Claude Code, OpenCode, Cursor, etc.), catching mistakes before they ship.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  TUI (Terminal Interface)                       │
│  - Agent activity panel                         │
│  - Supervisor findings + warnings               │
│  - Pattern violations with suggestions          │
│  - Status bar: patterns, files, violations      │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Supervisor Engine                              │
│  - Security anti-pattern detection              │
│  - Code quality checks                          │
│  - Pattern consistency enforcement              │
│  - Structural analysis                          │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Pattern Store (SQLite)                         │
│  - Learned from git history                     │
│  - File naming conventions                      │
│  - Import styles, formatting                    │
│  - Architecture patterns                        │
└─────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Elysia API + ML Service (stub)                 │
│  - REST endpoints for analysis                  │
│  - Pattern learning                             │
│  - ML embedding endpoints (for teammates)       │
└─────────────────────────────────────────────────┘
```

## What It Catches

### 🔴 Critical (Security)
- `eval()` usage
- `innerHTML` assignment (XSS)
- SQL injection patterns
- Command injection
- Hardcoded passwords/API keys

### 🟡 Warning (Quality)
- `any` type usage in TypeScript
- Empty catch blocks
- Missing error handling in async functions
- Import style inconsistencies
- File naming convention violations

### 🔵 Info
- `console.log` left in code
- TODO/FIXME comments
- Long lines (>120 chars)
- Missing type annotations on exports

## Install

```bash
bun install
```

## Usage

```bash
# Learn patterns from a codebase
bun run start learn ./my-project

# Analyze a single file
bun run start analyze ./src/auth.ts

# Watch a directory for changes (real-time)
bun run start watch ./my-project

# Watch with full TUI interface
bun run start supervise ./my-project

# Start the REST API
bun run start serve 3456

# Run the demo
bun run demo

# List learned patterns
bun run start patterns
```

## Demo

Run `bun run demo` to see the supervisor in action:

1. **Learns** codebase patterns (naming, imports, formatting)
2. **Simulates** a coding agent creating an auth module
3. **Detects** security issues, pattern violations, quality problems
4. **Generates** a fix prompt for the coding agent

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/analyze` | Analyze code (`{ code, filePath }`) |
| POST | `/patterns/learn` | Learn patterns from repo (`{ repoPath }`) |
| GET | `/patterns` | List learned patterns |
| DELETE | `/patterns/:id` | Delete a pattern |
| POST | `/ml/embeddings` | ML stub (for teammates) |
| POST | `/ml/similarity` | ML stub (for teammates) |

## Tech Stack

- **Runtime:** Bun
- **HTTP:** Elysia
- **Database:** bun:sqlite
- **File Watching:** chokidar
- **Git Analysis:** simple-git
- **TUI:** chalk

## Project Structure

```
meta-supervisor/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── patterns/
│   │   ├── extractor.ts      # Git history → pattern extraction
│   │   └── store.ts          # SQLite pattern storage
│   ├── watcher/
│   │   └── index.ts          # File change watcher
│   ├── supervisor/
│   │   └── index.ts          # Rule-based code supervisor
│   ├── agent/
│   │   └── wrapper.ts        # Coding agent subprocess wrapper
│   ├── api/
│   │   └── index.ts          # Elysia REST API
│   └── tui/
│       └── App.ts            # Terminal UI
├── package.json
├── tsconfig.json
└── README.md
```

## Hackanova 5.0

Built for the **Hackanova 5.0** hackathon (TCET, Mumbai) — Theme: **Agentic AI**.

> "Existing coding agents are like junior devs with no oversight. We built the senior engineer that watches over them."

## Future: OpenCode Integration

The next step is integrating this directly into [OpenCode](https://github.com/anomalyco/opencode) as a native supervision layer, enabling real-time intervention:

```
User → OpenCode (forked) → Supervisor watches all tool calls
                         → Catches mistakes before file writes
                         → Injects context to steer the agent
```

## License

MIT
