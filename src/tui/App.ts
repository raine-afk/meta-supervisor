import chalk from "chalk";
import type { Finding } from "../supervisor";
import type { FileChange } from "../watcher";
import type { AgentOutput } from "../agent/wrapper";

const SEVERITY_COLORS = {
  critical: chalk.red.bold,
  warning: chalk.yellow,
  info: chalk.cyan,
};

const SEVERITY_ICONS = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

// Rules that come from semantic analysis
const SEMANTIC_RULES = new Set([
  "semantic-duplication",
  "semantic-inconsistency",
]);

export class TUI {
  private agentLog: string[] = [];
  private findings: Finding[] = [];
  private stats = {
    patternsLoaded: 0,
    filesWatched: 0,
    totalFindings: 0,
    criticalCount: 0,
  };
  private watching = false;

  clear(): void {
    process.stdout.write("\x1B[2J\x1B[0f");
  }

  render(): void {
    this.clear();
    const width = process.stdout.columns || 80;
    const divider = "─".repeat(width);

    // Header
    console.log(chalk.bold.magenta(`
 ███╗   ███╗███████╗████████╗ █████╗ 
 ████╗ ████║██╔════╝╚══██╔══╝██╔══██╗
 ██╔████╔██║█████╗     ██║   ███████║
 ██║╚██╔╝██║██╔══╝     ██║   ██╔══██║
 ██║ ╚═╝ ██║███████╗   ██║   ██║  ██║
 ╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝
    `));
    console.log(chalk.dim("  Meta-Agent Supervisor — Watching over your coding agents\n"));

    // Status bar
    console.log(chalk.bgGray.white(` 📊 Patterns: ${this.stats.patternsLoaded} | 👁️  Watching: ${this.stats.filesWatched} files | ⚠️  Findings: ${this.stats.totalFindings} | 🔴 Critical: ${this.stats.criticalCount} `));
    console.log(chalk.dim(divider));

    // Agent Activity
    console.log(chalk.bold.blue("\n  🤖 Agent Activity\n"));
    if (this.agentLog.length === 0) {
      console.log(chalk.dim("    No agent activity yet...\n"));
    } else {
      const recentLogs = this.agentLog.slice(-8);
      for (const log of recentLogs) {
        console.log(`    ${chalk.dim("│")} ${log}`);
      }
      console.log();
    }

    console.log(chalk.dim(divider));

    // Supervisor Findings - split into rule-based and semantic
    const ruleFindings = this.findings.filter((f) => !SEMANTIC_RULES.has(f.rule));
    const semanticFindings = this.findings.filter((f) => SEMANTIC_RULES.has(f.rule));

    console.log(chalk.bold.green("\n  🔍 Rule-Based Findings\n"));
    if (ruleFindings.length === 0) {
      console.log(chalk.dim("    No rule-based findings — all clear! ✅\n"));
    } else {
      const recentFindings = ruleFindings.slice(-8);
      for (const finding of recentFindings) {
        this.printFinding(finding);
      }
    }

    if (semanticFindings.length > 0) {
      console.log(chalk.dim(divider));
      console.log(chalk.bold.cyan("\n  🧠 Semantic Findings\n"));
      const recentSemantic = semanticFindings.slice(-8);
      for (const finding of recentSemantic) {
        this.printFinding(finding);
      }
    }

    console.log(chalk.dim(divider));
    console.log(chalk.dim(`\n  ${this.watching ? "👀 Watching for changes..." : "⏹️  Idle"} | Press Ctrl+C to exit\n`));
  }

  private printFinding(finding: Finding): void {
    const color = SEVERITY_COLORS[finding.severity];
    const icon = SEVERITY_ICONS[finding.severity];
    const isSemantic = SEMANTIC_RULES.has(finding.rule);
    const prefix = isSemantic ? chalk.magenta("🧠 ") : "";

    console.log(`    ${prefix}${icon} ${color(`[${finding.severity.toUpperCase()}]`)} ${chalk.white(finding.message)}`);
    console.log(`       ${chalk.dim(`${finding.file}${finding.line ? `:${finding.line}` : ""}`)} ${chalk.dim(`(${finding.rule})`)}`);
    if (finding.suggestion) {
      console.log(`       ${chalk.green(`💡 ${finding.suggestion}`)}`);
    }
    console.log();
  }

  addAgentOutput(output: AgentOutput): void {
    const prefix = output.type === "stderr" ? chalk.red("ERR") : chalk.green("OUT");
    const lines = output.data.trim().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        this.agentLog.push(`${prefix} ${line.trim()}`);
      }
    }
    // Keep log manageable
    if (this.agentLog.length > 100) {
      this.agentLog = this.agentLog.slice(-50);
    }
  }

  addFindings(findings: Finding[]): void {
    this.findings.push(...findings);
    this.stats.totalFindings += findings.length;
    this.stats.criticalCount += findings.filter((f) => f.severity === "critical").length;

    // Keep findings manageable
    if (this.findings.length > 100) {
      this.findings = this.findings.slice(-50);
    }
  }

  addFileChange(change: FileChange): void {
    const icon = change.type === "add" ? "+" : change.type === "unlink" ? "-" : "~";
    const color = change.type === "add" ? chalk.green : change.type === "unlink" ? chalk.red : chalk.yellow;
    this.agentLog.push(color(`${icon} ${change.relativePath}`));
  }

  updateStats(stats: Partial<typeof this.stats>): void {
    Object.assign(this.stats, stats);
  }

  setWatching(watching: boolean): void {
    this.watching = watching;
  }

  // Print a one-time finding report (non-interactive)
  printReport(findings: Finding[]): void {
    console.log(chalk.bold.magenta("\n  ═══ Meta-Agent Supervisor Report ═══\n"));

    if (findings.length === 0) {
      console.log(chalk.green("  ✅ No issues found! Code looks clean.\n"));
      return;
    }

    const critical = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const info = findings.filter((f) => f.severity === "info");
    const semantic = findings.filter((f) => SEMANTIC_RULES.has(f.rule));
    const ruleBased = findings.filter((f) => !SEMANTIC_RULES.has(f.rule));

    console.log(`  Summary: ${chalk.red.bold(`${critical.length} critical`)} | ${chalk.yellow(`${warnings.length} warnings`)} | ${chalk.cyan(`${info.length} info`)}${semantic.length > 0 ? ` | ${chalk.magenta(`${semantic.length} semantic`)}` : ""}\n`);

    // Print rule-based findings first
    if (ruleBased.length > 0) {
      for (const finding of ruleBased) {
        this.printFinding(finding);
      }
    }

    // Print semantic findings with a separator
    if (semantic.length > 0) {
      console.log(chalk.dim("  ── Semantic Analysis ──\n"));
      for (const finding of semantic) {
        this.printFinding(finding);
      }
    }
  }
}
