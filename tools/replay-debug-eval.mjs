import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSemanticSamplesFromDebugExport, learnSemanticFieldMemory } from '../lib/semantic-field-memory.js';
import { normalizeProfile, setByPath } from '../lib/profile-schema.js';

const repoRootUrl = new URL('../', import.meta.url);
const repoRootPath = fileURLToPath(repoRootUrl);
const debugArgFiles = process.argv.slice(2).filter(Boolean);

function fileUrl(relativePath) {
  return new URL(relativePath, repoRootUrl).href;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()（）\-_/\\,.;:：，。?"'`~!@#$%^&*+=|[\]{}<>]+/g, ' ')
    .trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/\s+/g, '');
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function pickDebugFiles(allFiles) {
  if (debugArgFiles.length) {
    const expected = new Set(debugArgFiles.map(file => path.resolve(repoRootPath, file)));
    return allFiles.filter(file => expected.has(path.resolve(file)));
  }
  return allFiles;
}

async function discoverDebugFiles() {
  const entries = await fs.readdir(repoRootPath);
  return entries
    .filter(name => /^jobpilot-debug-.*\.json$/i.test(name))
    .map(name => path.join(repoRootPath, name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function readDebugPayload(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildReplayProfile(payload) {
  const profile = {};
  for (const entry of Array.isArray(payload?.matched) ? payload.matched : []) {
    if (!entry?.key || entry?.isFile || entry?.value == null || entry.value === '') continue;
    setByPath(profile, entry.key, entry.value);
  }
  return normalizeProfile(profile);
}

async function loadLabelMatcherForReplay({ semanticMemory, hostname }) {
  const storageData = {
    semanticFieldMemory: deepClone(semanticMemory),
  };

  globalThis.window = {};
  globalThis.document = {};
  globalThis.location = { href: `https://${hostname || 'example.com'}/`, hostname: hostname || 'example.com' };
  globalThis.chrome = {
    runtime: {
      getURL(relativePath) {
        return fileUrl(relativePath);
      },
      onMessage: {
        addListener() {},
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') {
            return { [keys]: deepClone(storageData[keys]) };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map(key => [key, deepClone(storageData[key])]));
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(
              Object.entries(keys).map(([key, defaultValue]) => [key, key in storageData ? deepClone(storageData[key]) : defaultValue])
            );
          }
          return deepClone(storageData);
        },
        async set(items) {
          Object.assign(storageData, deepClone(items));
        },
      },
    },
  };

  const moduleUrl = `${fileUrl('content/label-matcher.js')}?replay=${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await import(moduleUrl);
  return globalThis.window.__jobpilotMatchForms;
}

async function replayPayload(payload, semanticMemory = []) {
  const hostname = payload?.page?.hostname || 'example.com';
  const matchForms = await loadLabelMatcherForReplay({ semanticMemory, hostname });
  const profile = buildReplayProfile(payload);
  return matchForms({ forms: payload.forms || [] }, profile);
}

function summarizeReplay(result) {
  const diagnostics = result?.diagnostics || {};
  return {
    matched: result?.matched?.length || 0,
    unmatched: result?.unmatched?.length || 0,
    unmappedFields: diagnostics.unmappedFields?.length || 0,
    missingRequiredFields: diagnostics.missingRequiredFields?.length || 0,
    remainingUnmappedLabels: (diagnostics.unmappedFields || []).map(item => item.label),
  };
}

function fieldDisplayLabel(field = {}) {
  return field.label || field.name || field.id || '(unknown)';
}

function buildFieldClusterSignature(field = {}) {
  const label = compactText(field.label || field.name || field.id || '');
  const section = compactText(field.sectionLabel || '');
  const placeholder = compactText(field.placeholder || '');
  const type = String(field.type || 'unknown').toLowerCase();

  const weakLabel = !label || /^form_\d+_field_\d+$/.test(label) || label === '请输入' || label === '请选择';
  const labelPart = weakLabel ? placeholder || section || type : label;
  return [labelPart, section, type].filter(Boolean).join('::') || 'unknown';
}

function inferClusterCategory(field = {}) {
  const text = compactText([
    field.label,
    field.placeholder,
    field.sectionLabel,
    field.contextText,
    field.containerText,
  ].filter(Boolean).join(' '));
  const reason = String(field.reason || '').toLowerCase();

  if (reason === 'missing_profile_value') {
    return 'profile_gap';
  }

  if (/我已阅读并同意|声明|愿意接收|推送|是否接受|无实习经历|无项目经历|无获奖信息|至今/.test(text)) {
    return 'manual_or_no_autofill';
  }
  if (/开发语言|技术开发语言|外语考试|事业群|面试城市|招聘信息来源|大赛|竞赛|证明人|奖项类型|studylocation|就读地/.test(text)) {
    return 'schema_gap';
  }
  if (/时间|日期|起止/.test(text) && !/出生日期|毕业时间|入党时间/.test(text)) {
    return 'structural_control';
  }
  if (/form_\d+_field_\d+|请输入|请选择|搜索职位关键词/.test(text)) {
    return 'detector_or_label_gap';
  }
  return 'generic_unmapped';
}

function inferClusterRecommendation(category, cluster) {
  switch (category) {
    case 'profile_gap':
      return '字段已识别，但当前资料缺值，优先补充主资料或训练样本';
    case 'schema_gap':
      return '补 canonical schema 或 customFields 归档规则';
    case 'manual_or_no_autofill':
      return '保持人工确认，不建议默认自动填写';
    case 'structural_control':
      return '补结构启发式或控件交互逻辑';
    case 'detector_or_label_gap':
      return '优先修表单检测和标签提取质量';
    default:
      if (cluster.topCandidateKeys.length) return `优先检查 matcher 规则，候选 ${cluster.topCandidateKeys.join(', ')}`;
      return '补通用 alias 或继续积累样本';
  }
}

function buildTopCandidateKeys(field = {}) {
  return uniqueStrings((field.candidateHints || []).map(item => item.key).filter(Boolean)).slice(0, 3);
}

function buildClusterSummary(results, replayMode = 'trained', limit = 12) {
  const clusters = new Map();

  for (const item of results) {
    const replay = replayMode === 'trained' ? item.trainedRaw : item.baselineRaw;
    for (const unmatched of replay?.unmatched || []) {
      const field = unmatched.field || {};
      const signature = buildFieldClusterSignature(field);
      const current = clusters.get(signature) || {
        signature,
        count: 0,
        hostnames: new Set(),
        files: new Set(),
        labels: new Set(),
        sections: new Set(),
        types: new Set(),
        reasons: new Set(),
        topCandidateKeys: new Set(),
        examples: [],
      };

      current.count += 1;
      if (item.hostname) current.hostnames.add(item.hostname);
      current.files.add(item.file);
      current.labels.add(fieldDisplayLabel(field));
      if (field.sectionLabel) current.sections.add(field.sectionLabel);
      if (field.type) current.types.add(field.type);
      if (unmatched.reason) current.reasons.add(unmatched.reason);
      for (const candidate of buildTopCandidateKeys(field)) current.topCandidateKeys.add(candidate);
      if (current.examples.length < 3) {
        current.examples.push({
          file: item.file,
          hostname: item.hostname,
          label: fieldDisplayLabel(field),
          section: field.sectionLabel || '',
          type: field.type || '',
          placeholder: field.placeholder || '',
          candidateHints: (field.candidateHints || []).slice(0, 3),
        });
      }
      clusters.set(signature, current);
    }
  }

  return [...clusters.values()]
    .map(cluster => {
      const category = inferClusterCategory(cluster.examples[0] || {});
      const normalized = {
        signature: cluster.signature,
        count: cluster.count,
        hostnames: [...cluster.hostnames].sort(),
        files: [...cluster.files].sort(),
        labels: [...cluster.labels].sort(),
        sections: [...cluster.sections].sort(),
        types: [...cluster.types].sort(),
        reasons: [...cluster.reasons].sort(),
        topCandidateKeys: [...cluster.topCandidateKeys].sort(),
        examples: cluster.examples,
        category,
      };
      normalized.recommendation = inferClusterRecommendation(category, normalized);
      return normalized;
    })
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.signature.localeCompare(right.signature);
    })
    .slice(0, limit);
}

function createClusterTable(clusters) {
  const header = '| 类别 | 次数 | 标签示例 | 站点 | 建议 |';
  const divider = '| --- | ---: | --- | --- | --- |';
  const rows = clusters.map(cluster => (
    `| ${cluster.category} | ${cluster.count} | ${cluster.labels.slice(0, 2).join(' / ')} | ${cluster.hostnames.join(', ')} | ${cluster.recommendation} |`
  ));
  return [header, divider, ...rows].join('\n');
}

function buildTrainingMemory(payloads, targetIndex) {
  const samples = [];
  for (let index = 0; index < payloads.length; index += 1) {
    if (index === targetIndex) continue;
    const extracted = extractSemanticSamplesFromDebugExport(payloads[index]);
    samples.push(...extracted.samples);
  }
  return learnSemanticFieldMemory([], samples);
}

function summarizeImprovement(originalSummary, baselineSummary, trainedSummary) {
  return {
    fromOriginalMatched: trainedSummary.matched - (originalSummary?.matched || 0),
    fromBaselineMatched: trainedSummary.matched - baselineSummary.matched,
    baselineUnmappedReduction: baselineSummary.unmappedFields - trainedSummary.unmappedFields,
    baselineMissingRequiredReduction: baselineSummary.missingRequiredFields - trainedSummary.missingRequiredFields,
  };
}

function createTable(results) {
  const header = '| 文件 | 原始命中 | 当前基线 | 训练后 | 未映射下降 | 必填缺失下降 |';
  const divider = '| --- | ---: | ---: | ---: | ---: | ---: |';
  const rows = results.map(item => (
    `| ${item.file} | ${item.original.matched}/${item.original.totalFields} | ${item.baseline.matched}/${item.original.totalFields} | ${item.trained.matched}/${item.original.totalFields} | ${item.improvement.baselineUnmappedReduction} | ${item.improvement.baselineMissingRequiredReduction} |`
  ));
  return [header, divider, ...rows].join('\n');
}

const debugFiles = pickDebugFiles(await discoverDebugFiles());
if (!debugFiles.length) {
  console.error('No debug files found.');
  process.exit(1);
}

const payloads = [];
for (const filePath of debugFiles) {
  payloads.push(await readDebugPayload(filePath));
}

const results = [];
for (let index = 0; index < debugFiles.length; index += 1) {
  const payload = payloads[index];
  const baselineRaw = await replayPayload(payload, []);
  const baseline = summarizeReplay(baselineRaw);
  const trainedMemory = buildTrainingMemory(payloads, index);
  const trainedRaw = await replayPayload(payload, trainedMemory);
  const trained = summarizeReplay(trainedRaw);
  const original = {
    matched: payload?.summary?.matched || 0,
    totalFields: payload?.summary?.totalFields || payload?.forms?.reduce((sum, form) => sum + (form.fieldCount || form.fields?.length || 0), 0) || 0,
  };

  results.push({
    file: path.basename(debugFiles[index]),
    hostname: payload?.page?.hostname || '',
    original,
    baseline,
    baselineRaw,
    trained,
    trainedRaw,
    trainingSamples: trainedMemory.length,
    improvement: summarizeImprovement(payload?.summary || {}, baseline, trained),
  });
}

const aggregate = results.reduce((acc, item) => {
  acc.originalMatched += item.original.matched;
  acc.totalFields += item.original.totalFields;
  acc.baselineMatched += item.baseline.matched;
  acc.trainedMatched += item.trained.matched;
  acc.baselineUnmapped += item.baseline.unmappedFields;
  acc.trainedUnmapped += item.trained.unmappedFields;
  acc.baselineMissing += item.baseline.missingRequiredFields;
  acc.trainedMissing += item.trained.missingRequiredFields;
  return acc;
}, {
  originalMatched: 0,
  totalFields: 0,
  baselineMatched: 0,
  trainedMatched: 0,
  baselineUnmapped: 0,
  trainedUnmapped: 0,
  baselineMissing: 0,
  trainedMissing: 0,
});

const trainedClusters = buildClusterSummary(results, 'trained');
const baselineClusters = buildClusterSummary(results, 'baseline');

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'leave-one-out',
  files: results.map(item => ({
    file: item.file,
    hostname: item.hostname,
    original: item.original,
    baseline: item.baseline,
    trained: item.trained,
    trainingSamples: item.trainingSamples,
    improvement: item.improvement,
  })),
  aggregate: {
    originalMatched: aggregate.originalMatched,
    baselineMatched: aggregate.baselineMatched,
    trainedMatched: aggregate.trainedMatched,
    totalFields: aggregate.totalFields,
    baselineUnmapped: aggregate.baselineUnmapped,
    trainedUnmapped: aggregate.trainedUnmapped,
    baselineMissingRequiredFields: aggregate.baselineMissing,
    trainedMissingRequiredFields: aggregate.trainedMissing,
  },
  topClusters: {
    baseline: baselineClusters,
    trained: trainedClusters,
  },
};

const markdownReport = [
  '# Debug Replay Evaluation',
  '',
  `Mode: ${report.mode}`,
  `Generated: ${report.generatedAt}`,
  '',
  createTable(results.map(item => ({
    file: item.file,
    original: item.original,
    baseline: item.baseline,
    trained: item.trained,
    improvement: item.improvement,
  }))),
  '',
  '## Aggregate',
  '',
  `- Original matched: ${aggregate.originalMatched}/${aggregate.totalFields}`,
  `- Current baseline matched: ${aggregate.baselineMatched}/${aggregate.totalFields}`,
  `- Trained replay matched: ${aggregate.trainedMatched}/${aggregate.totalFields}`,
  `- Baseline unmapped fields: ${aggregate.baselineUnmapped}`,
  `- Trained unmapped fields: ${aggregate.trainedUnmapped}`,
  `- Baseline missing required fields: ${aggregate.baselineMissing}`,
  `- Trained missing required fields: ${aggregate.trainedMissing}`,
  '',
  '## Top Remaining Clusters',
  '',
  createClusterTable(trainedClusters),
  '',
].join('\n');

await fs.mkdir(path.join(repoRootPath, 'docs'), { recursive: true });
await fs.writeFile(path.join(repoRootPath, 'docs', 'debug-replay-eval-latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRootPath, 'docs', 'debug-replay-eval-latest.md'), `${markdownReport}\n`, 'utf8');

console.log('# Debug Replay Evaluation');
console.log('');
console.log(`Mode: leave-one-out`);
console.log(`Generated: ${report.generatedAt}`);
console.log('');
console.log(createTable(results));
console.log('');
console.log('## Aggregate');
console.log('');
console.log(`- Original matched: ${aggregate.originalMatched}/${aggregate.totalFields}`);
console.log(`- Current baseline matched: ${aggregate.baselineMatched}/${aggregate.totalFields}`);
console.log(`- Trained replay matched: ${aggregate.trainedMatched}/${aggregate.totalFields}`);
console.log(`- Baseline unmapped fields: ${aggregate.baselineUnmapped}`);
console.log(`- Trained unmapped fields: ${aggregate.trainedUnmapped}`);
console.log(`- Baseline missing required fields: ${aggregate.baselineMissing}`);
console.log(`- Trained missing required fields: ${aggregate.trainedMissing}`);
console.log('');
console.log('## Top Remaining Clusters');
console.log('');
console.log(createClusterTable(trainedClusters));
console.log('');
console.log('## JSON');
console.log(JSON.stringify(report, null, 2));
