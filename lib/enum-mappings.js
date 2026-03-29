const VALUE_GROUPS = {
  yes: ['yes', 'y', 'true', '1', '是', '有', '已', '已是', '需要', '可以', '同意'],
  no: ['no', 'n', 'false', '0', '否', '无', '未', '不', '没有', '无需', '不同意'],
  male: ['male', 'm', '男', '男性', '先生'],
  female: ['female', 'f', '女', '女性', '女士'],
  fresh: ['应届', '应届生', 'fresh', 'freshgraduate'],
  previous: ['往届', '非应届', 'previous', 'experiencedgraduate'],
  married: ['已婚', 'married'],
  unmarried: ['未婚', '单身', 'unmarried', 'single'],
  partyMember: ['中共党员', '共产党员', '党员', 'partymember', 'ccpmember'],
  leagueMember: ['共青团员', '团员', 'leaguemember'],
  masses: ['群众', '普通群众', 'mass', 'masses'],
};

const FIELD_GROUPS = [
  { pattern: /(politicalstatus|political)/i, groups: ['partyMember', 'leagueMember', 'masses'] },
  { pattern: /(maritalstatus|marital)/i, groups: ['married', 'unmarried'] },
  { pattern: /(freshgraduatestatus|graduate)/i, groups: ['fresh', 'previous'] },
  { pattern: /(overseasstudy|studyabroad|hasoverseasstudy)/i, groups: ['yes', 'no'] },
  { pattern: /(gender|sex)/i, groups: ['male', 'female'] },
];

function normalizeComparableText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\-_/\\,.;:：，。'"`~!@#$%^&*+=?|[\]{}<>]/g, '');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function getFieldGroups(fieldKey = '') {
  return unique(
    FIELD_GROUPS
      .filter(entry => entry.pattern.test(fieldKey))
      .flatMap(entry => entry.groups)
  );
}

function getGroupForValue(rawValue = '') {
  const normalized = normalizeComparableText(rawValue);
  if (!normalized) return null;
  for (const [group, aliases] of Object.entries(VALUE_GROUPS)) {
    if (aliases.some(alias => normalizeComparableText(alias) === normalized)) return group;
  }
  return null;
}

function getAliasesForValue(fieldKey = '', rawValue = '', adapterAliases = {}) {
  const directGroup = getGroupForValue(rawValue);
  if (directGroup) {
    return unique([rawValue, ...(VALUE_GROUPS[directGroup] || []), ...(adapterAliases[directGroup] || [])]);
  }

  const fieldGroups = getFieldGroups(fieldKey);
  const normalized = normalizeComparableText(rawValue);
  for (const group of fieldGroups) {
    const aliases = [...(VALUE_GROUPS[group] || []), ...(adapterAliases[group] || [])];
    if (aliases.some(alias => normalizeComparableText(alias) === normalized)) {
      return unique([rawValue, ...aliases]);
    }
  }

  return unique([rawValue]);
}

function scoreOption(option, candidates) {
  const normalizedValue = normalizeComparableText(option?.value);
  const normalizedText = normalizeComparableText(option?.text);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeComparableText(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedValue === normalizedCandidate || normalizedText === normalizedCandidate) return 100;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeComparableText(candidate);
    if (!normalizedCandidate) continue;
    if (
      normalizedValue.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedValue) ||
      normalizedText.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedText)
    ) {
      return 60;
    }
  }

  const candidateGroup = getGroupForValue(candidates[0]);
  if (candidateGroup) {
    const optionGroup = getGroupForValue(option?.text) || getGroupForValue(option?.value);
    if (optionGroup && optionGroup === candidateGroup) return 80;
  }

  return 0;
}

function mapEnumValue({
  fieldKey = '',
  value,
  options = [],
  adapterAliases = {},
  adapterOverride = null,
} = {}) {
  if (value == null || value === '') {
    return { matched: false, mappedValue: null, reason: 'empty_value' };
  }

  if (!Array.isArray(options) || !options.length) {
    return { matched: true, mappedValue: String(value), reason: 'no_options' };
  }

  if (typeof adapterOverride === 'string' && adapterOverride) {
    return { matched: true, mappedValue: adapterOverride, reason: 'adapter_override' };
  }

  const candidates = getAliasesForValue(fieldKey, String(value), adapterAliases);
  const scored = options
    .map(option => ({ option, score: scoreOption(option, candidates) }))
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) {
    return { matched: false, mappedValue: null, reason: 'no_option_match', candidates };
  }

  return {
    matched: true,
    mappedValue: scored[0].option.value,
    matchedOption: scored[0].option,
    reason: scored[0].score >= 100 ? 'exact_match' : 'fuzzy_match',
    candidates,
  };
}

export {
  VALUE_GROUPS,
  getAliasesForValue,
  getFieldGroups,
  mapEnumValue,
  normalizeComparableText,
};
