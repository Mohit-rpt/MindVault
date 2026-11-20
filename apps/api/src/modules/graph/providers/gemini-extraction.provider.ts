/**
 * MindVault — Knowledge Graph: Google Gemini Extraction Provider
 *
 * Authoritative implementation resides in @mindvault/shared to ensure
 * consistency, unified testing, and zero drift across API and Worker.
 */

export {
  GeminiExtractionProvider,
  type GeminiExtractionConfig,
  type GeminiExtractionConfig as GeminiExtractionOptions,
  type IKnowledgeExtractionProvider,
  type ExtractionContext,
  GeminiExtractionSchemaError,
  GeminiNotFoundError,
  GeminiError,
} from '@mindvault/shared';

