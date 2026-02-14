#!/usr/bin/env bun

import { PatternStore } from "./patterns/store";
import { PatternExtractor } from "./patterns/extractor";
import { FileWatcher } from "./watcher";
import { Supervisor } from "./supervisor";
import { AgentWrapper } from "./agent/wrapper";
import { createAPI } from "./api";
import { TUI } from "./tui/App";
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
  meta-supervisor help                     Show this help

${chalk.bold("Examples:")}
  meta-supervisor learn ./my-project
  meta-supervisor watch ./my-project
  meta-supervisor supervise ./my-project
  meta-supervisor serve 3456
`;

const command = process.argv[2];
const arg = process.argv[3];

const store = new PatternStore("meta-supervisor.db");
store.init();

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
  case "help":
  case "--help":
  case "-h":
  default:
    console.log(HELP);
    break;
}

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
  const tui = new TUI();

  console.log(chalk.blue(`\n👀 Watching: ${dir}`));
  console.log(chalk.dim(`   Loaded ${patterns.length} patterns\n`));

  const watcher = new FileWatcher(dir);

  watcher.on("changes", (changes) => {
    for (const change of changes) {
      console.log(chalk.yellow(`  📝 ${change.type}: ${change.relativePath}`));
    }

    const findings = supervisor.analyzeChanges(changes);
    if (findings.length > 0) {
      tui.printReport(findings);
    } else {
      console.log(chalk.green("  ✅ No issues found\n"));
    }
  });

  watcher.start();
  console.log(chalk.dim("Press Ctrl+C to stop\n"));

  // Keep alive
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
  const tui = new TUI();

  console.log(chalk.blue(`\n🔍 Analyzing: ${filePath}\n`));
  const findings = supervisor.analyzeCode(content, filePath);
  tui.printReport(findings);
}

async function superviseCommand(dir: string) {
  if (!dir) {
    console.log(chalk.red("Error: Please provide a directory to supervise"));
    process.exit(1);
  }

  const patterns = store.getPatterns();
  const supervisor = new Supervisor(patterns);
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

  const app = createAPI(store, supervisor);
  app.listen(portNum);

  console.log(chalk.green(`\n🚀 Meta-Supervisor API running on http://localhost:${portNum}\n`));
  console.log(chalk.dim("Endpoints:"));
  console.log(chalk.dim("  GET  /health           — Health check"));
  console.log(chalk.dim("  POST /analyze          — Analyze code"));
  console.log(chalk.dim("  POST /patterns/learn   — Learn from repo"));
  console.log(chalk.dim("  GET  /patterns         — List patterns"));
  console.log(chalk.dim("  POST /ml/embeddings    — ML stub"));
  console.log(chalk.dim("  POST /ml/similarity    — ML stub\n"));
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

  // Step 3: Supervisor catches issues
  console.log(chalk.bold.red("\n  Step 3: 🚨 Supervisor detects issues!\n"));
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

  tui.printReport(findings);

  await sleep(1000);

  // Step 4: Supervisor generates fix prompt
  console.log(chalk.bold.green("\n  Step 4: 💡 Supervisor generates fix prompt for the agent:\n"));
  await sleep(500);

  const fixPrompt = `
  ${chalk.white.bgBlue(" SUPERVISOR → AGENT ")}

  ${chalk.white("Please fix the following issues in src/auth/AuthService.ts:")}

  ${chalk.red("1.")} Remove hardcoded password — use environment variables
  ${chalk.red("2.")} Fix SQL injection — use parameterized queries
  ${chalk.red("3.")} Remove eval() — use a safe parser instead
  ${chalk.yellow("4.")} Rename file to auth-service.ts (project uses kebab-case)
  ${chalk.yellow("5.")} Convert require() to ESM import
  `;

  console.log(fixPrompt);
  await sleep(500);

  console.log(chalk.bold.magenta("\n  ═══ Demo Complete ═══\n"));
  console.log(chalk.dim("  The Meta-Agent Supervisor catches security issues, pattern violations,"));
  console.log(chalk.dim("  and code quality problems in real-time as coding agents work.\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
