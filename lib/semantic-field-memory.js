const SEMANTIC_FIELD_MEMORY_KEY = 'semanticFieldMemory';
const SEMANTIC_FIELD_MEMORY_LIMIT = 600;
const SEMANTIC_FIELD_MEMORY_MATCH_THRESHOLD = 5.1;
const SEMANTIC_FIELD_MEMORY_MIN_GAP = 0.35;

function normalizeSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()（）\-_/\\,.;:：，。?"'`~!@#$%^&*+=?|[\]{}<>]/g, ' ')
    .trim();
}

function normalizeComparable(value = '') {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function uniqueStrings(items = []) {
  return [...new Set((items || []).filter(Boolean))];
}

function buildCharNgrams(value = '', min = 2, max = 3) {
  const compact = normalizeComparable(value);
  if (!compact) return [];
  const grams = [];
  for (let size = min; size <= max; size += 1) {
    if (compact.length < size) continue;
    for (let index = 0; index <= compact.length - size; index += 1) {
      grams.push(compact.slice(index, index + size));
    }
  }
  return uniqueStrings(grams);
}

function tokenizeSearchText(value = '') {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const asciiWords = normalized.match(/[a-z0-9]{2,}/g) || [];
  const chineseChunks = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const chineseNgrams = chineseChunks.flatMap(chunk => buildCharNgrams(chunk, 2, 3));
  return uniqueStrings([...asciiWords, ...chineseChunks, ...chineseNgrams]);
}

function computeSetOverlapScore(left = [], right = []) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let hits = 0;
  for (const item of left) {
    if (rightSet.has(item)) hits += 1;
  }
  return hits / Math.max(left.length, 1);
}

function inferControlFamily(type = 'text') {
  switch (type) {
    case 'textarea':
      return 'longtext';
    case 'select':
    case 'radio':
    case 'checkbox':
      return 'choice';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

function areControlFamiliesCompatible(left = '', right = '') {
  if (!left || !right) return true;
  if (left === right) return true;
  if ((left === 'date' && right === 'text') || (left === 'text' && right === 'date')) return true;
  if ((left === 'longtext' && right === 'text') || (left === 'text' && right === 'longtext')) return true;
  return false;
}

function normalizeKeyTemplate(key = '') {
  return String(key || '').replace(/\[\d+\]/g, '[]');
}

function buildFieldMemoryText(field = {}) {
  return uniqueStrings([
    field.label,
    ...(field.labelCandidates || []).slice(0, 8),
    field.placeholder,
    field.name,
    field.title,
    field.helperText,
    field.sectionLabel,
    field.contextText,
    field.containerText,
  ]).join(' | ');
}

function buildFieldSectionText(field = {}) {
  return uniqueStrings([
    field.sectionLabel,
    field.contextText,
    field.containerText,
  ]).join(' | ');
}

function normalizeMemoryEntry(entry = {}) {
  const key = normalizeKeyTemplate(entry.key);
  const text = normalizeSearchText(entry.text || '');
  const sectionText = normalizeSearchText(entry.sectionText || '');
  const controlFamily = inferControlFamily(entry.controlFamily || entry.type || 'text');
  const hostname = String(entry.hostname || '').trim().toLowerCase();
  const signatureBase = `${key}::${normalizeComparable(text)}::${controlFamily}`;

  return {
    id: entry.id || `semantic_${Math.random().toString(36).slice(2, 10)}`,
    key,
    text,
    sectionText,
    label: String(entry.label || '').trim(),
    placeholder: String(entry.placeholder || '').trim(),
    controlFamily,
    hostname,
    observedCount: Number(entry.observedCount || 1),
    source: String(entry.source || 'regex'),
    lastSeenAt: entry.lastSeenAt || new Date().toISOString(),
    signature: entry.signature || signatureBase,
    textTokens: Array.isArray(entry.textTokens) ? uniqueStrings(entry.textTokens) : tokenizeSearchText(text),
    textNgrams: Array.isArray(entry.textNgrams) ? uniqueStrings(entry.textNgrams) : buildCharNgrams(text),
    sectionTokens: Array.isArray(entry.sectionTokens) ? uniqueStrings(entry.sectionTokens) : tokenizeSearchText(sectionText),
  };
}

function normalizeSemanticFieldMemory(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry && typeof entry === 'object' && entry.key)
    .map(normalizeMemoryEntry)
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)));
}

function buildSemanticFieldSample(field, key, options = {}) {
  if (!field || !key) return null;

  return normalizeMemoryEntry({
    key,
    text: buildFieldMemoryText(field),
    sectionText: buildFieldSectionText(field),
    label: field.label || '',
    placeholder: field.placeholder || '',
    controlFamily: inferControlFamily(field.type),
    hostname: options.hostname || '',
    source: options.source || 'regex',
    observedCount: options.observedCount || 1,
    lastSeenAt: options.lastSeenAt || new Date().toISOString(),
  });
}

function extractSemanticSamplesFromDebugExport(payload = {}, options = {}) {
  const hostname = String(payload?.page?.hostname || options.hostname || '').trim().toLowerCase();
  const source = options.source || 'debug_export';
  const samples = [];
  let matchedLearned = 0;
  let unmatchedLearned = 0;

  for (const entry of Array.isArray(payload?.matched) ? payload.matched : []) {
    if (!entry || entry.isFile || !entry.key || !entry.field) continue;
    const sample = buildSemanticFieldSample(entry.field, entry.key, {
      hostname,
      source: entry.matchMethod || source,
    });
    if (!sample) continue;
    samples.push(sample);
    matchedLearned += 1;
  }

  for (const entry of Array.isArray(payload?.unmatched) ? payload.unmatched : []) {
    if (!entry || !entry.field) continue;
    const key = entry.normalizedKey || entry.field.normalizedKey || '';
    if (!key) continue;
    if (!['missing_profile_value', 'unmapped_value'].includes(String(entry.reason || ''))) continue;

    const sample = buildSemanticFieldSample(entry.field, key, {
      hostname,
      source,
    });
    if (!sample) continue;
    samples.push(sample);
    unmatchedLearned += 1;
  }

  return {
    samples,
    stats: {
      hostname,
      matchedLearned,
      unmatchedLearned,
      totalLearned: samples.length,
    },
  };
}

