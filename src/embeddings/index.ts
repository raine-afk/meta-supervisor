/**
 * TF-IDF Embeddings — Pure TypeScript vector embeddings for code
 *
 * Strategy: tokenize code into meaningful tokens, build TF-IDF vectors,
 * use cosine similarity for comparison. No external dependencies.
 *
 * Structured so a Gemini/OpenAI embedding backend can be swapped in later.
 */

export interface EmbeddingVector {
  /** Sparse vector: token → weight */
  data: Float64Array;
  /** Dimension of the vector (vocabulary size at creation time) */
  dim: number;
}

/**
 * Tokenize a code snippet into meaningful tokens.
 * Splits on camelCase, snake_case, punctuation, and whitespace.
 * Lowercases everything for normalization.
 */
export function tokenize(code: string): string[] {
  // Replace string literals with placeholder
  let cleaned = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, " STR_LITERAL ");
  // Replace numbers
  cleaned = cleaned.replace(/\b\d+\.?\d*\b/g, " NUM_LITERAL ");

  // Split camelCase and PascalCase
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, "$1 $2");
  cleaned = cleaned.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  // Split on non-alphanumeric (keep underscores as split points too)
  const raw = cleaned
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2); // drop single chars

  return raw;
}

/**
 * A simple TF-IDF vectorizer that can be incrementally trained.
 */
export class TfIdfVectorizer {
  /** token → index in vocabulary */
  private vocab: Map<string, number> = new Map();
  /** document frequency: how many docs contain each token */
  private df: Map<string, number> = new Map();
  /** total documents seen */
  private totalDocs = 0;

  /**
   * Add documents to the corpus (updates DF counts).
   * Call this during indexing.
   */
  addDocuments(documents: string[]): void {
    for (const doc of documents) {
      this.totalDocs++;
      const tokens = new Set(tokenize(doc));
      for (const t of tokens) {
        this.df.set(t, (this.df.get(t) || 0) + 1);
        if (!this.vocab.has(t)) {
          this.vocab.set(t, this.vocab.size);
        }
      }
    }
  }

  /**
   * Generate a TF-IDF vector for a single document.
   */
  embed(text: string): EmbeddingVector {
    const tokens = tokenize(text);
    const dim = this.vocab.size;
    if (dim === 0) {
      return { data: new Float64Array(0), dim: 0 };
    }

    const vec = new Float64Array(dim);

    // Count term frequencies
    const tf: Map<string, number> = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    const totalTerms = tokens.length || 1;

    for (const [token, count] of tf) {
      const idx = this.vocab.get(token);
      if (idx === undefined) continue;

      const termFreq = count / totalTerms;
      const docFreq = this.df.get(token) || 1;
      const idf = Math.log(1 + this.totalDocs / docFreq);
      vec[idx] = termFreq * idf;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) vec[i] /= norm;
    }

    return { data: vec, dim };
  }

  /**
   * Compute cosine similarity between two vectors.
   * Both must have the same dimension.
   */
  static cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.dim === 0 || b.dim === 0) return 0;
    const minDim = Math.min(a.data.length, b.data.length);
    let dot = 0;
    for (let i = 0; i < minDim; i++) {
      dot += a.data[i] * b.data[i];
    }
    // Vectors are already L2-normalized, so dot product = cosine similarity
    return dot;
  }

  /** Vocabulary size */
  get vocabSize(): number {
    return this.vocab.size;
  }

  /** Total documents indexed */
  get documentCount(): number {
    return this.totalDocs;
  }

  /** Serialize the vectorizer state for persistence */
  serialize(): string {
    return JSON.stringify({
      vocab: [...this.vocab.entries()],
      df: [...this.df.entries()],
      totalDocs: this.totalDocs,
    });
  }

  /** Restore from serialized state */
  static deserialize(data: string): TfIdfVectorizer {
    const v = new TfIdfVectorizer();
    const parsed = JSON.parse(data);
    v.vocab = new Map(parsed.vocab);
    v.df = new Map(parsed.df);
    v.totalDocs = parsed.totalDocs;
    return v;
  }
}
