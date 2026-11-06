/**
 * MindVault — Generation Engine: RAG Prompt Builder
 *
 * Formats question, evidence context blocks, and citation instructions with delimiter boundaries.
 */

import type { SearchContextDto } from '@mindvault/shared';

export interface RAGPromptBuilderOptions {
  query: string;
  context: SearchContextDto;
}

export class RAGPromptBuilder {
  public static readonly VERSION = 'v1.0';

  /**
   * Builds the formatted user prompt with delimited evidence blocks and citation instructions.
   */
  public static buildPrompt(options: RAGPromptBuilderOptions): string {
    const { query, context } = options;

    if (!context || context.sources.length === 0 || !context.content.trim()) {
      return `QUESTION: ${query}

<evidence>
NO EVIDENCE AVAILABLE
</evidence>

INSTRUCTIONS:
No document evidence was found in the workspace for this question.
You must state clearly that there is insufficient evidence in the uploaded documents to answer the question.`;
    }

    return `QUESTION:
${query}

<evidence>
${context.content}
</evidence>

INSTRUCTIONS:
1. Answer the question above using ONLY the facts and concepts stated in the <evidence> block.
2. For every statement you make, append the bracketed citation identifier of the source that supports it (e.g. [S1], [S2]).
3. Available citation identifiers for this query are: ${context.sources.map((s) => s.citationId).join(', ')}.
4. If the evidence does not provide enough information to fully answer the question, state:
   "Based on the provided documents, there is insufficient evidence to answer your question."
   and mention what is missing.
5. Provide a direct, well-structured response.`;
  }
}
