/**
 * MindVault — Knowledge Graph: Deterministic Entity Resolver
 *
 * Resolves extracted entities against the workspace graph:
 * 1. Checks canonical entity table by normalized_name in workspace.
 * 2. Checks unified alias registry by normalized_alias in workspace.
 * 3. Safely creates a new GraphEntity if no match exists, handling concurrent conflicts.
 * 4. Records newly discovered aliases without violating uniqueness constraints.
 */

import type {
  IGraphRepository,
  GraphEntityRecord,
} from '../repositories/graph.repository.interface.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import type { ExtractedEntity, EntityType } from '@mindvault/shared';

const VALID_ENTITY_TYPES = new Set<string>([
  'CONCEPT',
  'TECHNOLOGY',
  'ORGANIZATION',
  'PERSON',
  'LOCATION',
  'EVENT',
  'METRIC',
  'PRODUCT',
  'CUSTOM',
]);

/**
 * Validates and maps an extracted entity type string to a supported taxonomy value.
 * - Maps legacy 'OTHER' to 'CUSTOM'.
 * - Rejects arbitrary invalid types by throwing an error (never silently defaults to CONCEPT).
 */
export function resolveEntityType(rawType: string): EntityType {
  if (!rawType || typeof rawType !== 'string') {
    throw new Error(`Invalid entity type: "${rawType}". Entity type must be a non-empty string.`);
  }
  const upper = rawType.trim().toUpperCase();
  if (upper === 'OTHER') {
    return 'CUSTOM';
  }
  if (VALID_ENTITY_TYPES.has(upper)) {
    return upper as EntityType;
  }
  throw new Error(
    `Invalid entity type: "${rawType}". Expected one of: ${Array.from(VALID_ENTITY_TYPES).join(', ')}`,
  );
}

export interface ResolutionResult {
  entity: GraphEntityRecord;
  isNew: boolean;
  resolvedBy: 'CANONICAL_NAME' | 'ALIAS' | 'CREATED';
  matchedTerm: string;
}

export class EntityResolver {
  constructor(private readonly graphRepo: IGraphRepository) {}

  /**
   * Resolves an extracted entity against the workspace graph deterministically.
   */
  public async resolve(workspaceId: string, extracted: ExtractedEntity): Promise<ResolutionResult> {
    const rawName = extracted.name;
    const normalizedName = EntityNormalizer.normalize(rawName);

    if (!normalizedName) {
      throw new Error(`Cannot resolve empty or invalid entity name: "${rawName}"`);
    }

    // Step 1: Look up exact canonical match in workspace
    const canonicalMatch = await this.graphRepo.findEntityByName(workspaceId, normalizedName);
    if (canonicalMatch) {
      await this.attachDiscoveredAliases(workspaceId, canonicalMatch.id, extracted.aliases);
      return {
        entity: canonicalMatch,
        isNew: false,
        resolvedBy: 'CANONICAL_NAME',
        matchedTerm: canonicalMatch.normalizedName,
      };
    }

    // Step 2: Look up exact alias match in workspace
    const aliasMatch = await this.graphRepo.findEntityByAlias(workspaceId, normalizedName);
    if (aliasMatch) {
      await this.attachDiscoveredAliases(workspaceId, aliasMatch.id, extracted.aliases);
      return {
        entity: aliasMatch,
        isNew: false,
        resolvedBy: 'ALIAS',
        matchedTerm: normalizedName,
      };
    }

    // Step 3: Check if any of the entity's aliases match an existing entity in the workspace
    if (extracted.aliases && extracted.aliases.length > 0) {
      for (const alias of extracted.aliases) {
        const normAlias = EntityNormalizer.normalize(alias);
        if (!normAlias) continue;

        const match =
          (await this.graphRepo.findEntityByName(workspaceId, normAlias)) ||
          (await this.graphRepo.findEntityByAlias(workspaceId, normAlias));

        if (match) {
          await this.attachDiscoveredAliases(workspaceId, match.id, [
            rawName,
            ...extracted.aliases,
          ]);
          return {
            entity: match,
            isNew: false,
            resolvedBy: 'ALIAS',
            matchedTerm: normAlias,
          };
        }
      }
    }

    // Step 4: Create a new GraphEntity in the workspace
    try {
      const created = await this.graphRepo.createEntity({
        workspaceId,
        canonicalName: rawName.trim(),
        normalizedName,
        entityType: resolveEntityType(extracted.entityType),
        description: extracted.description,
      });

      // Attach any provided synonyms/aliases
      await this.attachDiscoveredAliases(workspaceId, created.id, extracted.aliases);

      return {
        entity: created,
        isNew: true,
        resolvedBy: 'CREATED',
        matchedTerm: normalizedName,
      };
    } catch (err: any) {
      // In case of concurrent creation race condition, re-fetch
      if (err.code === 'P2002' || err.meta?.code === '23505') {
        const recheck =
          (await this.graphRepo.findEntityByName(workspaceId, normalizedName)) ||
          (await this.graphRepo.findEntityByAlias(workspaceId, normalizedName));

        if (recheck) {
          await this.attachDiscoveredAliases(workspaceId, recheck.id, extracted.aliases);
          return {
            entity: recheck,
            isNew: false,
            resolvedBy: 'CANONICAL_NAME',
            matchedTerm: recheck.normalizedName,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Safely adds new aliases to the entity if they don't already exist or collide in the workspace.
   */
  private async attachDiscoveredAliases(
    workspaceId: string,
    entityId: string,
    aliases?: string[],
  ): Promise<void> {
    if (!aliases || aliases.length === 0) return;

    for (const alias of aliases) {
      const normalizedAlias = EntityNormalizer.normalize(alias);
      if (!normalizedAlias) continue;

      try {
        await this.graphRepo.createAlias({
          workspaceId,
          entityId,
          alias: alias.trim(),
          normalizedAlias,
          aliasType: 'SYNONYM',
        });
      } catch {
        // Ignored: If alias already exists or collides, do not fail entity resolution
      }
    }
  }
}
