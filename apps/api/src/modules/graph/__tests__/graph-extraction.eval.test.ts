import { describe, it, expect } from 'vitest';
import { GraphExtractionEvalRunner } from '../evaluation/graph-extraction.eval.runner.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';
import { EXTRACTION_EVAL_DATASET } from '../evaluation/graph-extraction.eval.dataset.js';

describe('Phase 6.1: Knowledge Graph Extraction Evaluation Suite', () => {
  it('executes evaluation runner and computes precision, recall, F1, and provenance completeness', async () => {
    const provider = new MockExtractionProvider();
    const runner = new GraphExtractionEvalRunner(provider);

    const metrics = await runner.runEvaluation(EXTRACTION_EVAL_DATASET);

    expect(metrics.totalScenarios).toBe(11);

    // Entity Metrics
    expect(metrics.entityMetrics.truePositives).toBeGreaterThan(0);
    expect(metrics.entityMetrics.precision).toBeGreaterThanOrEqual(0.7);
    expect(metrics.entityMetrics.recall).toBeGreaterThanOrEqual(0.6);
    expect(metrics.entityMetrics.f1).toBeGreaterThanOrEqual(0.65);
    expect(metrics.entityMetrics.duplicateEntityRate).toBe(0);

    // Relation Metrics
    expect(metrics.relationMetrics.truePositives).toBeGreaterThan(0);
    expect(metrics.relationMetrics.precision).toBeGreaterThanOrEqual(0.6);
    expect(metrics.relationMetrics.recall).toBeGreaterThanOrEqual(0.5);
    expect(metrics.relationMetrics.f1).toBeGreaterThanOrEqual(0.55);
    expect(metrics.relationMetrics.duplicateRelationRate).toBe(0);

    // Reliability & Provenance Metrics
    expect(metrics.reliabilityMetrics.invalidStructuredOutputRate).toBe(0);
    expect(metrics.reliabilityMetrics.provenanceCompleteness).toBe(1.0); // 100% of relation evidence verified
  });

  it('measures invalid structured output rate correctly when provider fails or emits malformed output', async () => {
    const failingProvider = new MockExtractionProvider();
    failingProvider.simulateInvalidOutput(true);

    const runner = new GraphExtractionEvalRunner(failingProvider);
    const metrics = await runner.runEvaluation(EXTRACTION_EVAL_DATASET);

    // All scenarios should register as invalid output
    expect(metrics.reliabilityMetrics.invalidStructuredOutputRate).toBe(1.0);
    expect(metrics.entityMetrics.truePositives).toBe(0);
  });
});
