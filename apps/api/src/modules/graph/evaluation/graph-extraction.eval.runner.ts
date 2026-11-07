/**
 * MindVault — Knowledge Graph: Extraction Quality Evaluation Runner
 *
 * Runs evaluation scenarios against an extraction provider and calculates:
 * - Entity Precision, Recall, and F1
 * - Relation Precision, Recall, and F1
 * - Invalid Structured-Output Rate
 * - Duplicate Entity Rate
 * - Duplicate Relation Rate
 * - Provenance Completeness (verbatim evidence grounded in chunk)
 */

import { EXTRACTION_EVAL_DATASET, type EvalScenario } from './graph-extraction.eval.dataset.js';
import type { IKnowledgeExtractionProvider } from '../providers/extraction-provider.interface.js';
import { createExtractionProvider } from '../providers/provider.factory.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import { KnowledgeExtractionResponseSchema } from '@mindvault/shared';

export interface EvaluationMetrics {
  totalScenarios: number;
  entityMetrics: {
    precision: number;
    recall: number;
    f1: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    duplicateEntityRate: number;
  };
  relationMetrics: {
    precision: number;
    recall: number;
    f1: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    duplicateRelationRate: number;
  };
  reliabilityMetrics: {
    invalidStructuredOutputRate: number;
    provenanceCompleteness: number;
    avgLatencyMs: number;
  };
}

export class GraphExtractionEvalRunner {
  constructor(private readonly provider: IKnowledgeExtractionProvider) {}

