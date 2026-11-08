/**
 * MindVault — Knowledge Graph: Extraction Fenced Error
 *
 * Thrown whenever transactional document-level fencing, active extractionRunId fencing,
 * worker attempt ownership, lease expiration, terminal receipt existence, or content manifest
 * validation fails during chunk persistence or finalization.
 *
 * Triggers an immediate transaction ROLLBACK and prevents stale or superseded workers
 * from advancing checkpoints or persisting graph records.
 */

export class ExtractionFencedError extends Error {
  public readonly code = 'EXTRACTION_FENCED';

  constructor(message: string) {
    super(message);
    this.name = 'ExtractionFencedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
