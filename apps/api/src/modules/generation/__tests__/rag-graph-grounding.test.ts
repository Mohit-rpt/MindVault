import { describe, it, expect } from 'vitest';
import { RAGPromptBuilder } from '../prompts/rag.prompt.js';
import { getSystemPrompt } from '../prompts/system.prompt.js';
import { ConversationalPromptBuilder } from '../../conversations/prompts/conversational.prompt.js';
import { CitationValidatorService } from '../services/citation-validator.service.js';
import { GroundingService } from '../services/grounding.service.js';
import type { SearchContextDto } from '@mindvault/shared';

describe('RAG Graph Epistemic Grounding & Citation Validation (Subtask 6.6.3.3)', () => {
  const sampleGraphContext: SearchContextDto = {
    content: `--- SOURCE [S1] | Document: CorporateBio.pdf (Chunk: 1) | Page: p. 5 ---
Jane Doe joined Acme Corporation as Chief Technology Officer in 2021.

<knowledge_graph_evidence>
- RELATION: "Jane Doe" --[CTO_OF]--> "Acme Corporation" (Confidence: 0.98, Depth: 1) [Supported by: [S1]]
</knowledge_graph_evidence>`,
    tokenEstimate: 75,
    sources: [
      {
        citationId: '[S1]',
        documentId: 'doc_1',
        documentName: 'CorporateBio.pdf',
        chunkId: 'chk_1',
        chunkIndex: 0,
        pageNumber: 5,
        pageRange: 'p. 5',
        section: 'Executive Team',
        content: 'Jane Doe joined Acme Corporation as Chief Technology Officer in 2021.',
        rank: 1,
        score: 0.045,
        retrievalSources: ['semantic', 'graph'],
        supportedRelationIds: ['rel_cto_1'],
      },
    ],
    graphRelations: [
      {
        relationId: 'rel_cto_1',
        sourceCanonicalName: 'Jane Doe',
        targetCanonicalName: 'Acme Corporation',
        relationType: 'CTO_OF',
        confidence: 0.98,
        depth: 1,
        supportingCitationIds: ['[S1]'],
        formattedProposition:
          '- RELATION: "Jane Doe" --[CTO_OF]--> "Acme Corporation" (Confidence: 0.98, Depth: 1) [Supported by: [S1]]',
      },
    ],
  };

  describe('Scenario 19: RAGPromptBuilder with Knowledge Graph Evidence', () => {
    it('should cleanly partition textual evidence and knowledge graph evidence into distinct XML blocks', () => {
      const prompt = RAGPromptBuilder.buildPrompt({
        query: 'What role does Jane Doe have at Acme Corporation?',
        context: sampleGraphContext,
      });

      // 1. Textual evidence is in <evidence>
      expect(prompt).toContain('<evidence>');
      expect(prompt).toContain('--- SOURCE [S1] | Document: CorporateBio.pdf');
      expect(prompt).toContain('</evidence>');

      // 2. Knowledge graph propositions are in dedicated <knowledge_graph_evidence>
      expect(prompt).toContain('<knowledge_graph_evidence>');
      expect(prompt).toContain('- RELATION: "Jane Doe" --[CTO_OF]--> "Acme Corporation"');
      expect(prompt).toContain('</knowledge_graph_evidence>');

      // 3. Delimiters do not bleed into each other
      const evidenceContent = prompt.split('<evidence>')[1].split('</evidence>')[0];
      expect(evidenceContent).not.toContain('<knowledge_graph_evidence>');

      // 4. Instructions reference both blocks and citation discipline
      expect(prompt).toContain('Available citation identifiers for this query are: [S1]');
      expect(prompt).toContain(
        'cite the supporting chunk identifier indicated in that proposition (e.g. [S1])',
      );
      expect(prompt).toContain('If a text chunk and a graph proposition contradict each other');
    });

    it('should include epistemic conflict resolution and anti-hallucination rules in SYSTEM_PROMPT_V1', () => {
      const systemPrompt = getSystemPrompt();

      expect(systemPrompt).toContain('GROUNDING INVARIANT:');
      expect(systemPrompt).toContain('<evidence> and <knowledge_graph_evidence>');
      expect(systemPrompt).toContain(
        'Do NOT extrapolate direct ownership, control, or causation across multi-hop relations',
      );
      expect(systemPrompt).toContain('CONFLICT RESOLUTION:');
      expect(systemPrompt).toContain(
        'If a text chunk and a graph proposition contradict each other',
      );
    });

    it('should support knowledge graph evidence in ConversationalPromptBuilder', () => {
      const prompt = ConversationalPromptBuilder.buildPrompt({
        userQuery: 'Who is their CTO?',
        contextualQuery: 'Acme Corporation CTO',
        context: sampleGraphContext,
      });

      expect(prompt).toContain('=== BEGIN UNTRUSTED RETRIEVED CONTEXT ===');
      expect(prompt).toContain('<knowledge_graph_evidence>');
      expect(prompt).toContain('- RELATION: "Jane Doe" --[CTO_OF]--> "Acme Corporation"');
      expect(prompt).toContain('=== END UNTRUSTED RETRIEVED CONTEXT ===');
      expect(prompt).toContain('including relations derived from knowledge graph propositions');
    });
  });

  describe('Scenario 20: Grounding & Citation Validation with Graph-Derived Propositions', () => {
    it('should successfully validate an answer citing [S1] derived from graph proposition without false negatives', () => {
      const answer = 'Jane Doe serves as the Chief Technology Officer of Acme Corporation [S1].';

      const validation = CitationValidatorService.validate(answer, sampleGraphContext.sources);

      expect(validation.citationIdsValid).toBe(true);
      expect(validation.citationsPresent).toBe(true);
      expect(validation.referencedCitationIds).toEqual(['[S1]']);
      expect(validation.unknownCitationIds).toEqual([]);
    });

    it('should evaluate answer with GroundingService and assign GROUNDED status when citing valid graph-supported chunk', () => {
      const answer = 'Jane Doe is the CTO of Acme Corporation, having joined in 2021 [S1].';

      const result = GroundingService.evaluateGrounding(answer, sampleGraphContext.sources);

      expect(result.groundingStatus).toBe('GROUNDED');
      expect(result.citationIdsValid).toBe(true);
      expect(result.referencedCitationIds).toEqual(['[S1]']);
      expect(result.unknownCitationIds).toEqual([]);
    });

    it('should flag hallucinated citation identifiers as CITATION_INVALID even if text mentions graph entities', () => {
      // Model mentions relation but cites non-existent [S99]
      const answer = 'Jane Doe is the CTO of Acme Corporation [S99].';

      const result = GroundingService.evaluateGrounding(answer, sampleGraphContext.sources);

      expect(result.groundingStatus).toBe('CITATION_INVALID');
      expect(result.citationIdsValid).toBe(false);
      expect(result.unknownCitationIds).toEqual(['[S99]']);
    });
  });
});
