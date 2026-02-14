/**
 * Semantic Code Store — SQLite-backed storage for code chunks + embeddings
 *
 * Stores chunked code with TF-IDF vectors and supports cosine similarity search.
 */

import { Database } from "bun:sqlite";
import { TfIdfVectorizer, type EmbeddingVector } from "./index";
import { chunkCode, type CodeChunk } from "./chunker";
import { readdir, readFile, stat } from "fs/promises";
import { join, extname, relative } from "path";

export interface StoredChunk {
  id: number;
  file_path: string;
  chunk_content: string;
  chunk_type: string;
  chunk_name: string | null;
  start_line: number;
  end_line: number;
  project_path: string;
  created_at: string;
}

export interface SearchResult {
  chunk: StoredChunk;
  similarity: number;
}

export class SemanticStore {
  private db: Database;
  private vectorizer: TfIdfVectorizer;

  constructor(dbPath: string = "meta-supervisor.db") {
    this.db = new Database(dbPath);
    this.vectorizer = new TfIdfVectorizer();
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS code_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        chunk_content TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        chunk_name TEXT,
        start_line INTEGER,
        end_line INTEGER,
        embedding BLOB,
        project_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectorizer_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Load vectorizer state if it exists
    const row = this.db.prepare("SELECT state FROM vectorizer_state WHERE id = 1").get() as { state: string } | null;
    if (row) {
      try {
        this.vectorizer = TfIdfVectorizer.deserialize(row.state);
      } catch {
        // Corrupted state, start fresh
        this.vectorizer = new TfIdfVectorizer();
      }
    }
  }

  /**
   * Index an entire codebase: walk files, chunk them, compute embeddings, store.
   */
  async indexCodebase(
    repoPath: string,
    onProgress?: (msg: string) => void
  ): Promise<{ filesIndexed: number; chunksStored: number }> {
    const absPath = join(process.cwd(), repoPath).replace(/\/\.$/, "");
    const files = await this.walkDir(absPath, 5);
    const codeFiles = files.filter((f) =>
      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(f))
    );

    onProgress?.(`Found ${codeFiles.length} code files`);

    // Phase 1: chunk all files and train the vectorizer vocabulary
    const allChunks: { filePath: string; chunks: CodeChunk[] }[] = [];
    const allContents: string[] = [];

    for (const file of codeFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const chunks = chunkCode(content, file);
        allChunks.push({ filePath: file, chunks });
        for (const c of chunks) {
          allContents.push(c.content);
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Train vectorizer on all chunk contents
    this.vectorizer.addDocuments(allContents);
    onProgress?.(`Vocabulary built: ${this.vectorizer.vocabSize} tokens from ${allContents.length} chunks`);

    // Phase 2: embed and store
    // Clear previous chunks for this project
    this.db.prepare("DELETE FROM code_chunks WHERE project_path = ?").run(absPath);

    const insertStmt = this.db.prepare(`
      INSERT INTO code_chunks (file_path, chunk_content, chunk_type, chunk_name, start_line, end_line, embedding, project_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let chunksStored = 0;

    const insertMany = this.db.transaction(() => {
      for (const { filePath, chunks } of allChunks) {
        const relPath = relative(absPath, filePath);
        for (const chunk of chunks) {
          const embedding = this.vectorizer.embed(chunk.content);
          const embeddingBlob = Buffer.from(embedding.data.buffer);
          insertStmt.run(
            relPath,
            chunk.content,
            chunk.type,
            chunk.name,
            chunk.startLine,
            chunk.endLine,
            embeddingBlob,
            absPath
          );
          chunksStored++;
        }
      }
    });

    insertMany();

    // Save vectorizer state
    this.saveVectorizerState();

    onProgress?.(`Indexed ${codeFiles.length} files → ${chunksStored} chunks`);

    return { filesIndexed: codeFiles.length, chunksStored };
  }

  /**
   * Semantic search: find chunks most similar to a query string.
   */
  search(query: string, limit: number = 10, projectPath?: string): SearchResult[] {
    const queryEmbedding = this.vectorizer.embed(query);
    if (queryEmbedding.dim === 0) return [];

    let rows: StoredChunk[];
    if (projectPath) {
      rows = this.db
        .prepare("SELECT * FROM code_chunks WHERE project_path = ?")
        .all(projectPath) as StoredChunk[];
    } else {
      rows = this.db
        .prepare("SELECT * FROM code_chunks")
        .all() as StoredChunk[];
    }

    const results: SearchResult[] = [];

    for (const row of rows) {
      const embBlob = (row as any).embedding as Buffer | null;
      if (!embBlob || embBlob.length === 0) continue;

      const storedVec: EmbeddingVector = {
        data: new Float64Array(new Uint8Array(embBlob).buffer),
        dim: queryEmbedding.dim,
      };

      const similarity = TfIdfVectorizer.cosineSimilarity(queryEmbedding, storedVec);
      if (similarity > 0.01) {
        // Strip embedding from result to save memory
        const chunk = { ...row };
        delete (chunk as any).embedding;
        results.push({ chunk: chunk as StoredChunk, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Find chunks similar to a given code snippet (for duplication detection).
   */
  findSimilar(
    code: string,
    threshold: number = 0.5,
    excludeFile?: string
  ): SearchResult[] {
    const results = this.search(code, 20);
    return results.filter(
      (r) =>
        r.similarity >= threshold &&
        (excludeFile ? r.chunk.file_path !== excludeFile : true)
    );
  }

  /**
   * Get all chunks for a file.
   */
  getFileChunks(filePath: string): StoredChunk[] {
    return this.db
      .prepare("SELECT id, file_path, chunk_content, chunk_type, chunk_name, start_line, end_line, project_path, created_at FROM code_chunks WHERE file_path = ?")
      .all(filePath) as StoredChunk[];
  }

  /**
   * Get stats about the indexed codebase.
   */
  getStats(): { totalChunks: number; totalFiles: number; projects: string[] } {
    const totalChunks = (
      this.db.prepare("SELECT COUNT(*) as c FROM code_chunks").get() as any
    ).c;
    const totalFiles = (
      this.db
        .prepare("SELECT COUNT(DISTINCT file_path) as c FROM code_chunks")
        .get() as any
    ).c;
    const projects = (
      this.db
        .prepare("SELECT DISTINCT project_path FROM code_chunks")
        .all() as { project_path: string }[]
    ).map((r) => r.project_path);

    return { totalChunks, totalFiles, projects };
  }

  /** Get the vectorizer (for external use e.g. in semantic supervisor) */
  getVectorizer(): TfIdfVectorizer {
    return this.vectorizer;
  }

  private saveVectorizerState(): void {
    const state = this.vectorizer.serialize();
    this.db.exec("DELETE FROM vectorizer_state");
    this.db.prepare("INSERT INTO vectorizer_state (id, state) VALUES (1, ?)").run(state);
  }

  private async walkDir(dir: string, maxDepth: number, depth = 0): Promise<string[]> {
    if (depth >= maxDepth) return [];
    const results: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "build")
          continue;
        const fullPath = join(dir, entry);
        try {
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            results.push(...(await this.walkDir(fullPath, maxDepth, depth + 1)));
          } else {
            results.push(fullPath);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
    return results;
  }
}
