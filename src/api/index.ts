import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { PatternStore } from "../patterns/store";
import { PatternExtractor } from "../patterns/extractor";
import { Supervisor, type Finding } from "../supervisor";

export function createAPI(store: PatternStore, supervisor: Supervisor) {
  const app = new Elysia()
    .use(cors())
    .get("/health", () => ({
      status: "ok",
      service: "meta-supervisor",
      timestamp: new Date().toISOString(),
      patterns: store.getPatterns().length,
    }))

    // Analyze code changes
    .post("/analyze", ({ body }) => {
      const { code, filePath } = body as { code: string; filePath: string };
      if (!code || !filePath) {
        return { error: "code and filePath are required" };
      }
      const findings = supervisor.analyzeCode(code, filePath);
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

    // Stub ML endpoint (for teammates)
    .post("/ml/embeddings", ({ body }) => {
      // STUB: Teammates will implement real embedding generation
      return {
        stub: true,
        message: "ML embedding endpoint — to be implemented by ML team",
        input: body,
      };
    })

    // Stub ML endpoint: semantic similarity
    .post("/ml/similarity", ({ body }) => {
      // STUB: Teammates will implement real semantic similarity
      return {
        stub: true,
        message: "ML similarity endpoint — to be implemented by ML team",
        similarity: 0.5,
      };
    });

  return app;
}
