import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PatternStore } from "../patterns/store";
import { PatternExtractor } from "../patterns/extractor";
import { Supervisor, type Finding } from "../supervisor";
import { SemanticStore } from "../embeddings/store";
import { SemanticSupervisor } from "../supervisor/semantic";
import { smartAnalyze } from "../supervisor/llm";
import { TfIdfVectorizer } from "../embeddings";

export function createAPI(
  store: PatternStore,
  supervisor: Supervisor,
  semanticStore?: SemanticStore
) {
  const app = new Elysia()
    .use(cors())
    .get("/health", () => ({
      status: "ok",
      service: "meta-supervisor",
      timestamp: new Date().toISOString(),
      patterns: store.getPatterns().length,
      semanticChunks: semanticStore?.getStats().totalChunks ?? 0,
    }))

    // Analyze code changes
    .post("/analyze", ({ body }) => {
      const { code, filePath } = body as { code: string; filePath: string };
      if (!code || !filePath) {
        return { error: "code and filePath are required" };
      }

      // Rule-based findings
      const findings = supervisor.analyzeCode(code, filePath);

      // Semantic findings (if indexed)
      if (semanticStore) {
        const semanticSupervisor = new SemanticSupervisor(semanticStore);
        const semanticFindings = semanticSupervisor.analyzeFile(code, filePath);
        findings.push(...semanticFindings);
      }

      return {
        findings,
        summary: {
          total: findings.length,
          critical: findings.filter((f: Finding) => f.severity === "critical").length,
          warning: findings.filter((f: Finding) => f.severity === "warning").length,
          info: findings.filter((f: Finding) => f.severity === "info").length,
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

      // Store learned patterns
      for (const p of patterns) {
        store.addPattern(p.pattern_type, p.pattern_value, p.confidence, p.examples, repoPath);
      }

      // Update supervisor with new patterns
      supervisor.updatePatterns(store.getPatterns());

      return {
        learned: patterns.length,
        patterns: patterns,
      };
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

    // ── NEW: Semantic Search Endpoints ──

    // Index a codebase
    .post("/index", async ({ body }) => {
      const { repoPath } = body as { repoPath: string };
      if (!repoPath) {
        return { error: "repoPath is required" };
      }
      if (!semanticStore) {
        return { error: "Semantic store not initialized" };
      }

      const logs: string[] = [];
      const result = await semanticStore.indexCodebase(repoPath, (msg) => {
        logs.push(msg);
      });

      return {
        ...result,
        logs,
        stats: semanticStore.getStats(),
      };
    })

    // Semantic code search
    .post("/search", ({ body }) => {
      const { query, limit } = body as { query: string; limit?: number };
      if (!query) {
        return { error: "query is required" };
      }
      if (!semanticStore) {
        return { error: "Semantic store not initialized" };
      }

      const results = semanticStore.search(query, limit || 10);
      return {
        query,
        results: results.map((r) => ({
          file: r.chunk.file_path,
          type: r.chunk.chunk_type,
          name: r.chunk.chunk_name,
          startLine: r.chunk.start_line,
          endLine: r.chunk.end_line,
          content: r.chunk.chunk_content,
          similarity: r.similarity,
        })),
        total: results.length,
      };
    })

    // LLM-enhanced smart analysis
    .post("/smart-analyze", async ({ body }) => {
      const { code, filePath } = body as { code: string; filePath: string };
      if (!code || !filePath) {
        return { error: "code and filePath are required" };
      }

      const patterns = store.getPatterns();
      const patternContext = patterns
        .map((p) => `[${p.pattern_type}] ${p.pattern_value}`)
        .join("\n");

      const analysis = await smartAnalyze(code, filePath, {
        projectPatterns: patternContext || undefined,
      });

      // Also get rule-based and semantic findings
      const ruleFindings = supervisor.analyzeCode(code, filePath);
      let semanticFindings: Finding[] = [];
      if (semanticStore) {
        const semanticSupervisor = new SemanticSupervisor(semanticStore);
        semanticFindings = semanticSupervisor.analyzeFile(code, filePath);
      }

      return {
        llmAnalysis: analysis,
        ruleFindings,
        semanticFindings,
        combined: {
          totalIssues:
            analysis.issues.length +
            ruleFindings.length +
            semanticFindings.length,
        },
      };
    })

    // ML embedding endpoint (now real!)
    .post("/ml/embeddings", ({ body }) => {
      if (!semanticStore) {
        return { stub: true, message: "Semantic store not initialized" };
      }
      const { text } = body as { text: string };
      if (!text) {
        return { error: "text is required" };
      }
      const vectorizer = semanticStore.getVectorizer();
      const embedding = vectorizer.embed(text);
      return {
        stub: false,
        embedding: Array.from(embedding.data).slice(0, 50), // First 50 dims as preview
        dim: embedding.dim,
        vocabSize: vectorizer.vocabSize,
      };
    })

    // ML similarity endpoint (now real!)
    .post("/ml/similarity", ({ body }) => {
      if (!semanticStore) {
        return { stub: true, similarity: 0.5 };
      }
      const { text1, text2 } = body as { text1: string; text2: string };
      if (!text1 || !text2) {
        return { error: "text1 and text2 are required" };
      }
      const vectorizer = semanticStore.getVectorizer();
      const vec1 = vectorizer.embed(text1);
      const vec2 = vectorizer.embed(text2);
      const similarity = TfIdfVectorizer.cosineSimilarity(vec1, vec2);
      return {
        stub: false,
        similarity,
        text1Length: text1.length,
        text2Length: text2.length,
      };
    });

  return app;
}
