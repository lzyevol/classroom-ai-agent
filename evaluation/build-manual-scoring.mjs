import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, 'results');
const casesPath = path.join(here, 'cases', 'core-cases.json');
const variants = ['A', 'B', 'C'];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('；') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readJsonl(file) {
  const text = (await fs.readFile(file, 'utf8')).trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

const files = await fs.readdir(resultsDir);
const manifestFiles = files.filter((name) => name.endsWith('-manifest.json'));
const manifests = [];
for (const name of manifestFiles) {
  const manifest = await readJson(path.join(resultsDir, name));
  manifests.push({ ...manifest, manifestFile: name, timestamp: Date.parse(manifest.createdAt) || 0 });
}

const selectedByVariant = {};
const selectionInfo = {};
for (const variant of variants) {
  const full = manifests
    .filter((manifest) => manifest.variants?.includes(variant))
    .filter((manifest) => manifest.summaries?.some((summary) => summary.variant === variant && summary.cases === 14 && summary.turns === 19))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!full) throw new Error(`No complete 14-case/19-turn run found for variant ${variant}`);

  const baseFile = full.resultFiles[variant];
  const rows = await readJsonl(path.join(resultsDir, baseFile));
  const byKey = new Map(rows.map((row) => [`${row.caseId}:${row.turnIndex}`, { ...row, sourceRunId: full.runId, sourceResultFile: baseFile }]));

  const overlays = manifests
    .filter((manifest) => manifest.timestamp > full.timestamp && manifest.variants?.includes(variant) && manifest.resultFiles?.[variant])
    .sort((a, b) => a.timestamp - b.timestamp);
  const applied = [];
  for (const overlay of overlays) {
    const overlayFile = overlay.resultFiles[variant];
    const overlayRows = await readJsonl(path.join(resultsDir, overlayFile));
    for (const row of overlayRows) {
      const key = `${row.caseId}:${row.turnIndex}`;
      if (!byKey.has(key)) continue;
      byKey.set(key, { ...row, sourceRunId: overlay.runId, sourceResultFile: overlayFile });
      applied.push({ caseId: row.caseId, turnIndex: row.turnIndex, runId: overlay.runId, resultFile: overlayFile });
    }
  }
  selectedByVariant[variant] = byKey;
  selectionInfo[variant] = { baseRunId: full.runId, baseResultFile: baseFile, overlays: applied };
}

const cases = await readJson(casesPath);
const orderedTurns = cases.flatMap((testCase) => testCase.turns.map((turn, turnIndex) => ({
  caseId: testCase.id,
  caseTitle: testCase.title,
  category: testCase.category,
  turnIndex,
  input: turn.input,
  expectedIntent: turn.intent,
})));

const scoreable = [];
for (const turn of orderedTurns) {
  if (turn.expectedIntent === 'stop' || turn.expectedIntent === 'acknowledgement') continue;
  for (const variant of variants) {
    const row = selectedByVariant[variant].get(`${turn.caseId}:${turn.turnIndex}`);
    if (!row) throw new Error(`Missing selected row ${variant}/${turn.caseId}/${turn.turnIndex}`);
    scoreable.push({ variant, turn, row, hash: crypto.createHash('sha256').update(`${turn.caseId}:${turn.turnIndex}:${variant}`).digest('hex') });
  }
}
scoreable.sort((a, b) => a.hash.localeCompare(b.hash));

const blindRows = scoreable.map((item, index) => ({
  sample_id: `S${String(index + 1).padStart(3, '0')}`,
  case_id: item.turn.caseId,
  turn_index: item.turn.turnIndex + 1,
  category: item.turn.category,
  student_input: item.turn.input,
  response: item.row.output,
  citation_labels: item.row.citationLabels,
  evidence_count: item.row.evidenceChunkIds?.length || 0,
  content_correctness_1_5: '',
  citation_correctness_0_1: '',
  teaching_adaptability_1_5: '',
  reviewer: '',
  notes: '',
}));

