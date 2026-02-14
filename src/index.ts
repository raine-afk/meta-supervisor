#!/usr/bin/env bun

import { PatternStore } from "./patterns/store";
import { PatternExtractor } from "./patterns/extractor";
import { FileWatcher } from "./watcher";
import { Supervisor } from "./supervisor";
import { AgentWrapper } from "./agent/wrapper";
import { createAPI } from "./api";
import { TUI } from "./tui/App";
import { SemanticStore } from "./embeddings/store";
import { SemanticSupervisor } from "./supervisor/semantic";
import { smartAnalyze, isLLMAvailable } from "./supervisor/llm";
import chalk from "chalk";

const HELP = `
${chalk.bold.magenta("Meta-Agent Supervisor")} — Watching over your coding agents

${chalk.bold("Usage:")}
  meta-supervisor learn <repo-path>        Learn patterns from a repository
  meta-supervisor watch <dir>              Watch directory and analyze changes
  meta-supervisor analyze <file>           Analyze a single file
  meta-supervisor supervise <dir>          Watch + supervise with TUI
  meta-supervisor serve [port]             Start the API server
  meta-supervisor demo                     Run a demo showing the supervisor in action
  meta-supervisor patterns                 List all learned patterns

  ${chalk.bold.cyan("── Semantic Search (NEW) ──")}
  meta-supervisor index <repo-path>        Index a codebase (chunk + embed + store)
  meta-supervisor search <query>           Semantic search across indexed code
  meta-supervisor smart-analyze <file>     Enhanced analysis with LLM reasoning

  meta-supervisor help                     Show this help

${chalk.bold("Examples:")}
  meta-supervisor learn ./my-project
  meta-supervisor index ./my-project
  meta-supervisor search "error handling"
  meta-supervisor smart-analyze src/index.ts
  meta-supervisor watch ./my-project
  meta-supervisor supervise ./my-project
  meta-supervisor serve 3456
`;

const command = process.argv[2];
const arg = process.argv[3];

const store = new PatternStore("meta-supervisor.db");
store.init();

const semanticStore = new SemanticStore("meta-supervisor.db");

switch (command) {
  case "learn":
    await learnCommand(arg);
    break;
  case "watch":
    await watchCommand(arg);
    break;
  case "analyze":
    await analyzeCommand(arg);
    break;
  case "supervise":
    await superviseCommand(arg);
    break;
  case "serve":
    await serveCommand(arg);
    break;
  case "demo":
    await demoCommand();
    break;
  case "patterns":
    await patternsCommand();
    break;
  case "index":
    await indexCommand(arg);
    break;
  case "search":
    await searchCommand(process.argv.slice(3).join(" "));
    break;
  case "smart-analyze":
    await smartAnalyzeCommand(arg);
    break;
  case "help":
  case "--help":
  case "-h":
  default:
    console.log(HELP);
    break;
}

// ── Existing commands ──

async function learnCommand(repoPath: string) {
  if (!repoPath) {
    console.log(chalk.red("Error: Please provide a repository path"));
    console.log("Usage: meta-supervisor learn <repo-path>");
    process.exit(1);
  }

  console.log(chalk.blue(`\n🧠 Learning patterns from: ${repoPath}\n`));

  const extractor = new PatternExtractor(repoPath);
  const patterns = await extractor.extractAll(repoPath);

  for (const p of patterns) {
    store.addPattern(p.pattern_type, p.pattern_value, p.confidence, p.examples, repoPath);
  }

  console.log(chalk.green(`✅ Learned ${patterns.length} patterns:\n`));
  for (const p of patterns) {
    const conf = Math.round(p.confidence * 100);
    console.log(`  ${chalk.cyan(`[${p.pattern_type}]`)} ${p.pattern_value} ${chalk.dim(`(${conf}% confidence)`)}`);
  }
  console.log();
}

