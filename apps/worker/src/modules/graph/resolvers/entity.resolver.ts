/**
 * MindVault — Knowledge Graph: Deterministic Entity Resolver & Hardener
 *
 * Resolves extracted entities against the workspace graph:
 * 1. Disambiguates parenthetical context/aliases (e.g. "PostgreSQL (RDBMS)").
 * 2. Checks canonical entity table by normalized_name in workspace.
 * 3. Checks unified alias registry by normalized_alias in workspace.
 * 4. Checks extracted aliases while strictly enforcing generic stop-word blocklist
 *    and entity type compatibility to prevent false-positive merges.
 * 5. Safely creates or enriches GraphEntity records, deterministically merging
 *    entity types (upgrading generic to specific, preserving specific), descriptions,
 *    and monotonically non-decreasing confidence metadata.
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

const SPECIFIC_ENTITY_TYPES = new Set<EntityType>([
  'TECHNOLOGY',
  'ORGANIZATION',
  'PERSON',
  'LOCATION',
  'EVENT',
  'METRIC',
  'PRODUCT',
]);

const GENERIC_ENTITY_TYPES = new Set<EntityType>(['CONCEPT', 'CUSTOM']);

/**
 * Generic alias stop-word blocklist.
 * Overly broad, ambiguous, or functional terms that MUST NEVER serve as merge keys
 * during alias-based entity resolution to prevent catastrophic false-positive merges.
 */
