import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PatternStore } from "../patterns/store";
import { PatternExtractor } from "../patterns/extractor";
import { Supervisor, type Finding } from "../supervisor";
import { SemanticStore } from "../embeddings/store";
import { SemanticSupervisor } from "../supervisor/semantic";

export function createAPI(store: PatternStore, supervisor: Supervisor, semanticStore?: SemanticStore) {
  const semSupervisor = semanticStore ? new SemanticSupervisor(semanticStore) : null;

  const app = new Elysia()
    .use(cors())
    .get("/health", () => ({
      status: "ok",
      service: "meta-supervisor",
      timestamp: new Date().toISOString(),
      patterns: store.getPatterns().length,
      indexedChunks: semanticStore?.getStats().totalChunks ?? 0,
    }))

    // Analyze code changes (rules + semantic)
    .post("/analyze", ({ body }) => {
      const { code, filePath } = body as { code: string; filePath: string };
      if (!code || !filePath) {
        return { error: "code and filePath are required" };
      }

      const ruleFindings = supervisor.analyzeCode(code, filePath);
      const semFindings = semSupervisor?.analyzeFile(code, filePath) ?? [];
      const allFindings = [...ruleFindings, ...semFindings];

      return {
        findings: allFindings,
        summary: {
          total: allFindings.length,
          critical: allFindings.filter((f: Finding) => f.severity === "critical").length,
          warning: allFindings.filter((f: Finding) => f.severity === "warning").length,
          info: allFindings.filter((f: Finding) => f.severity === "info").length,
          rulesBased: ruleFindings.length,
          semantic: semFindings.length,
        },
      };
    })

    // Learn patterns from a repository
    .post("/patterns/learn", async ({ body }) => {
      const { repoPath } = body as { repoPath: string };
      if (!repoPath) {
        return { error: "repoPath is required" };
      }

      const extractor = new PatternExtractor(repoPath);
      const patterns = await extractor.extractAll(repoPath);

      for (const p of patterns) {
        store.addPattern(p.pattern_type, p.pattern_value, p.confidence, p.examples, repoPath);
      }

      supervisor.updatePatterns(store.getPatterns());

      return { learned: patterns.length, patterns };
    })

    // Get all patterns
    .get("/patterns", ({ query }) => {
      const projectPath = query.project as string | undefined;
      return {
        patterns: store.getPatterns(projectPath),
        total: store.getPatterns(projectPath).length,
      };
    })

    // Delete a pattern
    .delete("/patterns/:id", ({ params }) => {
      store.deletePattern(parseInt(params.id));
      return { deleted: true };
    })

    // Index a codebase for semantic search
    .post("/index", async ({ body }) => {
      const { repoPath } = body as { repoPath: string };
      if (!repoPath) return { error: "repoPath is required" };
      if (!semanticStore) return { error: "Semantic store not available" };

      const result = await semanticStore.indexCodebase(repoPath);
      return {
        indexed: true,
        filesIndexed: result.filesIndexed,
        chunksStored: result.chunksStored,
        vocabulary: semanticStore.getVectorizer().vocabSize,
      };
    })

    // Semantic code search
    .post("/search", ({ body }) => {
      const { query, limit } = body as { query: string; limit?: number };
      if (!query) return { error: "query is required" };
      if (!semanticStore) return { error: "Semantic store not available" };

      const results = semanticStore.search(query, limit || 10);
      return {
        query,
        results: results.map((r) => ({
          file: r.chunk.file_path,
          type: r.chunk.chunk_type,
          name: r.chunk.chunk_name,
          line: r.chunk.start_line,
          similarity: Math.round(r.similarity * 100) / 100,
          preview: r.chunk.chunk_content.slice(0, 200),
        })),
        total: results.length,
      };
    })

    // Index stats
    .get("/stats", () => {
      const stats = semanticStore?.getStats() ?? { totalChunks: 0, totalFiles: 0, projects: [] };
      return {
        patterns: store.getPatterns().length,
        ...stats,
        vocabulary: semanticStore?.getVectorizer().vocabSize ?? 0,
      };
    })

    // Stub ML endpoints (for teammates)
    .post("/ml/embeddings", ({ body }) => ({
      stub: true,
      message: "ML embedding endpoint — to be implemented by ML team",
      input: body,
    }))

    .post("/ml/similarity", ({ body }) => ({
      stub: true,
      message: "ML similarity endpoint — to be implemented by ML team",
      similarity: 0.5,
    }));

  return app;
}