async function watchCommand(dir: string) {
  if (!dir) {
    console.log(chalk.red("Error: Please provide a directory to watch"));
    process.exit(1);
  }

  const patterns = store.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semanticSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  console.log(chalk.blue(`\n👀 Watching: ${dir}`));
  console.log(chalk.dim(`   Loaded ${patterns.length} patterns\n`));

  const watcher = new FileWatcher(dir);

  watcher.on("changes", (changes) => {
    for (const change of changes) {
      console.log(chalk.yellow(`  📝 ${change.type}: ${change.relativePath}`));
    }

    // Rule-based findings
    const findings = supervisor.analyzeChanges(changes);

    // Semantic findings
    for (const change of changes) {
      if (change.content) {
        const semanticFindings = semanticSupervisor.analyzeFile(
          change.content,
          change.relativePath
        );
        findings.push(...semanticFindings);
      }
    }

    if (findings.length > 0) {
      tui.printReport(findings);
    } else {
      console.log(chalk.green("  ✅ No issues found\n"));
    }
  });

  watcher.start();
  console.log(chalk.dim("Press Ctrl+C to stop\n"));

  process.on("SIGINT", () => {
    watcher.stop();
    console.log(chalk.dim("\n👋 Stopped watching"));
    process.exit(0);
  });

  await new Promise(() => {}); // Keep alive
}

async function analyzeCommand(filePath: string) {
  if (!filePath) {
    console.log(chalk.red("Error: Please provide a file path"));
    process.exit(1);
  }

  const content = await Bun.file(filePath).text();
  const patterns = store.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semanticSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  console.log(chalk.blue(`\n🔍 Analyzing: ${filePath}\n`));

  // Rule-based analysis
  const findings = supervisor.analyzeCode(content, filePath);

  // Semantic analysis
  const semanticFindings = semanticSupervisor.analyzeFile(content, filePath);
  findings.push(...semanticFindings);

  tui.printReport(findings);
}

async function superviseCommand(dir: string) {
  if (!dir) {
    console.log(chalk.red("Error: Please provide a directory to supervise"));
    process.exit(1);
  }

  const patterns = store.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semanticSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  tui.updateStats({ patternsLoaded: patterns.length });
  tui.setWatching(true);

  const watcher = new FileWatcher(dir);

  watcher.on("changes", (changes) => {
    for (const change of changes) {
      tui.addFileChange(change);
      tui.updateStats({ filesWatched: (tui as any).stats.filesWatched + 1 });
    }

    const findings = supervisor.analyzeChanges(changes);

    // Semantic analysis
    for (const change of changes) {
      if (change.content) {
        const semanticFindings = semanticSupervisor.analyzeFile(
          change.content,
          change.relativePath
        );
        findings.push(...semanticFindings);
      }
    }

    if (findings.length > 0) {
      tui.addFindings(findings);
    }

    tui.render();
  });

  watcher.start();
  tui.render();

  process.on("SIGINT", () => {
    watcher.stop();
    console.log(chalk.dim("\n👋 Stopped supervising"));
    process.exit(0);
  });

  await new Promise(() => {}); // Keep alive
}

async function serveCommand(port?: string) {
  const portNum = parseInt(port || "3456");
  const patterns = store.getPatterns();
  const supervisor = new Supervisor(patterns);

  const app = createAPI(store, supervisor, semanticStore);
  app.listen(portNum);

  console.log(chalk.green(`\n🚀 Meta-Supervisor API running on http://localhost:${portNum}\n`));
  console.log(chalk.dim("Endpoints:"));
  console.log(chalk.dim("  GET  /health           — Health check"));
  console.log(chalk.dim("  POST /analyze          — Analyze code"));
  console.log(chalk.dim("  POST /patterns/learn   — Learn from repo"));
  console.log(chalk.dim("  GET  /patterns         — List patterns"));
  console.log(chalk.dim("  POST /index            — Index a codebase (semantic)"));
  console.log(chalk.dim("  POST /search           — Semantic code search"));
  console.log(chalk.dim("  POST /smart-analyze    — LLM-enhanced analysis\n"));
}

async function patternsCommand() {
  const patterns = store.getPatterns();

  if (patterns.length === 0) {
    console.log(chalk.yellow("\n📭 No patterns learned yet."));
    console.log(chalk.dim("Run: meta-supervisor learn <repo-path>\n"));
    return;
  }

  console.log(chalk.blue(`\n📋 Learned Patterns (${patterns.length}):\n`));
  for (const p of patterns) {
    const conf = Math.round(p.confidence * 100);
    console.log(`  ${chalk.cyan(`[${p.pattern_type}]`)} ${p.pattern_value}`);
    console.log(`  ${chalk.dim(`Confidence: ${conf}% | Examples: ${p.examples || "none"}`)}`);
    console.log();
  }
}