export const GENERIC_ALIAS_BLOCKLIST: ReadonlySet<string> = new Set([
  'data',
  'database',
  'system',
  'app',
  'application',
  'model',
  'service',
  'tool',
  'process',
  'server',
  'client',
  'user',
  'file',
  'software',
  'platform',
  'framework',
  'library',
  'code',
  'component',
  'module',
  'architecture',
  'engine',
  'pipeline',
  'test',
  'api',
  'ui',
  'backend',
  'frontend',
  'infrastructure',
  'resource',
  'storage',
  'config',
  'network',
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

/**
 * Determines whether two entity types are compatible for alias-based merging.
 * - Generic types ('CONCEPT', 'CUSTOM') are compatible with any type.
 * - Identical specific types are compatible.
 * - Compatible domains (e.g. TECHNOLOGY and PRODUCT) are allowed.
 * - Incompatible specific types (e.g. PERSON vs LOCATION, TECHNOLOGY vs PERSON)
 *   MUST NOT be merged via aliases.
 */
export function isTypeCompatibleForMerge(typeA: EntityType, typeB: EntityType): boolean {
  if (typeA === typeB) return true;
  if (GENERIC_ENTITY_TYPES.has(typeA) || GENERIC_ENTITY_TYPES.has(typeB)) {
    return true;
  }
  if (
    (typeA === 'TECHNOLOGY' && typeB === 'PRODUCT') ||
    (typeA === 'PRODUCT' && typeB === 'TECHNOLOGY')
  ) {
    return true;
  }
  return false;
}

/**
 * Determines merged entity type deterministically:
 * - Upgrades generic types ('CONCEPT', 'CUSTOM') to specific types ('TECHNOLOGY', 'ORGANIZATION', etc.).
 * - Preserves established specific types if incoming extraction is generic.
 */
export function determineMergedType(
  existingType: EntityType,
  incomingType: EntityType,
): EntityType {
  if (existingType === incomingType) return existingType;
  if (GENERIC_ENTITY_TYPES.has(existingType) && SPECIFIC_ENTITY_TYPES.has(incomingType)) {
    return incomingType;
  }
  if (SPECIFIC_ENTITY_TYPES.has(existingType) && GENERIC_ENTITY_TYPES.has(incomingType)) {
    return existingType;
  }
  return existingType;
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
   * Enriches an existing entity record with updated type, description, and metadata.
   */
  private async enrichEntity(
    workspaceId: string,
    existing: GraphEntityRecord,
    extracted: ExtractedEntity,
    incomingType: EntityType,
  ): Promise<GraphEntityRecord> {
    const existingType = resolveEntityType(existing.entityType);
    const mergedType = determineMergedType(existingType, incomingType);
    const existingDesc = existing.description?.trim();
    const newDesc = extracted.description?.trim();

    // Enrich description if existing is missing/empty
    let updatedDesc = existingDesc;
    if (!existingDesc && newDesc) {
      updatedDesc = newDesc;
    }

    const prevConfidence =
      typeof existing.metadata?.confidence === 'number' ? existing.metadata.confidence : 0.8;
    const newConfidence = Math.max(prevConfidence, extracted.confidence ?? 0.8);

    const prevMentionCount =
      typeof existing.metadata?.mentionCount === 'number' ? existing.metadata.mentionCount : 1;

    const needsTypeUpdate = mergedType !== existing.entityType;
    const needsDescUpdate = updatedDesc !== existingDesc;

    if (needsTypeUpdate || needsDescUpdate || this.graphRepo.updateEntity) {
      const updatedMetadata = {
        ...(existing.metadata || {}),
        confidence: newConfidence,
        mentionCount: prevMentionCount + 1,
        lastSeenAt: new Date().toISOString(),
      };

      try {
        return await this.graphRepo.updateEntity(workspaceId, existing.id, {
          entityType: mergedType,
          description: updatedDesc,
          metadata: updatedMetadata,
        });
      } catch (err) {
        console.warn(`[EntityResolver] Failed to enrich entity ${existing.id}:`, err);
      }
    }

    return existing;
  }

  /**
   * Resolves an extracted entity against the workspace graph deterministically.
   */
  public async resolve(workspaceId: string, extracted: ExtractedEntity): Promise<ResolutionResult> {
    const rawName = extracted.name;

    // 1. Check parenthetical disambiguation: e.g. "PostgreSQL (RDBMS)" -> stem "PostgreSQL", alias "RDBMS"
    const { stem, alias: parentheticalAlias } = EntityNormalizer.extractDisambiguation(rawName);
    const canonicalCandidate = stem || rawName;
    const normalizedName = EntityNormalizer.normalize(canonicalCandidate);

    if (!normalizedName) {
      throw new Error(`Cannot resolve empty or invalid entity name: "${rawName}"`);
    }

    const incomingType = resolveEntityType(extracted.entityType);

    // Collect all discovered aliases
    const allDiscoveredAliases: string[] = [];
    if (extracted.aliases && Array.isArray(extracted.aliases)) {
      allDiscoveredAliases.push(...extracted.aliases);
    }
    if (parentheticalAlias) {
      allDiscoveredAliases.push(parentheticalAlias);
    }

    // Step 1: Look up exact canonical match in workspace
    const canonicalMatch = await this.graphRepo.findEntityByName(workspaceId, normalizedName);
    if (canonicalMatch) {
      const enriched = await this.enrichEntity(
        workspaceId,
        canonicalMatch,
        extracted,
        incomingType,
      );
      await this.attachDiscoveredAliases(workspaceId, enriched.id, allDiscoveredAliases);
      return {
        entity: enriched,
        isNew: false,
        resolvedBy: 'CANONICAL_NAME',
        matchedTerm: canonicalMatch.normalizedName,
      };
    }

    // Step 2: Look up exact alias match in workspace
    const aliasMatch = await this.graphRepo.findEntityByAlias(workspaceId, normalizedName);
    if (aliasMatch) {
      const enriched = await this.enrichEntity(workspaceId, aliasMatch, extracted, incomingType);
      await this.attachDiscoveredAliases(workspaceId, enriched.id, allDiscoveredAliases);
      return {
        entity: enriched,
        isNew: false,
        resolvedBy: 'ALIAS',
        matchedTerm: normalizedName,
      };
    }

    // Step 3: Check if any of the entity's aliases match an existing entity in the workspace
    for (const alias of allDiscoveredAliases) {
      const normAlias = EntityNormalizer.normalize(alias);
      if (!normAlias || normAlias.length < 2) continue;

      // False-positive merge prevention: skip generic stop-words
      if (GENERIC_ALIAS_BLOCKLIST.has(normAlias)) continue;

      const match =
        (await this.graphRepo.findEntityByName(workspaceId, normAlias)) ||
        (await this.graphRepo.findEntityByAlias(workspaceId, normAlias));

      if (match) {
        // False-positive merge prevention: verify entity type compatibility
        const matchType = resolveEntityType(match.entityType);
        if (!isTypeCompatibleForMerge(matchType, incomingType)) {
          continue;
        }

        const enriched = await this.enrichEntity(workspaceId, match, extracted, incomingType);
        await this.attachDiscoveredAliases(workspaceId, enriched.id, [
          rawName,
          canonicalCandidate,
          ...allDiscoveredAliases,
        ]);
        return {
          entity: enriched,
          isNew: false,
          resolvedBy: 'ALIAS',
          matchedTerm: normAlias,
        };
      }
    }

    // Step 4: Create a new GraphEntity in the workspace
    try {
      const created = await this.graphRepo.createEntity({
        workspaceId,
        canonicalName: canonicalCandidate.trim(),
        normalizedName,
        entityType: incomingType,
        description: extracted.description,
        metadata: {
          confidence: extracted.confidence ?? 0.8,
          mentionCount: 1,
          firstSeenAt: new Date().toISOString(),
        },
      });

      // Attach any provided synonyms/aliases
      await this.attachDiscoveredAliases(workspaceId, created.id, allDiscoveredAliases);

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
          const enriched = await this.enrichEntity(workspaceId, recheck, extracted, incomingType);
          await this.attachDiscoveredAliases(workspaceId, enriched.id, allDiscoveredAliases);
          return {
            entity: enriched,
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
   * Strips generic stop-words to prevent corrupting the alias index.
   */
  private async attachDiscoveredAliases(
    workspaceId: string,
    entityId: string,
    aliases?: string[],
  ): Promise<void> {
    if (!aliases || aliases.length === 0) return;

    for (const alias of aliases) {
      const normalizedAlias = EntityNormalizer.normalize(alias);
      if (!normalizedAlias || normalizedAlias.length < 2) continue;

      // Do NOT register generic stop-words as aliases
      if (GENERIC_ALIAS_BLOCKLIST.has(normalizedAlias)) continue;

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