const keyRows = scoreable.map((item, index) => ({
  sample_id: `S${String(index + 1).padStart(3, '0')}`,
  variant: item.variant,
  case_id: item.turn.caseId,
  turn_index: item.turn.turnIndex + 1,
  expected_intent: item.turn.expectedIntent,
  detected_intent: item.row.detectedIntent,
  expected_agent_id: item.row.expectedAgentId,
  selected_agent_id: item.row.selectedAgentId,
  route_correct: item.row.routeCorrect,
  evidence_count: item.row.evidenceChunkIds?.length || 0,
  source_run_id: item.row.sourceRunId,
  source_result_file: item.row.sourceResultFile,
}));

const comparisonRows = orderedTurns.map((turn) => {
  const result = {
    case_id: turn.caseId,
    case_title: turn.caseTitle,
    category: turn.category,
    turn_index: turn.turnIndex + 1,
    student_input: turn.input,
    expected_intent: turn.expectedIntent,
  };
  for (const variant of variants) {
    const row = selectedByVariant[variant].get(`${turn.caseId}:${turn.turnIndex}`);
    result[`${variant}_response`] = row.output;
    result[`${variant}_agent`] = row.selectedAgentId;
    result[`${variant}_citations`] = row.citationLabels;
    result[`${variant}_evidence_count`] = row.evidenceChunkIds?.length || 0;
    result[`${variant}_route_correct`] = row.routeCorrect;
    result[`${variant}_model_calls`] = row.modelCalls;
    result[`${variant}_latency_ms`] = row.latencyMs;
    result[`${variant}_source_run`] = row.sourceRunId;
  }
  return result;
});

const stamp = new Date().toISOString().replaceAll(':', '-').replace('.000Z', 'Z');
const blindFile = `${stamp}-manual-scoring-blind.csv`;
const keyFile = `${stamp}-manual-scoring-key.csv`;
const comparisonFile = `${stamp}-abc-comparison.csv`;
const manifestFile = `${stamp}-scoring-manifest.json`;

const blindColumns = ['sample_id', 'case_id', 'turn_index', 'category', 'student_input', 'response', 'citation_labels', 'evidence_count', 'content_correctness_1_5', 'citation_correctness_0_1', 'teaching_adaptability_1_5', 'reviewer', 'notes'];
const keyColumns = ['sample_id', 'variant', 'case_id', 'turn_index', 'expected_intent', 'detected_intent', 'expected_agent_id', 'selected_agent_id', 'route_correct', 'evidence_count', 'source_run_id', 'source_result_file'];
const comparisonColumns = ['case_id', 'case_title', 'category', 'turn_index', 'student_input', 'expected_intent', ...variants.flatMap((variant) => [`${variant}_response`, `${variant}_agent`, `${variant}_citations`, `${variant}_evidence_count`, `${variant}_route_correct`, `${variant}_model_calls`, `${variant}_latency_ms`, `${variant}_source_run`])];

await fs.writeFile(path.join(resultsDir, blindFile), toCsv(blindColumns, blindRows), 'utf8');
await fs.writeFile(path.join(resultsDir, keyFile), toCsv(keyColumns, keyRows), 'utf8');
await fs.writeFile(path.join(resultsDir, comparisonFile), toCsv(comparisonColumns, comparisonRows), 'utf8');
await fs.writeFile(path.join(resultsDir, manifestFile), JSON.stringify({
  generatedAt: new Date().toISOString(),
  policy: 'latest complete run per variant, overlaid by newer targeted reruns for the same case/turn',
  scoreableSamples: blindRows.length,
  comparedTurns: comparisonRows.length,
  files: { blindFile, keyFile, comparisonFile },
  selection: selectionInfo,
}, null, 2), 'utf8');

console.log(JSON.stringify({ blindFile, keyFile, comparisonFile, manifestFile, scoreableSamples: blindRows.length, comparedTurns: comparisonRows.length }, null, 2));