// ── New semantic commands ──

async function indexCommand(repoPath: string) {
  if (!repoPath) {
    console.log(chalk.red("Error: Please provide a repository path"));
    console.log("Usage: meta-supervisor index <repo-path>");
    process.exit(1);
  }

  console.log(chalk.blue(`\n📦 Indexing codebase: ${repoPath}\n`));

  const result = await semanticStore.indexCodebase(repoPath, (msg) => {
    console.log(`  ${chalk.dim("→")} ${msg}`);
  });

  console.log(
    chalk.green(
      `\n✅ Indexed ${result.filesIndexed} files → ${result.chunksStored} code chunks\n`
    )
  );

  const stats = semanticStore.getStats();
  console.log(chalk.dim(`  Total chunks in DB: ${stats.totalChunks}`));
  console.log(chalk.dim(`  Total files: ${stats.totalFiles}`));
  console.log(chalk.dim(`  Projects: ${stats.projects.join(", ")}\n`));
}

async function searchCommand(query: string) {
  if (!query || query.trim() === "") {
    console.log(chalk.red("Error: Please provide a search query"));
    console.log('Usage: meta-supervisor search "error handling"');
    process.exit(1);
  }

  console.log(chalk.blue(`\n🔎 Searching for: "${query}"\n`));

  const results = semanticStore.search(query, 10);

  if (results.length === 0) {
    console.log(chalk.yellow("  No matching chunks found."));
    console.log(chalk.dim("  Try indexing a codebase first: meta-supervisor index <path>\n"));
    return;
  }

  console.log(chalk.green(`  Found ${results.length} results:\n`));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sim = (r.similarity * 100).toFixed(1);
    const preview = r.chunk.chunk_content
      .split("\n")
      .slice(0, 4)
      .join("\n    ");

    console.log(
      `  ${chalk.bold.cyan(`#${i + 1}`)} ${chalk.white(r.chunk.file_path)}:${r.chunk.start_line} ${chalk.dim(`[${r.chunk.chunk_type}]`)} ${chalk.yellow(`${sim}% match`)}`
    );
    if (r.chunk.chunk_name) {
      console.log(`    ${chalk.dim("Name:")} ${r.chunk.chunk_name}`);
    }
    console.log(`    ${chalk.dim(preview)}`);
    console.log();
  }
}

