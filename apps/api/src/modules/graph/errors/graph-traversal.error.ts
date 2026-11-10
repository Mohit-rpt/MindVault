import { AppError } from '../../../middleware/errorHandler.js';

export class GraphTraversalTimeoutError extends AppError {
  constructor(message = 'Graph traversal exceeded the 2500ms safety timeout') {
    super(504, 'GRAPH_TRAVERSAL_TIMEOUT', message);
    this.name = 'GraphTraversalTimeoutError';
    Object.setPrototypeOf(this, GraphTraversalTimeoutError.prototype);
  }
}

export class InvalidGraphQueryError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'INVALID_GRAPH_QUERY', message, details);
    this.name = 'InvalidGraphQueryError';
    Object.setPrototypeOf(this, InvalidGraphQueryError.prototype);
  }
}

export class ForbiddenWorkspaceError extends AppError {
  constructor(message = 'Access to graph resource in requested workspace is forbidden') {
    super(403, 'FORBIDDEN_WORKSPACE', message);
    this.name = 'ForbiddenWorkspaceError';
    Object.setPrototypeOf(this, ForbiddenWorkspaceError.prototype);
  }
}

export class EntityNotFoundError extends AppError {
  constructor(entityId: string) {
    super(
      404,
      'ENTITY_NOT_FOUND',
      `Graph entity with id '${entityId}' was not found in the workspace`,
    );
    this.name = 'EntityNotFoundError';
    Object.setPrototypeOf(this, EntityNotFoundError.prototype);
  }
}

export class RelationNotFoundError extends AppError {
  constructor(relationId: string) {
    super(
      404,
      'RELATION_NOT_FOUND',
      `Graph relation with id '${relationId}' was not found in the workspace`,
    );
    this.name = 'RelationNotFoundError';
    Object.setPrototypeOf(this, RelationNotFoundError.prototype);
  }
}
