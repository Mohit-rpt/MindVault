/**
 * MindVault Post-Phase — Stage 1.2: Evaluation Configuration
 *
 * Enforces strict isolation: connects exclusively to the dedicated evaluation
 * database `mindvault_eval` on port 5433, with real Ollama services.
 */

export const EVAL_CONFIG = {
  // Database configuration strictly isolated to mindvault_eval
  databaseUrl:
    process.env.EVAL_DATABASE_URL ||
    'postgresql://mindvault:mindvault_dev_password@localhost:5433/mindvault_eval?schema=public&connection_limit=10&pool_timeout=30',

  // Redis configuration
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Workspace and User isolation
  workspaceId: 'ws_real_world_eval_01',
  workspaceName: 'Real World RAG Evaluation Workspace',
  workspaceSlug: 'real-world-rag-eval-01',
  userId: 'usr_real_evaluator_01',
  userEmail: 'real-evaluator@mindvault.internal',
  userName: 'MindVault Real-World Evaluator',

  // Real Embedding Provider (Ollama)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  embeddingModel: 'nomic-embed-text',
  embeddingDimension: 768,

  // Generation Provider ('gemini' | 'ollama')
  generationProvider: (process.env.EVAL_GENERATION_PROVIDER || 'gemini') as 'gemini' | 'ollama',
  generationModel:
    process.env.EVAL_GENERATION_PROVIDER === 'ollama'
      ? process.env.OLLAMA_GENERATION_MODEL || 'qwen3:0.6b'
      : process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  generationTemperature: 0.1,
  generationMaxTokens: 1024,
  generationTimeoutMs: 30000,

  // Retrieval evaluation parameters
  topK: 5,
  maxContextTokens: 3000,
  narrativeFloorPct: 0.75,
  graphCeilingPct: 0.25,
  rrfK: 60,

  // Corpus and output paths
  corpusDir: 'evaluation/corpus',
  resultsDir: 'evaluation/results',
};
