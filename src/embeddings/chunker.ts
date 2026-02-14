/**
 * Code Chunker — Parses TypeScript/JavaScript files into meaningful semantic chunks
 */

export interface CodeChunk {
  content: string;
  type: "function" | "class" | "import" | "type" | "export" | "block";
  startLine: number;
  endLine: number;
  name: string | null;
}

/**
 * Parse a source file into meaningful code chunks.
 * Uses brace-counting + regex heuristics (no AST dependency).
 */
export function chunkCode(source: string, filePath?: string): CodeChunk[] {
  const lines = source.split("\n");
  const chunks: CodeChunk[] = [];

  // 1. Collect import block (contiguous imports at top)
  let importStart = -1;
  let importEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("import ") || trimmed.startsWith("import{") || (importStart >= 0 && (trimmed.startsWith("} from") || trimmed === "" || trimmed.startsWith("//")))) {
      if (importStart < 0) importStart = i;
      importEnd = i;
    } else if (importStart >= 0 && trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
      break;
    }
  }
  if (importStart >= 0) {
    const importContent = lines.slice(importStart, importEnd + 1).join("\n").trim();
    if (importContent.length > 0) {
      chunks.push({
        content: importContent,
        type: "import",
        startLine: importStart + 1,
        endLine: importEnd + 1,
        name: "imports",
      });
    }
  }

  // 2. Walk through lines looking for declarations
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and single-line comments
    if (trimmed === "" || trimmed.startsWith("//")) {
      i++;
      continue;
    }

    // Type / Interface definitions
    const typeMatch = trimmed.match(
      /^(?:export\s+)?(?:type|interface)\s+(\w+)/
    );
    if (typeMatch) {
      const end = findBlockEnd(lines, i);
      chunks.push({
        content: lines.slice(i, end + 1).join("\n"),
        type: "type",
        startLine: i + 1,
        endLine: end + 1,
        name: typeMatch[1],
      });
      i = end + 1;
      continue;
    }

    // Class definitions
    const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      const end = findBlockEnd(lines, i);
      chunks.push({
        content: lines.slice(i, end + 1).join("\n"),
        type: "class",
        startLine: i + 1,
        endLine: end + 1,
        name: classMatch[1],
      });
      i = end + 1;
      continue;
    }

    // Named function declarations
    const funcMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/
    );
    if (funcMatch) {
      const end = findBlockEnd(lines, i);
      chunks.push({
        content: lines.slice(i, end + 1).join("\n"),
        type: "function",
        startLine: i + 1,
        endLine: end + 1,
        name: funcMatch[1],
      });
      i = end + 1;
      continue;
    }

    // Arrow functions / const declarations with function bodies
    const arrowMatch = trimmed.match(
      /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\(|[a-zA-Z])/
    );
    if (arrowMatch) {
      // Check if this is a multi-line arrow / function expression
      const end = findBlockEnd(lines, i);
      const content = lines.slice(i, end + 1).join("\n");
      // Only treat as function chunk if it contains => or function keyword
      if (content.includes("=>") || content.includes("function")) {
        chunks.push({
          content,
          type: "function",
          startLine: i + 1,
          endLine: end + 1,
          name: arrowMatch[1],
        });
        i = end + 1;
        continue;
      }
    }

    // Export blocks (export default, export { })
    const exportMatch = trimmed.match(/^export\s+(default|{)/);
    if (exportMatch) {
      const end = findBlockEnd(lines, i);
      chunks.push({
        content: lines.slice(i, end + 1).join("\n"),
        type: "export",
        startLine: i + 1,
        endLine: end + 1,
        name: null,
      });
      i = end + 1;
      continue;
    }

    // Standalone const/let/var at top level (not already captured)
    const varMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/);
    if (varMatch) {
      const end = findStatementEnd(lines, i);
      const content = lines.slice(i, end + 1).join("\n");
      chunks.push({
        content,
        type: "block",
        startLine: i + 1,
        endLine: end + 1,
        name: varMatch[1],
      });
      i = end + 1;
      continue;
    }

    i++;
  }

  return chunks;
}

/**
 * Find the end of a block that uses braces { }.
 * Handles nested braces.
 */
function findBlockEnd(lines: string[], start: number): number {
  let braceDepth = 0;
  let foundOpen = false;

  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        braceDepth++;
        foundOpen = true;
      } else if (ch === "}") {
        braceDepth--;
        if (foundOpen && braceDepth === 0) {
          return i;
        }
      }
    }
  }

  // If no braces found, treat it as a single-statement thing
  if (!foundOpen) {
    return findStatementEnd(lines, start);
  }

  return lines.length - 1;
}

/**
 * Find the end of a statement (semicolons, or just the current line).
 */
function findStatementEnd(lines: string[], start: number): number {
  for (let i = start; i < Math.min(start + 30, lines.length); i++) {
    const t = lines[i].trim();
    if (t.endsWith(";") || t.endsWith(",") || t === "") {
      // If we hit a blank line, the statement ended on the previous line
      if (t === "" && i > start) return i - 1;
      if (t.endsWith(";")) return i;
    }
  }
  return start;
}

/**
 * Convenience: chunk a file from disk
 */
export async function chunkFile(filePath: string): Promise<CodeChunk[]> {
  const content = await Bun.file(filePath).text();
  return chunkCode(content, filePath);
}
