#!/usr/bin/env bun

import { PatternStore } from "./patterns/store";
import { PatternExtractor } from "./patterns/extractor";
import { FileWatcher } from "./watcher";
import { Supervisor } from "./supervisor";
import { SemanticSupervisor } from "./supervisor/semantic";
import { SemanticStore } from "./embeddings/store";
import { AgentWrapper } from "./agent/wrapper";
import { createAPI } from "./api";
import { TUI } from "./tui/App";
import chalk from "chalk";

const HELP = `
${chalk.bold.magenta("Meta-Agent Supervisor")} — Watching over your coding agents

${chalk.bold("Usage:")}
  meta-supervisor learn <repo-path>        Learn patterns from a repository
  meta-supervisor index <repo-path>        Index codebase for semantic search
  meta-supervisor search <query>           Semantic code search
  meta-supervisor watch <dir>              Watch directory and analyze changes
  meta-supervisor analyze <file>           Analyze a single file (rules + semantic)
  meta-supervisor supervise <dir>          Watch + supervise with TUI
  meta-supervisor serve [port]             Start the API server
  meta-supervisor demo                     Run a demo showing the supervisor
  meta-supervisor patterns                 List all learned patterns
  meta-supervisor stats                    Show indexing stats
  meta-supervisor help                     Show this help

${chalk.bold("Examples:")}
  meta-supervisor learn ./my-project
  meta-supervisor index ./my-project
  meta-supervisor search "error handling"
  meta-supervisor analyze src/auth.ts
  meta-supervisor supervise ./my-project
  meta-supervisor serve 3456
`;

const command = process.argv[2];
const arg = process.argv.slice(3).join(" ");

const patternStore = new PatternStore("meta-supervisor.db");
patternStore.init();
const semanticStore = new SemanticStore("meta-supervisor.db");

switch (command) {
  case "learn":
    await learnCommand(arg);
    break;
  case "index":
    await indexCommand(arg);
    break;
  case "search":
    await searchCommand(arg);
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
  case "stats":
    await statsCommand();
    break;
  case "help":
  case "--help":
  case "-h":
  default:
    console.log(HELP);
    break;
}

// ── Commands ────────────────────────────────────────────────

async function learnCommand(repoPath: string) {
  if (!repoPath) {
    console.log(chalk.red("Error: Please provide a repository path"));
    process.exit(1);
  }

  console.log(chalk.blue(`\n🧠 Learning patterns from: ${repoPath}\n`));

  const extractor = new PatternExtractor(repoPath);
  const patterns = await extractor.extractAll(repoPath);

  for (const p of patterns) {
    patternStore.addPattern(p.pattern_type, p.pattern_value, p.confidence, p.examples, repoPath);
  }

  console.log(chalk.green(`✅ Learned ${patterns.length} patterns:\n`));
  for (const p of patterns) {
    const conf = Math.round(p.confidence * 100);
    console.log(`  ${chalk.cyan(`[${p.pattern_type}]`)} ${p.pattern_value} ${chalk.dim(`(${conf}% confidence)`)}`);
  }
  console.log();
}

async function indexCommand(repoPath: string) {
  if (!repoPath) {
    console.log(chalk.red("Error: Please provide a repository path"));
    process.exit(1);
  }

  console.log(chalk.blue(`\n📦 Indexing codebase: ${repoPath}\n`));

  const result = await semanticStore.indexCodebase(repoPath, (msg) => {
    console.log(`  ${chalk.dim("→")} ${msg}`);
  });

  console.log(chalk.green(`\n✅ Indexed ${result.filesIndexed} files → ${result.chunksStored} code chunks`));

  const stats = semanticStore.getStats();
  console.log(chalk.dim(`   Vocabulary: ${semanticStore.getVectorizer().vocabSize} tokens`));
  console.log(chalk.dim(`   Total chunks in store: ${stats.totalChunks}\n`));
}

async function searchCommand(query: string) {
  if (!query) {
    console.log(chalk.red("Error: Please provide a search query"));
    process.exit(1);
  }

  console.log(chalk.blue(`\n🔎 Searching for: "${query}"\n`));

  const results = semanticStore.search(query, 10);

  if (results.length === 0) {
    console.log(chalk.yellow("  No results found. Have you indexed a codebase?"));
    console.log(chalk.dim("  Run: meta-supervisor index <repo-path>\n"));
    return;
  }

  for (const r of results) {
    const sim = (r.similarity * 100).toFixed(1);
    const typeColor = r.chunk.chunk_type === "function" ? chalk.green : r.chunk.chunk_type === "class" ? chalk.magenta : chalk.cyan;

    console.log(`  ${chalk.yellow(`${sim}%`)} ${typeColor(`[${r.chunk.chunk_type}]`)} ${chalk.white(r.chunk.chunk_name || "(anonymous)")} ${chalk.dim(`— ${r.chunk.file_path}:${r.chunk.start_line}`)}`);

    // Show first 2 lines of content
    const preview = r.chunk.chunk_content.split("\n").slice(0, 2).join("\n");
    console.log(chalk.dim(`       ${preview.replace(/\n/g, "\n       ")}`));
    console.log();
  }
}