  public async runEvaluation(
    dataset: EvalScenario[] = EXTRACTION_EVAL_DATASET,
  ): Promise<EvaluationMetrics> {
    let entityTP = 0;
    let entityFP = 0;
    let entityFN = 0;
    let totalExtractedEntities = 0;
    let duplicateEntities = 0;

    let relationTP = 0;
    let relationFP = 0;
    let relationFN = 0;
    let totalExtractedRelations = 0;
    let duplicateRelations = 0;

    let invalidOutputs = 0;
    let totalEvidenceChecked = 0;
    let validEvidenceMatches = 0;
    let totalLatencyMs = 0;

    for (const scenario of dataset) {
      const startTime = performance.now();
      let rawOutput: any;

      try {
        rawOutput = await this.provider.extract(scenario.chunkText, {
          documentTitle: scenario.name,
          workspaceId: 'eval-workspace',
        });
      } catch {
        invalidOutputs++;
        continue;
      }

      totalLatencyMs += Math.round(performance.now() - startTime);

      const parsed = KnowledgeExtractionResponseSchema.safeParse(rawOutput);
      if (!parsed.success) {
        invalidOutputs++;
        continue;
      }

      const { entities, relations } = parsed.data;

      // 1. Entity Evaluation
      const expectedNormEntities = new Set(
        scenario.expectedEntities.map((e) => EntityNormalizer.normalize(e.name)),
      );
      // Also register expected aliases
      const aliasToCanonical = new Map<string, string>();
      for (const e of scenario.expectedEntities) {
        const canonicalNorm = EntityNormalizer.normalize(e.name);
        aliasToCanonical.set(canonicalNorm, canonicalNorm);
        if (e.aliases) {
          for (const a of e.aliases) {
            aliasToCanonical.set(EntityNormalizer.normalize(a), canonicalNorm);
          }
        }
      }

      const seenNormEntities = new Set<string>();

      for (const extractedEnt of entities) {
        totalExtractedEntities++;
        const normName = EntityNormalizer.normalize(extractedEnt.name);

        if (seenNormEntities.has(normName)) {
          duplicateEntities++;
        } else {
          seenNormEntities.add(normName);
        }

        const resolvedCanonical = aliasToCanonical.get(normName) || normName;
        if (expectedNormEntities.has(resolvedCanonical)) {
          entityTP++;
        } else {
          entityFP++;
        }
      }

      // Calculate false negatives (expected entities missed)
      for (const expectedNorm of expectedNormEntities) {
        let found = false;
        for (const extractedEnt of entities) {
          const normName = EntityNormalizer.normalize(extractedEnt.name);
          const resolved = aliasToCanonical.get(normName) || normName;
          if (resolved === expectedNorm) {
            found = true;
            break;
          }
        }
        if (!found) {
          entityFN++;
        }
      }

      // 2. Relation Evaluation
      const expectedRelationsSet = new Set(
        scenario.expectedRelations.map(
          (r) =>
            `${EntityNormalizer.normalize(r.sourceEntity)}|${EntityNormalizer.normalizeRelationType(r.relationType)}|${EntityNormalizer.normalize(r.targetEntity)}`,
        ),
      );

      const seenRelations = new Set<string>();

      for (const rel of relations) {
        totalExtractedRelations++;
        const normSrc = EntityNormalizer.normalize(rel.sourceEntity);
        const normTgt = EntityNormalizer.normalize(rel.targetEntity);
        const normType = EntityNormalizer.normalizeRelationType(rel.relationType);
        const relKey = `${normSrc}|${normType}|${normTgt}`;

        if (seenRelations.has(relKey)) {
          duplicateRelations++;
        } else {
          seenRelations.add(relKey);
        }

        if (expectedRelationsSet.has(relKey)) {
          relationTP++;
        } else {
          relationFP++;
        }

        // Provenance verification
        if (rel.evidence) {
          totalEvidenceChecked++;
          const normChunk = scenario.chunkText.toLowerCase().replace(/\s+/g, ' ');
          const normEv = rel.evidence.toLowerCase().replace(/\s+/g, ' ');
          const sub = normEv.slice(0, Math.min(normEv.length, 25));
          if (normChunk.includes(sub)) {
            validEvidenceMatches++;
          }
        }
      }

      // Calculate relation false negatives
      for (const expRel of scenario.expectedRelations) {
        const expKey = `${EntityNormalizer.normalize(expRel.sourceEntity)}|${EntityNormalizer.normalizeRelationType(expRel.relationType)}|${EntityNormalizer.normalize(expRel.targetEntity)}`;
        let found = false;
        for (const rel of relations) {
          const normSrc = EntityNormalizer.normalize(rel.sourceEntity);
          const normTgt = EntityNormalizer.normalize(rel.targetEntity);
          const normType = EntityNormalizer.normalizeRelationType(rel.relationType);
          if (`${normSrc}|${normType}|${normTgt}` === expKey) {
            found = true;
            break;
          }
        }
        if (!found) {
          relationFN++;
        }
      }
    }

    const entityPrecision = entityTP + entityFP > 0 ? entityTP / (entityTP + entityFP) : 0;
    const entityRecall = entityTP + entityFN > 0 ? entityTP / (entityTP + entityFN) : 0;
    const entityF1 =
      entityPrecision + entityRecall > 0
        ? (2 * (entityPrecision * entityRecall)) / (entityPrecision + entityRecall)
        : 0;

    const relationPrecision =
      relationTP + relationFP > 0 ? relationTP / (relationTP + relationFP) : 0;
    const relationRecall = relationTP + relationFN > 0 ? relationTP / (relationTP + relationFN) : 0;
    const relationF1 =
      relationPrecision + relationRecall > 0
        ? (2 * (relationPrecision * relationRecall)) / (relationPrecision + relationRecall)
        : 0;

    return {
      totalScenarios: dataset.length,
      entityMetrics: {
        precision: Math.round(entityPrecision * 1000) / 1000,
        recall: Math.round(entityRecall * 1000) / 1000,
        f1: Math.round(entityF1 * 1000) / 1000,
        truePositives: entityTP,
        falsePositives: entityFP,
        falseNegatives: entityFN,
        duplicateEntityRate:
          totalExtractedEntities > 0
            ? Math.round((duplicateEntities / totalExtractedEntities) * 1000) / 1000
            : 0,
      },
      relationMetrics: {
        precision: Math.round(relationPrecision * 1000) / 1000,
        recall: Math.round(relationRecall * 1000) / 1000,
        f1: Math.round(relationF1 * 1000) / 1000,
        truePositives: relationTP,
        falsePositives: relationFP,
        falseNegatives: relationFN,
        duplicateRelationRate:
          totalExtractedRelations > 0
            ? Math.round((duplicateRelations / totalExtractedRelations) * 1000) / 1000
            : 0,
      },
      reliabilityMetrics: {
        invalidStructuredOutputRate:
          dataset.length > 0 ? Math.round((invalidOutputs / dataset.length) * 1000) / 1000 : 0,
        provenanceCompleteness:
          totalEvidenceChecked > 0
            ? Math.round((validEvidenceMatches / totalEvidenceChecked) * 1000) / 1000
            : 1.0,
        avgLatencyMs:
          dataset.length - invalidOutputs > 0
            ? Math.round(totalLatencyMs / (dataset.length - invalidOutputs))
            : 0,
      },
    };
  }
}

// Standalone runner execution
if (
  process.argv[1]?.endsWith('graph-extraction.eval.runner.ts') ||
  process.argv[1]?.endsWith('graph-extraction.eval.runner.js')
) {
  const provider = createExtractionProvider('mock');
  const runner = new GraphExtractionEvalRunner(provider);
  runner.runEvaluation().then((metrics) => {
    console.log('\n📊 === MindVault Knowledge Graph Extraction Evaluation Report ===');
    console.log(JSON.stringify(metrics, null, 2));
  });
}
