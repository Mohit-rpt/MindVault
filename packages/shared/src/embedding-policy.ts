/**
 * MindVault — Phase 1B.4: Embedding Model Compatibility Policy
 *
 * Defines the authoritative compatibility rules for vector retrieval gating.
 *
 * Invariants:
 * 1. Embedding Space Orthogonality: Vectors from different models inhabit distinct,
 *    statistically orthogonal latent manifolds. Cross-model distance calculations
 *    yield mathematical noise and are strictly prohibited.
 * 2. Ollama / Legacy Compatibility: Ollama ('nomic-embed-text') queries match documents
 *    explicitly identified as 'nomic-embed-text' as well as legacy records where
 *    embeddingModel is NULL (historically embedded with nomic-embed-text).
 * 3. Gemini Isolation: Gemini ('gemini-embedding-2') queries match only documents
 *    explicitly identified as 'gemini-embedding-2'. NULL metadata and Ollama documents
 *    are strictly excluded.
 * 4. Unknown Model Exclusion: Unknown or unapproved model identities are never treated
 *    as compatible with Ollama, Gemini, or NULL records.
 */

export const APPROVED_EMBEDDING_MODELS = {
  OLLAMA_NOMIC: 'nomic-embed-text',
  GEMINI_PRIMARY: 'gemini-embedding-2',
  MOCK_TEST: 'mock-embed-768',
} as const;

export type ApprovedEmbeddingModel =
  (typeof APPROVED_EMBEDDING_MODELS)[keyof typeof APPROVED_EMBEDDING_MODELS];

export interface ModelFilterPolicy {
  /** The target model name bound as a parameterized SQL value */
  targetModel: string;
  /** Whether records with NULL embeddingModel match (true exclusively for Ollama legacy) */
  allowNullModel: boolean;
  /** Whether the requested model is an approved, recognized MindVault embedding model */
  isRecognized: boolean;
}

export interface SearchVectorChunksOptions {
  topK?: number;
  documentIds?: string[];
  fileTypes?: string[];
  pageStart?: number;
  pageEnd?: number;
  /**
   * The active embedding model used to generate the query vector.
   * If omitted or undefined, defaults to Ollama-compatible retrieval for backward compatibility.
   */
  embeddingModel?: string;
}

export class EmbeddingModelPolicy {
  public static readonly OLLAMA_DEFAULT_MODEL: string = APPROVED_EMBEDDING_MODELS.OLLAMA_NOMIC;
  public static readonly GEMINI_DEFAULT_MODEL: string = APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY;
  public static readonly MOCK_DEFAULT_MODEL: string = APPROVED_EMBEDDING_MODELS.MOCK_TEST;

  /**
   * Resolves the model-aware filtering policy for a query vector.
   *
   * @param modelName Optional requested model name. If omitted, defaults to Gemini.
   * @returns Resolved ModelFilterPolicy with parameterized values and null allowance.
   */
  public static resolveFilterPolicy(modelName?: string | null): ModelFilterPolicy {
    const effectiveModel = modelName?.trim() || this.GEMINI_DEFAULT_MODEL;

    if (effectiveModel === this.OLLAMA_DEFAULT_MODEL) {
      return {
        targetModel: this.OLLAMA_DEFAULT_MODEL,
        allowNullModel: true,
        isRecognized: true,
      };
    }

    if (effectiveModel === this.GEMINI_DEFAULT_MODEL) {
      return {
        targetModel: this.GEMINI_DEFAULT_MODEL,
        allowNullModel: false,
        isRecognized: true,
      };
    }

    if (effectiveModel === this.MOCK_DEFAULT_MODEL) {
      return {
        targetModel: this.MOCK_DEFAULT_MODEL,
        allowNullModel: true,
        isRecognized: true,
      };
    }

    // Unknown or unapproved model identifier
    return {
      targetModel: effectiveModel,
      allowNullModel: false,
      isRecognized: false,
    };
  }

  /**
   * Checks whether a document's stored embeddingModel is compatible with the query model.
   * Used for in-memory database filtering and unit test verification.
   *
   * @param queryModel The model used for the query vector (or undefined for default Ollama)
   * @param docEmbeddingModel The stored embeddingModel on the document (or null/undefined)
   * @returns boolean true if compatible, false otherwise
   */
  public static isDocumentCompatible(
    queryModel: string | undefined | null,
    docEmbeddingModel: string | null | undefined,
  ): boolean {
    const policy = this.resolveFilterPolicy(queryModel);

    // If query model is not recognized, it cannot match any document
    if (!policy.isRecognized) {
      return false;
    }

    // Document has null or empty model metadata
    if (!docEmbeddingModel || docEmbeddingModel.trim().length === 0) {
      return policy.allowNullModel;
    }

    // Document has explicit model metadata: must match targetModel exactly
    return docEmbeddingModel.trim() === policy.targetModel;
  }
}