async function smartAnalyzeCommand(filePath: string) {
  if (!filePath) {
    console.log(chalk.red("Error: Please provide a file path"));
    console.log("Usage: meta-supervisor smart-analyze <file>");
    process.exit(1);
  }

  const content = await Bun.file(filePath).text();
  const tui = new TUI();

  console.log(chalk.blue(`\n🧠 Smart Analysis: ${filePath}\n`));

  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    console.log(chalk.dim("  Using LLM-enhanced analysis...\n"));
  } else {
    console.log(chalk.dim("  LLM unavailable — using template-based analysis\n"));
  }

  // Get project patterns for context
  const patterns = store.getPatterns();
  const patternContext = patterns
    .map((p) => `[${p.pattern_type}] ${p.pattern_value}`)
    .join("\n");

  const analysis = await smartAnalyze(content, filePath, {
    projectPatterns: patternContext || undefined,
  });

  // Print the analysis
  console.log(chalk.bold.magenta("  ═══ Smart Analysis Report ═══\n"));
  console.log(`  ${chalk.bold("Summary:")} ${analysis.summary}\n`);

  if (analysis.issues.length > 0) {
    console.log(chalk.bold("  Issues:"));
    for (const issue of analysis.issues) {
      const icon =
        issue.severity === "critical"
          ? "🔴"
          : issue.severity === "warning"
            ? "🟡"
            : "🔵";
      const color =
        issue.severity === "critical"
          ? chalk.red
          : issue.severity === "warning"
            ? chalk.yellow
            : chalk.cyan;
      console.log(
        `    ${icon} ${color(`[${issue.severity.toUpperCase()}]`)} ${issue.description}`
      );
      if (issue.location) {
        console.log(`       ${chalk.dim(issue.location)}`);
      }
      if (issue.fix) {
        console.log(`       ${chalk.green(`💡 ${issue.fix}`)}`);
      }
    }
    console.log();
  }

  if (analysis.suggestions.length > 0) {
    console.log(chalk.bold("  Suggestions:"));
    for (const s of analysis.suggestions) {
      console.log(`    💡 ${s}`);
    }
    console.log();
  }

  if (analysis.architecturalNotes.length > 0) {
    console.log(chalk.bold("  Architecture Notes:"));
    for (const n of analysis.architecturalNotes) {
      console.log(`    🏛️  ${n}`);
    }
    console.log();
  }

  // Also run semantic analysis if indexed
  const stats = semanticStore.getStats();
  if (stats.totalChunks > 0) {
    const semanticSupervisor = new SemanticSupervisor(semanticStore);
    const semanticFindings = semanticSupervisor.analyzeFile(content, filePath);
    if (semanticFindings.length > 0) {
      console.log(chalk.bold.cyan("  ── Semantic Findings ──\n"));
      tui.printReport(semanticFindings);
    }
  }

  // Also run rule-based analysis
  const supervisor = new Supervisor(patterns);
  const ruleFindings = supervisor.analyzeCode(content, filePath);
  if (ruleFindings.length > 0) {
    console.log(chalk.bold.cyan("  ── Rule-Based Findings ──\n"));
    tui.printReport(ruleFindings);
  }
}

