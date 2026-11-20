/**
 * MindVault — Phase 1B.0: Gemini API Preflight & Quota Diagnostic CLI
 *
 * Runs deterministic preflight verification of Google Gemini API readiness:
 * 1. Validates GEMINI_API_KEY without leaking secrets in terminal or logs.
 * 2. Probes project access to approved Phase 1B models (gemini-embedding-2, gemini-3.8-flash, etc.).
 * 3. Probes 768d embedding generation and unit-normalization invariants.
 * 4. Checks quota tiers and issues billing advisories (clarifying Google One / Jio consumer plan independence).
 *
 * Usage:
 *   pnpm exec tsx scripts/probe-gemini-quota.ts
 *
 * Exit Codes:
 *   0: Preflight passed (API ready for migration)
 *   1: Preflight failed (Action required before migration)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyGeminiPreflight,
  maskApiKey,
  APPROVED_MODELS,
} from '../apps/worker/src/lib/gemini-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Zero-dependency safe .env loader
function loadRootEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadRootEnv(path.resolve(rootDir, '.env'));

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

async function main() {
  console.log(`${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}   MINDVAULT PHASE 1B.0: GEMINI API PREFLIGHT & QUOTA PROBE             ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const rawKey = process.env.GEMINI_API_KEY;
  console.log(`API Key:   ${colors.bold}${maskApiKey(rawKey)}${colors.reset}`);
  console.log(`${colors.dim}Target Models: ${APPROVED_MODELS.join(', ')}${colors.reset}\n`);

  console.log(`[1/3] Probing Google Gemini API connectivity & credentials...`);
  const result = await verifyGeminiPreflight({
    apiKey: rawKey,
    requiredModels: APPROVED_MODELS,
    primaryEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    probeEmbedding: true,
  });

  // Print Model Status
  console.log(`\n[2/3] Model Access Inspection:`);
  for (const model of APPROVED_MODELS) {
    const isFound = result.modelsFound.includes(model);
    if (isFound) {
      console.log(`  ${colors.green}✔ Accessible:${colors.reset} ${model}`);
    } else {
      console.log(`  ${colors.yellow}⚠ Catalog Unconfirmed:${colors.reset} ${model} (Will probe directly during runtime)`);
    }
  }

  // Print Embedding Status
  console.log(`\n[3/3] Embedding Dimensionality & Unit Norm Probe:`);
  if (result.embeddingProbeSuccess) {
    console.log(`  ${colors.green}✔ Probe Embedding Call:${colors.reset} SUCCESS`);
    console.log(`  ${colors.green}✔ Output Dimension:${colors.reset}     ${result.embeddingDimension}d (matches vector(768))`);
    console.log(`  ${colors.green}✔ Euclidean Norm:${colors.reset}       ${result.embeddingNorm?.toFixed(6)} (Target: 1.000000 ± 0.000100)`);
  } else {
    console.log(`  ${colors.red}✖ Probe Embedding Call:${colors.reset} FAILED`);
    if (result.errorMessage) {
      console.log(`    ${colors.red}Error [${result.errorCategory}]:${colors.reset} ${result.errorMessage}`);
    }
  }

  // Print Warnings & Advisories
  if (result.warnings.length > 0) {
    console.log(`\n${colors.yellow}${colors.bold}Operational Warnings & Advisories:${colors.reset}`);
    for (const w of result.warnings) {
      console.log(`  • ${w}`);
    }
  }

  // Remediation
  if (result.remediationSteps.length > 0) {
    console.log(`\n${colors.cyan}${colors.bold}Actionable Remediation Steps:${colors.reset}`);
    for (const r of result.remediationSteps) {
      console.log(`  1. ${r}`);
    }
  }

  console.log(`\n${colors.bold}${colors.cyan}========================================================================${colors.reset}`);
  if (result.ok) {
    console.log(`${colors.green}${colors.bold}✔ PHASE 1B.0 PREFLIGHT PROBE: PASSED (Google Gemini API Ready)${colors.reset}`);
    console.log(`${colors.cyan}========================================================================${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.red}${colors.bold}✖ PHASE 1B.0 PREFLIGHT PROBE: FAILED (Action Required)${colors.reset}`);
    console.log(`${colors.cyan}========================================================================${colors.reset}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${colors.red}Unexpected preflight fatal error:${colors.reset}`, err);
  process.exit(1);
});
