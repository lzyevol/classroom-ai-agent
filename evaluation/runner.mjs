#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VARIANTS,
  runEvaluationCase,
  summarizeResults,
  summariesToCsv,
} from './lib/runner-core.mjs';

const currentFile = fileURLToPath(import.meta.url);
const evaluationDir = path.dirname(currentFile);
const repoRoot = path.dirname(evaluationDir);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return `
Classroom evaluation runner

Usage:
  node evaluation/runner.mjs --variant C --case confusion-001
  node evaluation/runner.mjs --variant all --model deepseek/deepseek-chat

Options:
  --variant A|B|C|all       Default: C
  --case CASE_ID            Run one case only
  --limit NUMBER            Run the first N selected cases
  --cases PATH              Default: evaluation/cases/core-cases.json
  --store-state PATH        Default: evaluation/fixtures/store-state.json
  --new-url URL             Default: EVAL_NEW_URL or http://127.0.0.1:3107
  --baseline-url URL        Default: EVAL_BASELINE_URL or http://127.0.0.1:3207
  --model MODEL             Default: EVAL_MODEL
  --api-key KEY             Default: EVAL_API_KEY
  --base-url URL            Default: EVAL_BASE_URL
  --timeout-ms NUMBER       Default: 90000
  --output-dir PATH         Default: evaluation/results
  --list                    List test cases without running
  --dry-run                 Validate configuration without calling APIs
  --help                    Show this help
`.trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function resolveInputPath(value, fallback) {
  return path.resolve(repoRoot, value || fallback);
}

function safeRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeVariantIds(value) {
  const normalized = String(value || 'C').toUpperCase();
  if (normalized === 'ALL') return ['A', 'B', 'C'];
  if (!VARIANTS[normalized]) {
    throw new Error(`Invalid --variant "${value}". Use A, B, C, or all.`);
  }
  return [normalized];
}

function assertCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Cases file must contain a non-empty JSON array.');
  }
  for (const testCase of cases) {
    if (!testCase.id || !testCase.category || !Array.isArray(testCase.turns)) {
      throw new Error(`Invalid case: ${JSON.stringify(testCase)}`);
    }
    for (const turn of testCase.turns) {
      if (!turn.input || !turn.intent) {
        throw new Error(`Invalid turn in case ${testCase.id}`);
      }
    }
  }
}

function endpointFor(variantId, options) {
  return VARIANTS[variantId].endpointKind === 'baseline'
    ? options.baselineUrl
    : options.newUrl;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const casesPath = resolveInputPath(args.cases, 'evaluation/cases/core-cases.json');
  const storeStatePath = resolveInputPath(
    args['store-state'],
    'evaluation/fixtures/store-state.json',
  );
  const outputDir = resolveInputPath(args['output-dir'], 'evaluation/results');
  const allCases = readJson(casesPath);
  const storeState = readJson(storeStatePath);
  assertCases(allCases);

  if (args.list) {
    for (const testCase of allCases) {
      console.log(`${testCase.id}	${testCase.category}	${testCase.title}`);
    }
    return;
  }

  let selectedCases = args.case
    ? allCases.filter((testCase) => testCase.id === args.case)
    : allCases;
  if (args.case && selectedCases.length === 0) {
    throw new Error(`Unknown case: ${args.case}`);
  }
  if (args.limit) {
    const limit = Number.parseInt(args.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit must be positive');
    selectedCases = selectedCases.slice(0, limit);
  }

  const variantIds = normalizeVariantIds(args.variant);
  const options = {
    newUrl: args['new-url'] || process.env.EVAL_NEW_URL || 'http://127.0.0.1:3107',
    baselineUrl:
      args['baseline-url'] || process.env.EVAL_BASELINE_URL || 'http://127.0.0.1:3207',
    model: args.model || process.env.EVAL_MODEL || '',
    apiKey: args['api-key'] || process.env.EVAL_API_KEY || '',
    baseUrl: args['base-url'] || process.env.EVAL_BASE_URL || '',
    timeoutMs: Number.parseInt(
      args['timeout-ms'] || process.env.EVAL_TIMEOUT_MS || '90000',
      10,
    ),
  };

  console.log(
    JSON.stringify(
      {
        variants: variantIds,
        cases: selectedCases.map((testCase) => testCase.id),
        endpoints: Object.fromEntries(
          variantIds.map((variantId) => [variantId, endpointFor(variantId, options)]),
        ),
        model: options.model || '(server configured)',
        apiKeyProvided: Boolean(options.apiKey),
        storeState: path.relative(repoRoot, storeStatePath),
      },
      null,
      2,
    ),
  );

  if (args['dry-run']) return;

  fs.mkdirSync(outputDir, { recursive: true });
  const runId = safeRunId();
  const allResults = [];
  const resultFiles = {};
  for (const variantId of variantIds) {
    const resultPath = path.join(outputDir, `${runId}-${variantId}.jsonl`);
    fs.writeFileSync(resultPath, '', 'utf8');
    resultFiles[variantId] = resultPath;

    console.log(`\n[${variantId}] ${VARIANTS[variantId].label}`);
    for (const testCase of selectedCases) {
      process.stdout.write(`  - ${testCase.id}: `);
      const rows = await runEvaluationCase({
        testCase,
        variantId,
        endpoint: endpointFor(variantId, options),
        storeState,
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
      });
      for (const row of rows) {
        const persisted = { runId, createdAt: new Date().toISOString(), ...row };
        allResults.push(persisted);
        fs.appendFileSync(resultPath, `${JSON.stringify(persisted)}\n`, 'utf8');
      }
      const error = rows.find((row) => row.error)?.error;
      console.log(error ? `ERROR ${error}` : `ok (${rows.length} turns)`);
    }
  }

  const summaries = summarizeResults(allResults);
  const summaryPath = path.join(outputDir, `${runId}-summary.csv`);
  fs.writeFileSync(summaryPath, summariesToCsv(summaries), 'utf8');
  const manifestPath = path.join(outputDir, `${runId}-manifest.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        variants: variantIds,
        caseIds: selectedCases.map((testCase) => testCase.id),
        model: options.model || null,
        endpoints: Object.fromEntries(
          variantIds.map((variantId) => [variantId, endpointFor(variantId, options)]),
        ),
        resultFiles: Object.fromEntries(
          Object.entries(resultFiles).map(([key, value]) => [key, path.basename(value)]),
        ),
        summaryFile: path.basename(summaryPath),
        summaries,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('\nSummary');
  console.table(summaries);
  console.log(`Results: ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
