# Meta-Agent Supervisor 🔍

> The senior engineer that watches over your coding agents.

A supervision layer that learns codebase patterns and actively watches over coding agents (Claude Code, OpenCode, Cursor, etc.), catching mistakes before they ship.

**Built for Hackanova 5.0** — TCET's National Level Hackathon (Theme: Agentic AI)

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ Rule Engine  │    │  Semantic    │    │   LLM     │  │
│  │             │    │  Engine      │    │  Engine   │  │
│  │ • Security  │    │ • TF-IDF    │    │ • Gemini  │  │
│  │ • Quality   │    │ • Cosine    │    │ • Modal   │  │
│  │ • Patterns  │    │ • Chunking  │    │ • Fallback│  │
│  └──────┬──────┘    └──────┬───────┘    └─────┬─────┘  │
│         │                  │                   │        │
│         └──────────────────┼───────────────────┘        │
│                            │                            │
│                    ┌───────▼───────┐                    │
│                    │  Supervisor   │                    │
│                    │  Orchestrator │                    │
│                    └───────┬───────┘                    │
│                            │                            │
│              ┌─────────────┼─────────────┐              │
│              │             │             │              │
│        ┌─────▼─────┐ ┌────▼────┐ ┌──────▼──────┐      │
│        │  Pattern   │ │  File   │ │   Agent     │      │
│        │  Store     │ │ Watcher │ │   Wrapper   │      │
│        │ (SQLite)   │ │         │ │ (OpenCode)  │      │
│        └───────────┘ └─────────┘ └─────────────┘      │
│                                                         │
│                    Meta-Supervisor                       │
└─────────────────────────────────────────────────────────┘
```

## Three Layers of Intelligence

### 🔴 Layer 1: Rule-Based Engine
Fast regex-based pattern matching for known anti-patterns:
- **Security:** eval(), innerHTML, SQL injection, hardcoded secrets, command injection
- **Quality:** `any` types, empty catch blocks, console.log, TODO/FIXME
- **Conventions:** Import style consistency, file naming, missing type annotations
- **Structure:** Missing error handling in async functions, long files

### 🧠 Layer 2: Semantic Engine (TF-IDF + Cosine Similarity)
Pure TypeScript embeddings — no external dependencies:
- **Code Chunking:** Parses files into functions, classes, imports, types
- **TF-IDF Vectorization:** Builds vocabulary, computes term frequency-inverse document frequency
- **Cosine Similarity Search:** Finds semantically similar code across the codebase
- **Duplication Detection:** Flags code >70% similar to existing functions
- **Pattern Inconsistency:** Detects when similar functions use different error handling, async patterns, etc.

### 💡 Layer 3: LLM Engine (Gemini / Modal)
Natural language reasoning about code architecture:
- Automatic backend detection (Gemini Flash → Modal → template fallback)
- Deep nesting detection, function complexity analysis
- Architectural coupling warnings
- Natural language fix suggestions

## Install

```bash
bun install
```

## Quick Start

```bash
# 1. Learn patterns from your codebase
bun run start learn ./my-project

# 2. Index for semantic search
bun run start index ./my-project

# 3. Analyze a file (all three layers)
bun run start analyze ./my-project/src/auth.ts

# 4. Watch for real-time supervision
bun run start supervise ./my-project

# 5. Run the demo
bun run demo
```

## All Commands

| Command | Description |
|---------|-------------|
| `learn <path>` | Learn patterns from git history + codebase structure |
| `index <path>` | Index codebase for semantic search (chunk + embed) |
| `search <query>` | Semantic code search across indexed chunks |
| `analyze <file>` | Analyze file with rules + semantic checks |
| `smart-analyze <file>` | Full analysis with LLM reasoning |
| `watch <dir>` | Watch directory, analyze changes in real-time |
| `supervise <dir>` | Watch with full TUI interface |
| `serve [port]` | Start REST API (default: 3456) |
| `demo` | Run scripted demonstration |
| `patterns` | List all learned patterns |
| `stats` | Show indexing stats |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check + stats |
| POST | `/analyze` | Analyze code `{ code, filePath }` |
| POST | `/patterns/learn` | Learn patterns `{ repoPath }` |
| GET | `/patterns` | List learned patterns |
| DELETE | `/patterns/:id` | Delete a pattern |
| POST | `/index` | Index codebase `{ repoPath }` |
| POST | `/search` | Semantic search `{ query, limit? }` |
| POST | `/smart-analyze` | LLM analysis `{ code, filePath }` |
| GET | `/stats` | Index statistics |
| POST | `/ml/embeddings` | ML endpoint (for teammates) |
| POST | `/ml/similarity` | ML endpoint (for teammates) |

## Demo Output

```
🎬 Meta-Agent Supervisor Demo

Step 1: Learning codebase patterns...
  ✓ [import_style] ESM imports (import/export)
  ✓ [naming_convention] Files use kebab-case naming
  ✓ [formatting] Uses semicolons

Step 2: Indexing for semantic understanding...
  → Vocabulary built: 847 tokens from 45 chunks
  → Semantic index ready ✅

Step 3: Coding agent creates auth module...
  🤖 Creating src/auth/AuthService.ts...

Step 4: 🚨 Supervisor detects issues!

  🔴 [CRITICAL] Possible hardcoded password detected
  🔴 [CRITICAL] Usage of eval() is a security risk
  🟡 [WARNING] File naming doesn't match kebab-case convention
  🧠 [SEMANTIC] 78% match with existing checkPassword — duplication
  🔵 [INFO] Missing error handling unlike similar functions

Step 5: 💡 Supervisor generates fix prompt for agent
```

## Tech Stack

- **Runtime:** Bun
- **HTTP Framework:** Elysia
- **Database:** bun:sqlite (SQLite)
- **File Watching:** chokidar
- **Git Analysis:** simple-git
- **Embeddings:** Custom TF-IDF (pure TypeScript)
- **TUI:** chalk
- **LLM:** Gemini Flash / Modal API (with template fallback)

## Project Structure

```
meta-supervisor/
├── src/
│   ├── index.ts              # CLI entry point + all commands
│   ├── patterns/
│   │   ├── extractor.ts      # Git history → pattern extraction
│   │   └── store.ts          # SQLite pattern storage
│   ├── embeddings/
│   │   ├── index.ts          # TF-IDF vectorizer
│   │   ├── chunker.ts        # Code → semantic chunks
│   │   └── store.ts          # Chunk storage + similarity search
│   ├── watcher/
│   │   └── index.ts          # Real-time file change watcher
│   ├── supervisor/
│   │   ├── index.ts          # Rule-based code supervisor
│   │   ├── semantic.ts       # Semantic duplication + inconsistency
│   │   └── llm.ts            # LLM-powered analysis
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

## Team

- **Nirvaan** — Architecture, TypeScript/TUI implementation, agent integration
- **Teammates** — ML/AI: pattern models, embeddings, semantic analysis (Python service via API stubs)

## Future: OpenCode Integration

Next step: integrate directly into [OpenCode](https://github.com/anomalyco/opencode) as a native supervision layer:

```
User → OpenCode (forked) → Supervisor intercepts all tool calls
                         → Catches mistakes before file writes
                         → Injects context to steer the agent
                         → TUI shows meta-conversation in real-time
```

## License

MIT
