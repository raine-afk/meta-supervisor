import { Database } from "bun:sqlite";

export interface Pattern {
  id: number;
  pattern_type: string;
  pattern_value: string;
  confidence: number;
  examples: string | null;
  project_path: string | null;
  created_at: string;
}

export class PatternStore {
  private db: Database;

  constructor(dbPath: string = "patterns.db") {
    this.db = new Database(dbPath);
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL,
        pattern_value TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        examples TEXT,
        project_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  addPattern(
    type: string,
    value: string,
    confidence: number = 0.5,
    examples?: string,
    projectPath?: string
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO patterns (pattern_type, pattern_value, confidence, examples, project_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(type, value, confidence, examples ?? null, projectPath ?? null);
    return result.lastInsertRowId as number;
  }

  getPatterns(projectPath?: string): Pattern[] {
    if (projectPath) {
      const stmt = this.db.prepare(`
        SELECT * FROM patterns WHERE project_path = ? OR project_path IS NULL
      `);
      return stmt.all(projectPath) as Pattern[];
    }
    const stmt = this.db.prepare("SELECT * FROM patterns");
    return stmt.all() as Pattern[];
  }

  getPatternsByType(type: string): Pattern[] {
    const stmt = this.db.prepare("SELECT * FROM patterns WHERE pattern_type = ?");
    return stmt.all(type) as Pattern[];
  }

  deletePattern(id: number): void {
    const stmt = this.db.prepare("DELETE FROM patterns WHERE id = ?");
    stmt.run(id);
  }

  updateConfidence(id: number, confidence: number): void {
    const stmt = this.db.prepare("UPDATE patterns SET confidence = ? WHERE id = ?");
    stmt.run(confidence, id);
  }
}