async function demoCommand() {
  const tui = new TUI();
  const supervisor = new Supervisor();

  console.log(chalk.bold.magenta("\n  🎬 Meta-Agent Supervisor Demo\n"));
  console.log(chalk.dim("  Simulating a coding agent making changes...\n"));

  await sleep(1000);

  // Step 1: Learn patterns
  console.log(chalk.blue("  Step 1: Learning codebase patterns...\n"));
  await sleep(500);

  const mockPatterns = [
    { pattern_type: "import_style", pattern_value: "ESM imports (import/export)", confidence: 0.9, examples: "import x from 'y'" },
    { pattern_type: "naming_convention", pattern_value: "Files use kebab-case naming", confidence: 0.85, examples: "user-service, auth-handler" },
    { pattern_type: "formatting", pattern_value: "Uses semicolons", confidence: 0.8, examples: "const x = 1;" },
  ];

  for (const p of mockPatterns) {
    console.log(`    ${chalk.green("✓")} ${chalk.cyan(`[${p.pattern_type}]`)} ${p.pattern_value}`);
    await sleep(300);
  }

  console.log(chalk.green(`\n    Learned ${mockPatterns.length} patterns\n`));
  await sleep(1000);

  // Step 2: Index codebase for semantic search
  console.log(chalk.blue("  Step 2: Indexing codebase for semantic understanding...\n"));
  await sleep(500);

  console.log(`    ${chalk.green("✓")} Chunked source files into semantic units`);
  await sleep(300);
  console.log(`    ${chalk.green("✓")} Generated TF-IDF embeddings for each chunk`);
  await sleep(300);
  console.log(`    ${chalk.green("✓")} Stored vectors in SQLite for similarity search`);
  await sleep(300);

  const stats = semanticStore.getStats();
  console.log(
    chalk.green(`\n    Indexed: ${stats.totalChunks} chunks from ${stats.totalFiles} files\n`)
  );
  await sleep(1000);

  // Step 3: Agent starts coding
  console.log(chalk.blue("  Step 3: Coding agent starts working on auth module...\n"));
  await sleep(500);

  const agentActions = [
    "Creating src/auth/AuthService.ts...",
    "Writing authentication logic...",
    "Adding password validation...",
    "Creating database queries...",
  ];

  for (const action of agentActions) {
    console.log(`    ${chalk.dim("🤖")} ${action}`);
    await sleep(400);
  }

  await sleep(500);

  // Step 4: Supervisor catches issues
  console.log(chalk.bold.red("\n  Step 4: 🚨 Supervisor detects issues!\n"));
  await sleep(500);

  const badCode = `
const password = "admin123";
const query = \`SELECT * FROM users WHERE id = \${userId}\`;
const result: any = eval(userInput);
const AuthService = require('./auth');
  `;

  const findings = supervisor.analyzeCode(badCode, "src/auth/AuthService.ts");

  // Add naming convention violation manually for demo
  findings.push({
    severity: "warning",
    rule: "naming-convention",
    message: 'File "AuthService" doesn\'t match project\'s kebab-case convention',
    file: "src/auth/AuthService.ts",
    suggestion: "Rename to: auth-service.ts",
  });

  findings.push({
    severity: "warning",
    rule: "import-consistency",
    message: "File uses require() but project convention is ESM imports",
    file: "src/auth/AuthService.ts",
    suggestion: 'Convert to ESM: import AuthService from "./auth"',
  });

  // Add semantic findings for demo
  findings.push({
    severity: "warning",
    rule: "semantic-duplication",
    message: 'Function "validatePassword" is 78% similar to "checkCredentials" in auth-utils.ts',
    file: "src/auth/AuthService.ts",
    suggestion: "Possible code duplication — consider extracting shared logic into a helper",
  });

  findings.push({
    severity: "info",
    rule: "semantic-inconsistency",
    message: 'This function lacks error handling, but similar functions in the codebase use try/catch',
    file: "src/auth/AuthService.ts",
    suggestion: "Align error handling patterns with similar code in src/auth/auth-utils.ts",
  });

  tui.printReport(findings);

  await sleep(1000);

  // Step 5: Semantic search demo
  console.log(chalk.bold.blue("\n  Step 5: 🔎 Semantic search capabilities\n"));
  await sleep(500);

  console.log(chalk.dim('  Query: "error handling pattern"'));
  console.log();

  const searchResults = semanticStore.search("error handling try catch", 3);
  if (searchResults.length > 0) {
    for (let i = 0; i < Math.min(3, searchResults.length); i++) {
      const r = searchResults[i];
      const sim = (r.similarity * 100).toFixed(0);
      console.log(
        `    ${chalk.cyan(`#${i + 1}`)} ${chalk.white(r.chunk.file_path)}:${r.chunk.start_line} ${chalk.dim(`[${r.chunk.chunk_type}]`)} ${chalk.yellow(`${sim}%`)}`
      );
      if (r.chunk.chunk_name) {
        console.log(`       ${chalk.dim(r.chunk.chunk_name)}`);
      }
    }
  } else {
    console.log(chalk.dim("    (Index the codebase first with `meta-supervisor index .` to see real results)"));
  }

  await sleep(500);

  // Step 6: Fix prompt
  console.log(chalk.bold.green("\n  Step 6: 💡 Supervisor generates fix prompt for the agent:\n"));
  await sleep(500);

  const fixPrompt = `
  ${chalk.white.bgBlue(" SUPERVISOR → AGENT ")}

  ${chalk.white("Please fix the following issues in src/auth/AuthService.ts:")}

  ${chalk.red("1.")} Remove hardcoded password — use environment variables
  ${chalk.red("2.")} Fix SQL injection — use parameterized queries
  ${chalk.red("3.")} Remove eval() — use a safe parser instead
  ${chalk.yellow("4.")} Rename file to auth-service.ts (project uses kebab-case)
  ${chalk.yellow("5.")} Convert require() to ESM import
  ${chalk.cyan("6.")} Deduplicate: merge with checkCredentials() in auth-utils.ts
  ${chalk.cyan("7.")} Add try/catch — align with codebase error handling patterns
  `;

  console.log(fixPrompt);
  await sleep(500);

  console.log(chalk.bold.magenta("\n  ═══ Demo Complete ═══\n"));
  console.log(chalk.dim("  The Meta-Agent Supervisor now catches security issues, pattern violations,"));
  console.log(chalk.dim("  semantic duplications, and code quality problems using:"));
  console.log(chalk.dim("    • Rule-based pattern matching (regex)"));
  console.log(chalk.dim("    • Semantic code search (TF-IDF embeddings + cosine similarity)"));
  console.log(chalk.dim("    • LLM-powered analysis (Gemini Flash when available)\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
