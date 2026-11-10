/**
 * MindVault — Knowledge Graph: Advisory Lock Utility & Key Derivation
 *
 * Implements deterministic 64-bit signed integer advisory lock key derivation
 * matching PostgreSQL's relation evidence trigger:
 * ('x' || substr(md5(workspace_id || ':' || relation_id), 1, 16))::bit(64)::bigint
 *
 * Enforces engine-level isolation between administrative locks and relational data locks:
 * - Administrative Leader Locks: pg_try_advisory_xact_lock(10064, 1/2)
 * - Relational Evidence Locks: pg_advisory_xact_lock(lock_key::bigint)
 */

import crypto from 'node:crypto';

/**
 * Computes a deterministic 64-bit signed integer advisory lock key.
 *
 * 1. Derives MD5 hex hash of `${workspaceId}:${relationId}` in UTF-8.
 * 2. Takes the first 16 hex characters (64 bits).
 * 3. Converts to 2's complement signed 64-bit BigInt to match PostgreSQL's ::bit(64)::bigint.
 */
export function computeRelationLockKey(workspaceId: string, relationId: string): bigint {
  const hex = crypto
    .createHash('md5')
    .update(`${workspaceId}:${relationId}`, 'utf8')
    .digest('hex')
    .slice(0, 16);

  const unsigned = BigInt(`0x${hex}`);
  return unsigned >= 0x8000000000000000n ? unsigned - 0x10000000000000000n : unsigned;
}

/**
 * Sorts relation objects in deterministic ascending numerical signed 64-bit lock order.
 * Prevents AB-BA deadlocks when acquiring multiple relation advisory locks within a transaction.
 */
export function sortRelationsByLockKey<T extends { lockKey: bigint }>(relations: T[]): T[] {
  return [...relations].sort((a, b) =>
    a.lockKey < b.lockKey ? -1 : a.lockKey > b.lockKey ? 1 : 0,
  );
}
