/**
 * Semantic Supervisor — Uses embeddings to detect code duplication,
 * pattern inconsistencies, and semantic issues beyond regex matching.
 */

import { SemanticStore, type SearchResult } from "../embeddings/store";
import { chunkCode, type CodeChunk } from "../embeddings/chunker";
import type { Finding } from "./index";

export interface SemanticFinding extends Finding {
  similarChunk?: {
    file: string;
    name: string | null;
    similarity: number;
    content: string;
  };
}

export class SemanticSupervisor {
  private store: SemanticStore;
  /** Minimum similarity to flag as potential duplication */
  private duplicationThreshold: number;
  /** Minimum similarity to flag pattern inconsistency */
  private patternThreshold: number;

  constructor(
    store: SemanticStore,
    opts?: { duplicationThreshold?: number; patternThreshold?: number }
  ) {
    this.store = store;
    this.duplicationThreshold = opts?.duplicationThreshold ?? 0.7;
    this.patternThreshold = opts?.patternThreshold ?? 0.5;
  }

  /**
   * Analyze a file for semantic issues.
   * Chunks the code and compares each chunk against the indexed codebase.
   */
  analyzeFile(content: string, filePath: string): SemanticFinding[] {
    const findings: SemanticFinding[] = [];
    const chunks = chunkCode(content, filePath);

    for (const chunk of chunks) {
      // Skip tiny chunks (imports, single-line vars)
      if (chunk.content.split("\n").length < 3) continue;

      // Find similar existing chunks
      const similar = this.store.findSimilar(
        chunk.content,
        this.patternThreshold,
        filePath
      );

      if (similar.length === 0) continue;

      const top = similar[0];

      // High similarity = potential duplication
      if (top.similarity >= this.duplicationThreshold) {
        findings.push({
          severity: "warning",
          rule: "semantic-duplication",
          message: `This ${chunk.type}${chunk.name ? ` "${chunk.name}"` : ""} is very similar to existing code (${(top.similarity * 100).toFixed(0)}% match)`,
          file: filePath,
          line: chunk.startLine,
          suggestion: `Possible duplication of ${top.chunk.chunk_type}${top.chunk.chunk_name ? ` "${top.chunk.chunk_name}"` : ""} in ${top.chunk.file_path}:${top.chunk.start_line}. Consider extracting shared logic.`,
          similarChunk: {
            file: top.chunk.file_path,
            name: top.chunk.chunk_name,
            similarity: top.similarity,
            content: top.chunk.chunk_content.slice(0, 200),
          },
        });
      }
      // Medium similarity = pattern inconsistency
      else if (
        top.similarity >= this.patternThreshold &&
        chunk.type === top.chunk.chunk_type
      ) {
        // Check if the chunks are doing similar things differently
        const inconsistency = this.detectInconsistency(chunk, top);
        if (inconsistency) {
          findings.push({
            severity: "info",
            rule: "semantic-inconsistency",
            message: inconsistency.message,
            file: filePath,
            line: chunk.startLine,
            suggestion: inconsistency.suggestion,
            similarChunk: {
              file: top.chunk.file_path,
              name: top.chunk.chunk_name,
              similarity: top.similarity,
              content: top.chunk.chunk_content.slice(0, 200),
            },
          });
        }
      }
    }

    return findings;
  }

  /**
   * Detect specific inconsistencies between two similar chunks.
   */
  private detectInconsistency(
    chunk: CodeChunk,
    similar: SearchResult
  ): { message: string; suggestion: string } | null {
    const a = chunk.content;
    const b = similar.chunk.chunk_content;

    // Error handling inconsistency
    const aHasTryCatch = /try\s*\{/.test(a);
    const bHasTryCatch = /try\s*\{/.test(b);
    if (aHasTryCatch !== bHasTryCatch) {
      const which = aHasTryCatch ? "has" : "lacks";
      const other = aHasTryCatch ? "lacks" : "has";
      return {
        message: `This ${chunk.type} ${which} error handling, but similar ${similar.chunk.chunk_type} "${similar.chunk.chunk_name}" in ${similar.chunk.file_path} ${other} it`,
        suggestion: `Align error handling patterns with similar code in ${similar.chunk.file_path}`,
      };
    }

    // Async pattern inconsistency
    const aIsAsync = /async\s/.test(a);
    const bIsAsync = /async\s/.test(b);
    if (aIsAsync !== bIsAsync) {
      return {
        message: `This ${chunk.type} uses ${aIsAsync ? "async" : "sync"} pattern, but similar code in ${similar.chunk.file_path} uses ${bIsAsync ? "async" : "sync"}`,
        suggestion: `Consider aligning async/sync patterns with similar code`,
      };
    }

    // Return type inconsistency (one returns, one doesn't)
    const aReturns = /return\s/.test(a);
    const bReturns = /return\s/.test(b);
    if (aReturns !== bReturns && chunk.type === "function") {
      return {
        message: `This function ${aReturns ? "returns a value" : "doesn't return"}, unlike similar function "${similar.chunk.chunk_name}" in ${similar.chunk.file_path}`,
        suggestion: `Check if return behavior should be consistent`,
      };
    }

    return null;
  }
}
