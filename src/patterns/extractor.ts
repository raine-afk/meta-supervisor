import simpleGit, { SimpleGit } from "simple-git";
import { readdir, readFile, stat } from "fs/promises";
import { join, extname, basename } from "path";

interface ExtractedPattern {
  pattern_type: string;
  pattern_value: string;
  confidence: number;
  examples: string;
}

export class PatternExtractor {
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async extractAll(repoPath: string): Promise<ExtractedPattern[]> {
    const patterns: ExtractedPattern[] = [];

    try {
      // Extract patterns from git history
      const gitPatterns = await this.extractFromGitHistory();
      patterns.push(...gitPatterns);
    } catch (e) {
      // Repo might not have git history yet
    }

    // Extract patterns from file structure
    const structurePatterns = await this.extractFromStructure(repoPath);
    patterns.push(...structurePatterns);

    // Extract patterns from file contents
    const codePatterns = await this.extractFromCode(repoPath);
    patterns.push(...codePatterns);

    return patterns;
  }

  private async extractFromGitHistory(): Promise<ExtractedPattern[]> {
    const patterns: ExtractedPattern[] = [];

    const log = await this.git.log({ maxCount: 100 });

    // Analyze commit message patterns
    const commitPrefixes: Record<string, number> = {};
    for (const commit of log.all) {
      const match = commit.message.match(/^(\w+)[\(:\s]/);
      if (match) {
        commitPrefixes[match[1]] = (commitPrefixes[match[1]] || 0) + 1;
      }
    }

    const totalCommits = log.all.length || 1;
    for (const [prefix, count] of Object.entries(commitPrefixes)) {
      if (count > 2) {
        patterns.push({
          pattern_type: "commit_convention",
          pattern_value: `Commits use "${prefix}" prefix`,
          confidence: Math.min(count / totalCommits, 0.95),
          examples: `${prefix}: example message (${count} occurrences)`,
        });
      }
    }

    // Analyze which files change together
    const diffStats = await this.git.diffSummary(["HEAD~5..HEAD"]).catch(() => null);
    if (diffStats) {
      const changedFiles = diffStats.files.map((f) => f.file);
      if (changedFiles.length > 0) {
        patterns.push({
          pattern_type: "recent_activity",
          pattern_value: `Recently active files: ${changedFiles.slice(0, 5).join(", ")}`,
          confidence: 0.7,
          examples: changedFiles.join(", "),
        });
      }
    }

    return patterns;
  }

  private async extractFromStructure(repoPath: string): Promise<ExtractedPattern[]> {
    const patterns: ExtractedPattern[] = [];
    const files = await this.walkDir(repoPath, 3);

    // File naming convention detection
    const fileNames = files.map((f) => basename(f, extname(f)));
    const camelCase = fileNames.filter((n) => /^[a-z][a-zA-Z0-9]*$/.test(n));
    const kebabCase = fileNames.filter((n) => /^[a-z][a-z0-9-]*$/.test(n));
    const snakeCase = fileNames.filter((n) => /^[a-z][a-z0-9_]*$/.test(n));
    const pascalCase = fileNames.filter((n) => /^[A-Z][a-zA-Z0-9]*$/.test(n));

    const total = fileNames.length || 1;
    const conventions = [
      { name: "camelCase", count: camelCase.length },
      { name: "kebab-case", count: kebabCase.length },
      { name: "snake_case", count: snakeCase.length },
      { name: "PascalCase", count: pascalCase.length },
    ].sort((a, b) => b.count - a.count);

    if (conventions[0].count > 3) {
      patterns.push({
        pattern_type: "naming_convention",
        pattern_value: `Files use ${conventions[0].name} naming`,
        confidence: conventions[0].count / total,
        examples: fileNames.slice(0, 5).join(", "),
      });
    }

    // Directory structure patterns
    const dirs = new Set<string>();
    for (const file of files) {
      const rel = file.replace(repoPath + "/", "");
      const parts = rel.split("/");
      if (parts.length > 1) {
        dirs.add(parts[0]);
        if (parts.length > 2) {
          dirs.add(`${parts[0]}/${parts[1]}`);
        }
      }
    }

    if (dirs.size > 0) {
      patterns.push({
        pattern_type: "directory_structure",
        pattern_value: `Project uses directories: ${[...dirs].slice(0, 10).join(", ")}`,
        confidence: 0.8,
        examples: [...dirs].join(", "),
      });
    }

    // File extension patterns
    const extensions: Record<string, number> = {};
    for (const file of files) {
      const ext = extname(file);
      if (ext) extensions[ext] = (extensions[ext] || 0) + 1;
    }

    const mainExt = Object.entries(extensions).sort((a, b) => b[1] - a[1]);
    if (mainExt.length > 0) {
      const isTS = mainExt.some(([ext]) => ext === ".ts" || ext === ".tsx");
      if (isTS) {
        patterns.push({
          pattern_type: "language",
          pattern_value: "TypeScript project",
          confidence: 0.9,
          examples: mainExt.map(([ext, count]) => `${ext}: ${count} files`).join(", "),
        });
      }
    }

    return patterns;
  }

  private async extractFromCode(repoPath: string): Promise<ExtractedPattern[]> {
    const patterns: ExtractedPattern[] = [];
    const files = await this.walkDir(repoPath, 3);
    const codeFiles = files.filter((f) =>
      [".ts", ".tsx", ".js", ".jsx"].includes(extname(f))
    );

    let esmImports = 0;
    let cjsRequires = 0;
    let semicolons = 0;
    let noSemicolons = 0;
    let singleQuotes = 0;
    let doubleQuotes = 0;
    let tryCatchCount = 0;
    let asyncAwaitCount = 0;
    let anyTypeCount = 0;

    const sampled = codeFiles.slice(0, 20); // Sample first 20 files

    for (const file of sampled) {
      try {
        const content = await readFile(file, "utf-8");
        const lines = content.split("\n");

        for (const line of lines) {
          if (line.match(/^import\s/)) esmImports++;
          if (line.match(/require\(/)) cjsRequires++;
          if (line.trimEnd().endsWith(";")) semicolons++;
          else if (line.trim().length > 0) noSemicolons++;
          if (line.includes("'")) singleQuotes++;
          if (line.includes('"')) doubleQuotes++;
          if (line.includes("try {") || line.includes("try{")) tryCatchCount++;
          if (line.includes("async ") || line.includes("await ")) asyncAwaitCount++;
          if (line.includes(": any") || line.includes("<any>")) anyTypeCount++;
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    // Import style
    if (esmImports + cjsRequires > 0) {
      const isESM = esmImports > cjsRequires;
      patterns.push({
        pattern_type: "import_style",
        pattern_value: isESM ? "ESM imports (import/export)" : "CommonJS (require/module.exports)",
        confidence: Math.max(esmImports, cjsRequires) / (esmImports + cjsRequires),
        examples: `ESM: ${esmImports}, CJS: ${cjsRequires}`,
      });
    }

    // Semicolons
    if (semicolons + noSemicolons > 0) {
      const usesSemicolons = semicolons > noSemicolons;
      patterns.push({
        pattern_type: "formatting",
        pattern_value: usesSemicolons ? "Uses semicolons" : "No semicolons",
        confidence: Math.max(semicolons, noSemicolons) / (semicolons + noSemicolons),
        examples: `With: ${semicolons}, Without: ${noSemicolons}`,
      });
    }

    // Quotes
    if (singleQuotes + doubleQuotes > 0) {
      const usesSingle = singleQuotes > doubleQuotes;
      patterns.push({
        pattern_type: "formatting",
        pattern_value: usesSingle ? "Prefers single quotes" : "Prefers double quotes",
        confidence: Math.max(singleQuotes, doubleQuotes) / (singleQuotes + doubleQuotes),
        examples: `Single: ${singleQuotes}, Double: ${doubleQuotes}`,
      });
    }

    // Error handling
    if (tryCatchCount > 0) {
      patterns.push({
        pattern_type: "error_handling",
        pattern_value: `Uses try/catch blocks (${tryCatchCount} found)`,
        confidence: 0.7,
        examples: `${tryCatchCount} try/catch blocks in ${sampled.length} files`,
      });
    }

    // Async/await usage
    if (asyncAwaitCount > 0) {
      patterns.push({
        pattern_type: "async_pattern",
        pattern_value: "Uses async/await",
        confidence: 0.8,
        examples: `${asyncAwaitCount} async/await usages found`,
      });
    }

    return patterns;
  }

  private async walkDir(dir: string, maxDepth: number, depth = 0): Promise<string[]> {
    if (depth >= maxDepth) return [];

    const results: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;

        const fullPath = join(dir, entry);
        try {
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            results.push(...(await this.walkDir(fullPath, maxDepth, depth + 1)));
          } else {
            results.push(fullPath);
          }
        } catch (e) {
          // Skip inaccessible
        }
      }
    } catch (e) {
      // Skip unreadable dirs
    }
    return results;
  }
}
