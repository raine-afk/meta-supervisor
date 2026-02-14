import type { Pattern } from "../patterns/store";
import type { FileChange } from "../watcher";

export interface Finding {
  severity: "critical" | "warning" | "info";
  rule: string;
  message: string;
  file: string;
  line?: number;
  suggestion?: string;
}

// Security anti-patterns to detect
const SECURITY_PATTERNS = [
  { pattern: /eval\s*\(/, rule: "no-eval", message: "Usage of eval() is a security risk", severity: "critical" as const },
  { pattern: /innerHTML\s*=/, rule: "no-innerHTML", message: "innerHTML assignment can lead to XSS", severity: "critical" as const },
  { pattern: /dangerouslySetInnerHTML/, rule: "no-dangerous-html", message: "dangerouslySetInnerHTML can lead to XSS", severity: "warning" as const },
  { pattern: /document\.write\s*\(/, rule: "no-document-write", message: "document.write() is deprecated and risky", severity: "warning" as const },
  { pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i, rule: "sql-injection", message: "Potential SQL injection — use parameterized queries", severity: "critical" as const },
  { pattern: /exec\s*\(\s*`/, rule: "command-injection", message: "Template literal in exec() — potential command injection", severity: "critical" as const },
  { pattern: /password\s*[:=]\s*["'](?!process|env)/i, rule: "hardcoded-password", message: "Possible hardcoded password detected", severity: "critical" as const },
  { pattern: /api[_-]?key\s*[:=]\s*["'][a-zA-Z0-9]/i, rule: "hardcoded-api-key", message: "Possible hardcoded API key detected", severity: "critical" as const },
];

// Code quality anti-patterns
const QUALITY_PATTERNS = [
  { pattern: /:\s*any\b/, rule: "no-any", message: "Avoid using 'any' type — use specific types", severity: "warning" as const },
  { pattern: /console\.log\(/, rule: "no-console-log", message: "console.log left in code — use a proper logger", severity: "info" as const },
  { pattern: /TODO|FIXME|HACK|XXX/, rule: "todo-found", message: "TODO/FIXME comment found — track in issue tracker", severity: "info" as const },
  { pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/, rule: "empty-catch", message: "Empty catch block — errors are being swallowed", severity: "warning" as const },
  { pattern: /\.then\(.*\.catch\(\)/, rule: "empty-catch-promise", message: "Empty .catch() — promise errors are being swallowed", severity: "warning" as const },
];

export class Supervisor {
  private patterns: Pattern[];

  constructor(patterns: Pattern[] = []) {
    this.patterns = patterns;
  }

  updatePatterns(patterns: Pattern[]): void {
    this.patterns = patterns;
  }

  analyzeChanges(changes: FileChange[]): Finding[] {
    const findings: Finding[] = [];

    for (const change of changes) {
      if (change.type === "unlink" || !change.content) continue;

      // Run security checks
      findings.push(...this.checkSecurity(change));

      // Run quality checks
      findings.push(...this.checkQuality(change));

      // Run pattern consistency checks
      findings.push(...this.checkPatternConsistency(change));

      // Run structural checks
      findings.push(...this.checkStructure(change));
    }

    return findings;
  }

  analyzeCode(code: string, filePath: string): Finding[] {
    const fakeChange: FileChange = {
      type: "change",
      path: filePath,
      relativePath: filePath,
      content: code,
      timestamp: Date.now(),
    };
    return this.analyzeChanges([fakeChange]);
  }

  private checkSecurity(change: FileChange): Finding[] {
    const findings: Finding[] = [];
    const lines = change.content!.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const check of SECURITY_PATTERNS) {
        if (check.pattern.test(lines[i])) {
          findings.push({
            severity: check.severity,
            rule: check.rule,
            message: check.message,
            file: change.relativePath,
            line: i + 1,
            suggestion: `Review line ${i + 1} for security implications`,
          });
        }
      }
    }

    return findings;
  }

  private checkQuality(change: FileChange): Finding[] {
    const findings: Finding[] = [];
    const lines = change.content!.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const check of QUALITY_PATTERNS) {
        if (check.pattern.test(lines[i])) {
          findings.push({
            severity: check.severity,
            rule: check.rule,
            message: check.message,
            file: change.relativePath,
            line: i + 1,
          });
        }
      }
    }

    // Check for very long files
    if (lines.length > 300) {
      findings.push({
        severity: "warning",
        rule: "file-too-long",
        message: `File is ${lines.length} lines — consider splitting into smaller modules`,
        file: change.relativePath,
        suggestion: "Break this file into smaller, focused modules",
      });
    }

    // Check for very long lines
    const longLines = lines.filter((l) => l.length > 120);
    if (longLines.length > 5) {
      findings.push({
        severity: "info",
        rule: "long-lines",
        message: `${longLines.length} lines exceed 120 characters`,
        file: change.relativePath,
      });
    }

    return findings;
  }

  private checkPatternConsistency(change: FileChange): Finding[] {
    const findings: Finding[] = [];
    if (!change.content) return findings;

    // Check import style consistency against learned patterns
    const importPattern = this.patterns.find((p) => p.pattern_type === "import_style");
    if (importPattern) {
      const hasESM = /^import\s/.test(change.content);
      const hasCJS = /require\(/.test(change.content);

      if (importPattern.pattern_value.includes("ESM") && hasCJS && !hasESM) {
        findings.push({
          severity: "warning",
          rule: "import-consistency",
          message: "File uses require() but project convention is ESM imports",
          file: change.relativePath,
          suggestion: 'Convert to ESM: import x from "module"',
        });
      }
      if (importPattern.pattern_value.includes("CommonJS") && hasESM && !hasCJS) {
        findings.push({
          severity: "warning",
          rule: "import-consistency",
          message: "File uses ESM imports but project convention is CommonJS",
          file: change.relativePath,
          suggestion: 'Convert to CJS: const x = require("module")',
        });
      }
    }

    // Check naming convention
    const namingPattern = this.patterns.find((p) => p.pattern_type === "naming_convention");
    if (namingPattern) {
      const fileName = change.relativePath.split("/").pop()?.replace(/\.\w+$/, "") || "";
      const convention = namingPattern.pattern_value;

      if (convention.includes("kebab-case") && /[A-Z_]/.test(fileName)) {
        findings.push({
          severity: "warning",
          rule: "naming-convention",
          message: `File "${fileName}" doesn't match project's kebab-case convention`,
          file: change.relativePath,
          suggestion: `Rename to: ${fileName.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "")}`,
        });
      }
      if (convention.includes("camelCase") && /[-_]/.test(fileName)) {
        findings.push({
          severity: "warning",
          rule: "naming-convention",
          message: `File "${fileName}" doesn't match project's camelCase convention`,
          file: change.relativePath,
        });
      }
    }

    return findings;
  }

  private checkStructure(change: FileChange): Finding[] {
    const findings: Finding[] = [];
    if (!change.content) return findings;

    // Check for missing error handling in async functions
    const hasAsync = /async\s+(function|\(|[a-zA-Z])/.test(change.content);
    const hasAwait = /await\s/.test(change.content);
    const hasTryCatch = /try\s*\{/.test(change.content);

    if (hasAsync && hasAwait && !hasTryCatch) {
      findings.push({
        severity: "warning",
        rule: "missing-error-handling",
        message: "Async function with await but no try/catch — errors may be unhandled",
        file: change.relativePath,
        suggestion: "Wrap await calls in try/catch blocks",
      });
    }

    // Check for missing type annotations on exports
    if (change.relativePath.endsWith(".ts") || change.relativePath.endsWith(".tsx")) {
      const exportLines = change.content.split("\n").filter((l) => /^export\s+(function|const|let|var)/.test(l));
      for (const line of exportLines) {
        if (/export\s+(const|let|var)\s+\w+\s*=/.test(line) && !/:/.test(line.split("=")[0])) {
          findings.push({
            severity: "info",
            rule: "missing-type-annotation",
            message: "Exported variable without explicit type annotation",
            file: change.relativePath,
            suggestion: "Add explicit type annotations to exported values",
          });
          break; // One warning per file is enough
        }
      }
    }

    return findings;
  }
}