function learnSemanticFieldMemory(existingEntries = [], samples = [], limit = SEMANTIC_FIELD_MEMORY_LIMIT) {
  const existing = normalizeSemanticFieldMemory(existingEntries);
  const nextBySignature = new Map(existing.map(entry => [entry.signature, entry]));

  for (const rawSample of samples) {
    const sample = normalizeMemoryEntry(rawSample);
    const current = nextBySignature.get(sample.signature);
    if (!current) {
      nextBySignature.set(sample.signature, sample);
      continue;
    }

    nextBySignature.set(sample.signature, {
      ...current,
      observedCount: current.observedCount + sample.observedCount,
      lastSeenAt: String(sample.lastSeenAt) > String(current.lastSeenAt) ? sample.lastSeenAt : current.lastSeenAt,
      hostname: current.hostname || sample.hostname,
      source: current.source || sample.source,
    });
  }

  return [...nextBySignature.values()]
    .sort((left, right) => {
      if (right.observedCount !== left.observedCount) return right.observedCount - left.observedCount;
      return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt));
    })
    .slice(0, limit);
}

function scoreSemanticFieldCandidate(field, entry, options = {}) {
  const fieldFamily = inferControlFamily(field.type);
  if (!areControlFamiliesCompatible(fieldFamily, entry.controlFamily)) return -Infinity;

  const fieldText = buildFieldMemoryText(field);
  const fieldSectionText = buildFieldSectionText(field);
  const fieldTokens = tokenizeSearchText(fieldText);
  const fieldNgrams = buildCharNgrams(fieldText);
  const fieldSectionTokens = tokenizeSearchText(fieldSectionText);

  const labelComparable = normalizeComparable(field.label || '');
  const entryLabelComparable = normalizeComparable(entry.label || '');
  const placeholderComparable = normalizeComparable(field.placeholder || '');
  const entryPlaceholderComparable = normalizeComparable(entry.placeholder || '');

  let score =
    computeSetOverlapScore(fieldTokens, entry.textTokens) * 4.2 +
    computeSetOverlapScore(fieldNgrams, entry.textNgrams) * 5.2 +
    computeSetOverlapScore(fieldSectionTokens, entry.sectionTokens) * 1.8;

  if (fieldFamily === entry.controlFamily) score += 1.1;

  if (labelComparable && entryLabelComparable) {
    if (labelComparable === entryLabelComparable) score += 2.8;
    else if (labelComparable.includes(entryLabelComparable) || entryLabelComparable.includes(labelComparable)) score += 1.3;
  }

  if (placeholderComparable && entryPlaceholderComparable) {
    if (placeholderComparable === entryPlaceholderComparable) score += 1.4;
    else if (
      placeholderComparable.includes(entryPlaceholderComparable) ||
      entryPlaceholderComparable.includes(placeholderComparable)
    ) score += 0.7;
  }

  if (options.hostname && entry.hostname && options.hostname === entry.hostname) score += 0.35;
  if (entry.observedCount > 1) score += Math.min(1.2, entry.observedCount * 0.15);

  return score;
}

function rankSemanticFieldCandidates(field, memoryEntries = [], options = {}) {
  const normalizedMemory = normalizeSemanticFieldMemory(memoryEntries);
  const bestByKey = new Map();

  for (const entry of normalizedMemory) {
    const score = scoreSemanticFieldCandidate(field, entry, options);
    if (!Number.isFinite(score)) continue;

    const current = bestByKey.get(entry.key);
    if (!current || score > current.score) {
      bestByKey.set(entry.key, {
        key: entry.key,
        score,
        hostname: entry.hostname,
        source: entry.source,
      });
    }
  }

  return [...bestByKey.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topK || 5);
}

function selectSemanticFieldCandidate(field, candidates = []) {
  if (!candidates.length) return null;

  const best = candidates[0];
  const runnerUp = candidates[1] || null;
  const gap = best.score - (runnerUp?.score || 0);

  if (best.score < SEMANTIC_FIELD_MEMORY_MATCH_THRESHOLD) return null;
  if (gap < SEMANTIC_FIELD_MEMORY_MIN_GAP) return null;

  return {
    key: best.key,
    score: best.score,
    source: 'semantic_memory',
  };
}

async function loadSemanticFieldMemory(storageArea = chrome.storage.local) {
  const result = await storageArea.get(SEMANTIC_FIELD_MEMORY_KEY);
  return normalizeSemanticFieldMemory(result[SEMANTIC_FIELD_MEMORY_KEY]);
}

export {
  SEMANTIC_FIELD_MEMORY_KEY,
  SEMANTIC_FIELD_MEMORY_LIMIT,
  SEMANTIC_FIELD_MEMORY_MATCH_THRESHOLD,
  buildFieldMemoryText,
  buildSemanticFieldSample,
  extractSemanticSamplesFromDebugExport,
  inferControlFamily,
  learnSemanticFieldMemory,
  loadSemanticFieldMemory,
  normalizeKeyTemplate,
  normalizeSemanticFieldMemory,
  rankSemanticFieldCandidates,
  selectSemanticFieldCandidate,
};