async function watchCommand(dir: string) {
  if (!dir) {
    console.log(chalk.red("Error: Please provide a directory to watch"));
    process.exit(1);
  }

  const patterns = patternStore.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  console.log(chalk.blue(`\n👀 Watching: ${dir}`));
  console.log(chalk.dim(`   Loaded ${patterns.length} patterns | ${semanticStore.getStats().totalChunks} indexed chunks\n`));

  const watcher = new FileWatcher(dir);

  watcher.on("changes", (changes) => {
    for (const change of changes) {
      console.log(chalk.yellow(`  📝 ${change.type}: ${change.relativePath}`));
    }

    // Rule-based findings
    const ruleFindings = supervisor.analyzeChanges(changes);

    // Semantic findings
    const semFindings = changes
      .filter((c) => c.content)
      .flatMap((c) => semSupervisor.analyzeFile(c.content!, c.relativePath));

    const allFindings = [...ruleFindings, ...semFindings];

    if (allFindings.length > 0) {
      tui.printReport(allFindings);
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

  await new Promise(() => {});
}

async function analyzeCommand(filePath: string) {
  if (!filePath) {
    console.log(chalk.red("Error: Please provide a file path"));
    process.exit(1);
  }

  const content = await Bun.file(filePath).text();
  const patterns = patternStore.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  console.log(chalk.blue(`\n🔍 Analyzing: ${filePath}\n`));

  // Rule-based analysis
  const ruleFindings = supervisor.analyzeCode(content, filePath);

  // Semantic analysis
  const semFindings = semSupervisor.analyzeFile(content, filePath);

  const allFindings = [...ruleFindings, ...semFindings];

  if (semFindings.length > 0) {
    console.log(chalk.dim(`  📊 Rule-based: ${ruleFindings.length} findings | Semantic: ${semFindings.length} findings\n`));
  }

  tui.printReport(allFindings);
}

async function superviseCommand(dir: string) {
  if (!dir) {
    console.log(chalk.red("Error: Please provide a directory to supervise"));
    process.exit(1);
  }

  const patterns = patternStore.getPatterns();
  const supervisor = new Supervisor(patterns);
  const semSupervisor = new SemanticSupervisor(semanticStore);
  const tui = new TUI();

  tui.updateStats({ patternsLoaded: patterns.length });
  tui.setWatching(true);

  const watcher = new FileWatcher(dir);

  watcher.on("changes", (changes) => {
    for (const change of changes) {
      tui.addFileChange(change);
      tui.updateStats({ filesWatched: (tui as any).stats.filesWatched + 1 });
    }

    const ruleFindings = supervisor.analyzeChanges(changes);
    const semFindings = changes
      .filter((c) => c.content)
      .flatMap((c) => semSupervisor.analyzeFile(c.content!, c.relativePath));

    const allFindings = [...ruleFindings, ...semFindings];
    if (allFindings.length > 0) {
      tui.addFindings(allFindings);
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

  await new Promise(() => {});
}

async function serveCommand(port?: string) {
  const portNum = parseInt(port || "3456");
  const patterns = patternStore.getPatterns();
  const supervisor = new Supervisor(patterns);

  const app = createAPI(patternStore, supervisor, semanticStore);
  app.listen(portNum);

  console.log(chalk.green(`\n🚀 Meta-Supervisor API running on http://localhost:${portNum}\n`));
  console.log(chalk.dim("Endpoints:"));
  console.log(chalk.dim("  GET  /health             — Health check"));
  console.log(chalk.dim("  POST /analyze            — Analyze code (rules)"));
  console.log(chalk.dim("  POST /patterns/learn      — Learn from repo"));
  console.log(chalk.dim("  GET  /patterns            — List patterns"));
  console.log(chalk.dim("  POST /index               — Index codebase"));
  console.log(chalk.dim("  POST /search              — Semantic search"));
  console.log(chalk.dim("  GET  /stats               — Index stats"));
  console.log(chalk.dim("  POST /ml/embeddings       — ML stub"));
  console.log(chalk.dim("  POST /ml/similarity       — ML stub\n"));
}

async function patternsCommand() {
  const patterns = patternStore.getPatterns();

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

async function statsCommand() {
  const stats = semanticStore.getStats();
  const patterns = patternStore.getPatterns();

  console.log(chalk.blue("\n📊 Meta-Supervisor Stats\n"));
  console.log(`  ${chalk.cyan("Patterns learned:")} ${patterns.length}`);
  console.log(`  ${chalk.cyan("Code chunks indexed:")} ${stats.totalChunks}`);
  console.log(`  ${chalk.cyan("Files indexed:")} ${stats.totalFiles}`);
  console.log(`  ${chalk.cyan("Vocabulary size:")} ${semanticStore.getVectorizer().vocabSize} tokens`);
  console.log(`  ${chalk.cyan("Projects:")} ${stats.projects.length > 0 ? stats.projects.join(", ") : "none"}`);
  console.log();
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
  await sleep(800);

  // Step 1.5: Index codebase
  console.log(chalk.blue("  Step 1.5: Indexing codebase for semantic understanding...\n"));
  await sleep(500);

  console.log(`    ${chalk.green("→")} Found 12 code files`);
  await sleep(200);
  console.log(`    ${chalk.green("→")} Vocabulary built: 847 tokens from 45 chunks`);
  await sleep(200);
  console.log(`    ${chalk.green("→")} Indexed 12 files → 45 code chunks`);
  await sleep(200);
  console.log(`    ${chalk.green("→")} TF-IDF vectors computed and stored`);
  console.log(chalk.green(`\n    Semantic index ready ✅\n`));
  await sleep(800);

  // Step 2: Agent starts coding
  console.log(chalk.blue("  Step 2: Coding agent starts working on auth module...\n"));
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

  // Step 3: Supervisor catches rule-based issues
  console.log(chalk.bold.red("\n  Step 3: 🚨 Rule-Based Supervisor detects issues!\n"));
  await sleep(500);

  const badCode = `
const password = "admin123";
const query = \`SELECT * FROM users WHERE id = \${userId}\`;
const result: any = eval(userInput);
const AuthService = require('./auth');
  `;

  const findings = supervisor.analyzeCode(badCode, "src/auth/AuthService.ts");

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

  tui.printReport(findings);

  await sleep(800);

  // Step 3.5: Semantic analysis
  console.log(chalk.bold.yellow("\n  Step 3.5: 🧠 Semantic Supervisor analysis\n"));
  await sleep(500);

  console.log(`  🟡 ${chalk.yellow("[WARNING]")} ${chalk.white('This function "validatePassword" is very similar to existing code (78% match)')}`);
  console.log(`     ${chalk.dim('src/auth/AuthService.ts:15')} ${chalk.dim('(semantic-duplication)')}`);
  console.log(`     ${chalk.green('💡 Possible duplication of function "checkPassword" in src/utils/validators.ts:42. Consider extracting shared logic.')}`);
  console.log();
  await sleep(300);

  console.log(`  🔵 ${chalk.cyan("[INFO]")} ${chalk.white('This function uses sync pattern, but similar code in src/services/user-service.ts uses async')}`);
  console.log(`     ${chalk.dim('src/auth/AuthService.ts:28')} ${chalk.dim('(semantic-inconsistency)')}`);
  console.log(`     ${chalk.green('💡 Consider aligning async/sync patterns with similar code')}`);
  console.log();
  await sleep(500);

  // Step 4: Supervisor generates fix prompt
  console.log(chalk.bold.green("\n  Step 4: 💡 Supervisor generates fix prompt for the agent:\n"));
  await sleep(500);

  const fixPrompt = `
  ${chalk.white.bgBlue(" SUPERVISOR → AGENT ")}

  ${chalk.white("Please fix the following issues in src/auth/AuthService.ts:")}

  ${chalk.red("🔴 Security:")}
  ${chalk.red("1.")} Remove hardcoded password — use environment variables
  ${chalk.red("2.")} Fix SQL injection — use parameterized queries
  ${chalk.red("3.")} Remove eval() — use a safe parser instead

  ${chalk.yellow("🟡 Conventions:")}
  ${chalk.yellow("4.")} Rename file to auth-service.ts (project uses kebab-case)
  ${chalk.yellow("5.")} Convert require() to ESM import

  ${chalk.cyan("🧠 Semantic:")}
  ${chalk.cyan("6.")} Merge validatePassword with existing checkPassword in validators.ts
  ${chalk.cyan("7.")} Use async pattern to match user-service.ts conventions
  `;

  console.log(fixPrompt);
  await sleep(500);

  console.log(chalk.bold.magenta("\n  ═══ Demo Complete ═══\n"));
  console.log(chalk.dim("  The Meta-Agent Supervisor combines rule-based security checks with"));
  console.log(chalk.dim("  semantic code understanding (TF-IDF embeddings + cosine similarity)"));
  console.log(chalk.dim("  to catch issues coding agents miss.\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
