const enumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));

const FIELD_RULES = [
  { pattern: /^(姓名|名字|full\s*name|applicant\s*name)$/i, key: 'personal.fullName' },
  { pattern: /(姓名拼音|名字拼音|name\s*pinyin|full\s*name\s*pinyin|pinyin)/i, key: 'personal.fullNamePinyin' },
  { pattern: /(英文名|english\s*name)/i, key: 'personal.englishName' },
  { pattern: /(last\s*name|family\s*name|surname|姓)/i, key: 'personal.lastName' },
  { pattern: /(first\s*name|given\s*name|名)/i, key: 'personal.firstName' },
  { pattern: /(性别|gender|sex)/i, key: 'personal.gender' },
  { pattern: /(出生日期|生日|birth|date\s*of\s*birth)/i, key: 'personal.birthDate' },
  { pattern: /(年龄|age)/i, key: 'personal.age' },
  { pattern: /(国籍|nationality|citizenship)/i, key: 'personal.nationality' },
  { pattern: /(民族|ethnicity)/i, key: 'personal.ethnicity' },
  { pattern: /(籍贯|native\s*place|hometown|生源地)/i, key: 'personal.nativePlace' },
  { pattern: /(政治面貌|政治身份|political\s*status|party)/i, key: 'personal.politicalStatus' },
  { pattern: /(入党时间|party\s*join)/i, key: 'personal.partyJoinDate' },
  { pattern: /(婚姻状况|marital)/i, key: 'personal.maritalStatus' },
  { pattern: /(健康状况|health)/i, key: 'personal.healthStatus' },
  { pattern: /(血型|blood\s*type)/i, key: 'personal.bloodType' },
  { pattern: /(身高|height)/i, key: 'personal.heightCm' },
  { pattern: /(体重|weight)/i, key: 'personal.weightKg' },
  { pattern: /(应届|往届|fresh\s*graduate|graduate\s*status)/i, key: 'personal.freshGraduateStatus' },
  { pattern: /(海外留学|overseas\s*study|study\s*abroad)/i, key: 'personal.hasOverseasStudy' },

  { pattern: /(证件类型|document\s*type|id\s*type)/i, key: 'identity.documentType' },
  { pattern: /(证件号码|身份证|id\s*(card|number)|document\s*number)/i, key: 'identity.documentNumber' },

  { pattern: /(手机|电话|mobile|phone|tel(?!ephone))/i, key: 'contact.phone' },
  { pattern: /(邮箱|e-?mail|电子邮件)/i, key: 'contact.email' },
  { pattern: /(固定电话|landline)/i, key: 'contact.landline' },
  { pattern: /(通讯地址|联系地址|mailing\s*address)/i, key: 'contact.address' },
  { pattern: /(邮编|postal\s*code|zip)/i, key: 'contact.postalCode' },
  { pattern: /(微信|wechat)/i, key: 'contact.wechat' },
  { pattern: /(紧急联系人(?!电话)|emergency\s*contact)/i, key: 'contact.emergencyContactName' },
  { pattern: /(紧急联系人电话|emergency\s*phone)/i, key: 'contact.emergencyContactPhone' },

  { pattern: /(现居住地|当前所在地|居住城市|current\s*city|location)/i, key: 'residency.currentCity' },
  { pattern: /(现住址|当前地址|current\s*address)/i, key: 'residency.currentAddress' },
  { pattern: /(家庭地址|home\s*address)/i, key: 'residency.homeAddress' },
  { pattern: /(户口性质|household\s*type|hukou\s*type)/i, key: 'residency.householdType' },
  { pattern: /(户籍地址|户口所在地|household\s*address|hukou\s*address)/i, key: 'residency.householdAddress' },
  { pattern: /(派出所|police\s*station)/i, key: 'residency.policeStation' },

  { pattern: /(期望城市|意向城市|工作城市|preferred\s*city|desired\s*location)/i, key: 'jobPreferences.expectedLocations' },
  { pattern: /(期望岗位|意向岗位|expected\s*position|desired\s*position)/i, key: 'jobPreferences.expectedPositions' },
  { pattern: /(期望薪资|薪资要求|expected\s*salary|compensation)/i, key: 'jobPreferences.expectedSalary' },
  { pattern: /(到岗时间|可入职时间|available\s*(from|date))/i, key: 'jobPreferences.availableFrom' },
  { pattern: /(实习时长|实习周期|intern(ship)?\s*duration)/i, key: 'jobPreferences.internshipDuration' },
  { pattern: /(求职状态|job\s*status)/i, key: 'jobPreferences.jobStatus' },
  { pattern: /(毕业年份|graduation\s*year)/i, key: 'graduationYear' },

  { pattern: /(学校|school|university|college|院校)/i, group: 'education', subkey: 'school' },
  { pattern: /(学校所在国家|院校所在国家|country)/i, group: 'education', subkey: 'schoolCountry' },
  { pattern: /(学历|degree|education\s*level)/i, group: 'education', subkey: 'degree' },
  { pattern: /(学位|education\s*level)/i, group: 'education', subkey: 'educationLevel' },
  { pattern: /(专业|major)/i, group: 'education', subkey: 'major' },
  { pattern: /(入学|start\s*date|enrollment)/i, group: 'education', subkey: 'startDate' },
  { pattern: /(毕业|end\s*date|graduation)/i, group: 'education', subkey: 'endDate' },
  { pattern: /(教育形式|学习形式|study\s*mode)/i, group: 'education', subkey: 'studyMode' },
  { pattern: /(gpa|绩点|平均分)/i, group: 'education', subkey: 'gpa' },
  { pattern: /(排名|rank)/i, group: 'education', subkey: 'ranking' },
  { pattern: /(奖学金|scholarship)/i, group: 'education', subkey: 'scholarships' },
  { pattern: /(在校职务|student\s*position)/i, group: 'education', subkey: 'campusPositions' },
  { pattern: /(在校实践|校内实践|campus\s*practice)/i, group: 'education', subkey: 'campusPractice' },

  { pattern: /(公司|单位|employer|company)/i, group: 'experience', subkey: 'company' },
  { pattern: /(部门|department)/i, group: 'experience', subkey: 'department' },
  { pattern: /(职位|岗位|job\s*title|position)/i, group: 'experience', subkey: 'title' },
  { pattern: /(工作地点|location)/i, group: 'experience', subkey: 'location' },
  { pattern: /(工作描述|岗位职责|description|responsibilities)/i, group: 'experience', subkey: 'description' },
  { pattern: /(业绩|achievement)/i, group: 'experience', subkey: 'achievements' },
  { pattern: /(开始时间|start\s*date)/i, group: 'experience', subkey: 'startDate' },
  { pattern: /(结束时间|end\s*date)/i, group: 'experience', subkey: 'endDate' },

  { pattern: /(项目名称|project\s*name)/i, group: 'projects', subkey: 'name' },
  { pattern: /(项目角色|role)/i, group: 'projects', subkey: 'role' },
  { pattern: /(项目时间|项目开始|project\s*date)/i, group: 'projects', subkey: 'startDate' },
  { pattern: /(项目结束|project\s*end)/i, group: 'projects', subkey: 'endDate' },
  { pattern: /(项目描述|project\s*description)/i, group: 'projects', subkey: 'description' },
  { pattern: /(技术栈|关键字|tech\s*stack)/i, group: 'projects', subkey: 'techStack' },

  { pattern: /(语言类型|语种|language)/i, group: 'languages', subkey: 'language' },
  { pattern: /(掌握程度|语言水平|proficiency|level)/i, group: 'languages', subkey: 'proficiency' },
  { pattern: /(听说|listening|speaking)/i, group: 'languages', subkey: 'listeningSpeaking' },
  { pattern: /(读写|reading|writing)/i, group: 'languages', subkey: 'readingWriting' },

  { pattern: /(家庭成员关系|relation)/i, group: 'familyMembers', subkey: 'relation' },
  { pattern: /(家庭成员姓名|member\s*name)/i, group: 'familyMembers', subkey: 'name' },
  { pattern: /(家庭成员出生日期|family.*birth)/i, group: 'familyMembers', subkey: 'birthDate' },
  { pattern: /(家庭成员政治面貌|family.*political)/i, group: 'familyMembers', subkey: 'politicalStatus' },
  { pattern: /(身份类别|identity\s*type)/i, group: 'familyMembers', subkey: 'identityType' },
  { pattern: /(工作单位|family.*employer)/i, group: 'familyMembers', subkey: 'employer' },
  { pattern: /(职务|job\s*title)/i, group: 'familyMembers', subkey: 'jobTitle' },
  { pattern: /(状态|status)/i, group: 'familyMembers', subkey: 'status' },
  { pattern: /(家庭所在地|family.*location)/i, group: 'familyMembers', subkey: 'location' },

  { pattern: /(证书|certificate|credential)/i, group: 'certificates', subkey: 'name' },
  { pattern: /(证书颁发机构|issuer)/i, group: 'certificates', subkey: 'issuer' },
  { pattern: /(证书时间|issue\s*date)/i, group: 'certificates', subkey: 'issueDate' },
  { pattern: /(证书编号|credential\s*id)/i, group: 'certificates', subkey: 'credentialId' },

  { pattern: /(奖项|荣誉|award|honor)/i, group: 'awards', subkey: 'name' },
  { pattern: /(颁发单位|award\s*issuer)/i, group: 'awards', subkey: 'issuer' },
  { pattern: /(获奖年份|award\s*year)/i, group: 'awards', subkey: 'year' },
  { pattern: /(奖项描述|award\s*description)/i, group: 'awards', subkey: 'description' },

  { pattern: /(技能|专业技能|technical\s*skills|expertise)/i, key: 'skills' },
  { pattern: /(自我评价|自我介绍|个人评价|个人简介|个人优势|about\s*me|summary)/i, key: 'selfIntro' },
  { pattern: /(简历|resume|cv|附件)/i, key: '_resumeFile', isFile: true },
];

const REQUIRED_KEYWORDS = /(必填|required|\*)/i;
const SENSITIVE_KEYWORDS = /(身份证|证件号码|婚姻|健康|血型|政治面貌|户口|户籍|家庭成员|紧急联系人)/i;
const MANUAL_ONLY_PREFIXES = [
  'identity.',
  'contact.emergencyContact',
  'residency.household',
  'residency.policeStation',
  'personal.politicalStatus',
  'personal.partyJoinDate',
  'personal.maritalStatus',
  'personal.healthStatus',
  'personal.bloodType',
  'personal.heightCm',
  'personal.weightKg',
  'personal.nationality',
  'personal.ethnicity',
  'personal.freshGraduateStatus',
  'personal.hasOverseasStudy',
  'familyMembers',
  'jobPreferences',
];
const TOP_RULE_CANDIDATES = 5;
const FALLBACK_MATCH_THRESHOLD = 5.2;
const FALLBACK_MATCH_MIN_GAP = 0.85;
const HIGH_RISK_MATCH_THRESHOLD = 7.5;
const HIGH_RISK_EXACT_ALIAS_THRESHOLD = 6.5;

const SECTION_BUCKET_DEFINITIONS = [
  {
    bucket: 'personal',
    pattern: /(个人信息|基本信息|联系信息|联系方式)/i,
    keyPatterns: [/^personal\./, /^identity\./, /^contact\./, /^residency\./],
  },
  {
    bucket: 'education',
    pattern: /(教育经历|教育背景|学校)/i,
    keyPatterns: [/^education\[/, /^graduationYear$/, /^personal\.hasOverseasStudy$/],
  },
  {
    bucket: 'projects',
    pattern: /(在校实践|校内实践|项目经历|项目经验)/i,
    keyPatterns: [/^projects\[/, /^education\[\d+\]\.(campusPositions|campusPractice)$/],
  },
  {
    bucket: 'experience',
    pattern: /(实习经历|工作经历|职业经历|实践经历)/i,
    keyPatterns: [/^experience\[/],
  },
  {
    bucket: 'languages',
    pattern: /(语言能力|外语能力|语种|语言水平)/i,
    keyPatterns: [/^languages\[/],
  },
  {
    bucket: 'family',
    pattern: /(家庭情况|家庭成员|家属)/i,
    keyPatterns: [/^familyMembers\[/],
  },
  {
    bucket: 'additional',
    pattern: /(附加信息|补充信息|其他信息|应聘者声明|声明)/i,
    keyPatterns: [/^jobPreferences\./, /^graduationYear$/, /^selfIntro$/],
  },
];

function normalizeSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()（）\-_/\\,.;:：，。'"`~!@#$%^&*+=?|[\]{}<>]/g, ' ')
    .trim();
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function camelToTerms(value = '') {
  return String(value || '')
    .replace(/\[\]/g, ' ')
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

function cleanRegexAlias(source = '') {
  return source
    .replace(/\(\?![^)]*\)/g, '')
    .replace(/\(\?<![^)]*\)/g, '')
    .replace(/\(\?<=?[^)]*\)/g, '')
    .replace(/\\s[\*\+\?]?/g, '')
    .replace(/\\b/g, '')
    .replace(/\\d[\*\+\?]?/g, '')
    .replace(/\\w[\*\+\?]?/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[()*+?^$]/g, ' ')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPatternAliases(pattern) {
  const source = pattern?.source || '';
  return uniqueStrings(
    source
      .split('|')
      .map(part => cleanRegexAlias(part))
      .filter(alias => alias.length >= 2)
  );
}

function buildRuleCandidateIndex(rules = []) {
  const docs = rules.map((rule, index) => {
    const previewKey = rule.key || `${rule.group}[].${rule.subkey}`;
    const aliases = uniqueStrings([
      ...extractPatternAliases(rule.pattern),
      camelToTerms(rule.key || ''),
      camelToTerms(rule.group || ''),
      camelToTerms(rule.subkey || ''),
      previewKey.replace(/\[\]/g, '[]'),
    ].filter(Boolean));
    const searchText = aliases.join(' ');
    const tokens = tokenizeSearchText(searchText);
    const tokenSet = new Set(tokens);
    const ngrams = buildCharNgrams(searchText);
    return {
      index,
      rule,
      previewKey,
      aliases,
      searchText,
      tokens,
      tokenSet,
      ngrams,
      length: Math.max(tokens.length, 1),
      sectionBucket: inferSectionBucketForKey(previewKey),
      highRisk: isManualOnlyPath(previewKey),
    };
  });

  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.tokenSet) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const avgLength = docs.length
    ? docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length
    : 1;

  return { docs, df, avgLength, totalDocs: docs.length || 1 };
}

function tokenizeSearchText(value = '') {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const asciiWords = normalized.match(/[a-z0-9]{2,}/g) || [];
  const chineseChunks = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const chineseNgrams = chineseChunks.flatMap(chunk => buildCharNgrams(chunk, 2, 3));
  return uniqueStrings([...asciiWords, ...chineseChunks, ...chineseNgrams]);
}

function buildCharNgrams(value = '', min = 2, max = 3) {
  const normalized = normalizeSearchText(value).replace(/\s+/g, '');
  if (!normalized) return [];
  const ngrams = [];
  for (let size = min; size <= max; size += 1) {
    if (normalized.length < size) continue;
    for (let i = 0; i <= normalized.length - size; i += 1) {
      ngrams.push(normalized.slice(i, i + size));
    }
  }
  return uniqueStrings(ngrams);
}

function computeBm25Score(queryTokens, doc, indexStats) {
  if (!queryTokens.length) return 0;
  const tf = new Map();
  for (const token of doc.tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of queryTokens) {
    const termFreq = tf.get(token) || 0;
    if (!termFreq) continue;
    const docFreq = indexStats.df.get(token) || 0;
    const idf = Math.log(1 + ((indexStats.totalDocs - docFreq + 0.5) / (docFreq + 0.5)));
    const denom = termFreq + k1 * (1 - b + b * (doc.length / indexStats.avgLength));
    score += idf * ((termFreq * (k1 + 1)) / Math.max(denom, 1e-6));
  }
  return score;
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

function inferFieldControlFamily(field = {}) {
  switch (field.type) {
    case 'file':
      return 'file';
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

function inferSectionBucketForKey(key = '') {
  for (const definition of SECTION_BUCKET_DEFINITIONS) {
    if (definition.keyPatterns.some(pattern => pattern.test(key))) return definition.bucket;
  }
  return '';
}

function inferSectionBucketForField(field = {}) {
  const combined = [
    field.sectionLabel,
    field.contextText,
    ...(field.labelCandidates || []).slice(0, 4),
    field.label,
  ].filter(Boolean).join(' ');

  for (const definition of SECTION_BUCKET_DEFINITIONS) {
    if (definition.pattern.test(combined)) return definition.bucket;
  }
  return '';
}

function inferAllowedFamiliesForKey(key = '') {
  if (key === '_resumeFile') return new Set(['file']);
  if (/(birthDate|partyJoinDate|startDate|endDate|issueDate|availableFrom)/.test(key)) {
    return new Set(['date', 'text', 'choice']);
  }
  if (/(description|achievements|selfIntro|campusPractice|campusPositions)/.test(key)) {
    return new Set(['longtext', 'text']);
  }
  if (/(gender|maritalStatus|politicalStatus|healthStatus|bloodType|freshGraduateStatus|hasOverseasStudy|documentType|householdType|relation|identityType|status|educationLevel|degree|studyMode|ethnicity|nationality|language|proficiency|listeningSpeaking|readingWriting|currentCity|expectedLocations|expectedPositions|jobStatus)/.test(key)) {
    return new Set(['choice', 'text']);
  }
  return new Set(['text', 'date']);
}

function isHighRiskKey(key = '') {
  return isManualOnlyPath(key) || /^identity\./.test(key) || /^contact\.emergency/.test(key);
}

function computeLexicalSignals(field, doc, indexStats) {
  const directText = [
    field.label,
    field.placeholder,
    field.name,
    field.title,
  ].filter(Boolean).join(' ');
  const extendedText = [
    directText,
    ...(field.labelCandidates || []),
    field.helperText,
    field.sectionLabel,
    field.contextText,
    field.containerText,
    Array.isArray(field.options) ? field.options.map(option => `${option.text} ${option.value}`).join(' ') : '',
  ].filter(Boolean).join(' ');

  const directTokens = tokenizeSearchText(directText);
  const extendedTokens = tokenizeSearchText(extendedText);
  const directNgrams = buildCharNgrams(directText);
  const extendedNgrams = buildCharNgrams(extendedText);
  const directNormalized = normalizeSearchText(directText).replace(/\s+/g, '');
  const extendedNormalized = normalizeSearchText(extendedText).replace(/\s+/g, '');

  let exactAliasHit = false;
  let partialAliasHit = false;
  for (const alias of doc.aliases) {
    const normalizedAlias = normalizeSearchText(alias).replace(/\s+/g, '');
    if (!normalizedAlias) continue;
    if (normalizedAlias === directNormalized || normalizedAlias === extendedNormalized) {
      exactAliasHit = true;
      break;
    }
    if (directNormalized.includes(normalizedAlias) || extendedNormalized.includes(normalizedAlias)) {
      partialAliasHit = true;
    }
  }

  return {
    directTokens,
    extendedTokens,
    directNgrams,
    extendedNgrams,
    exactAliasHit,
    partialAliasHit,
    bm25: computeBm25Score(extendedTokens, doc, indexStats),
    charOverlap: Math.max(
      computeSetOverlapScore(directNgrams, doc.ngrams),
      computeSetOverlapScore(extendedNgrams, doc.ngrams)
    ),
    tokenOverlap: Math.max(
      computeSetOverlapScore(directTokens, doc.tokens),
      computeSetOverlapScore(extendedTokens, doc.tokens)
    ),
  };
}

function rankRuleCandidates(field, ruleIndex) {
  const fieldFamily = inferFieldControlFamily(field);
  const fieldSectionBucket = inferSectionBucketForField(field);

  const coarse = [];
  for (const doc of ruleIndex.docs) {
    const allowedFamilies = inferAllowedFamiliesForKey(doc.previewKey);
    if (!allowedFamilies.has(fieldFamily)) continue;

    if (fieldSectionBucket && doc.sectionBucket && fieldSectionBucket !== doc.sectionBucket) {
      continue;
    }

    const lexical = computeLexicalSignals(field, doc, ruleIndex);
    const score =
      lexical.bm25 * 2.3 +
      lexical.charOverlap * 3.4 +
      lexical.tokenOverlap * 2.2 +
      (lexical.partialAliasHit ? 0.9 : 0) +
      (doc.sectionBucket && doc.sectionBucket === fieldSectionBucket ? 0.7 : 0);

    if (score <= 0) continue;
    coarse.push({
      ...doc,
      ...lexical,
      coarseScore: score,
    });
  }

  const top = coarse
    .sort((left, right) => right.coarseScore - left.coarseScore)
    .slice(0, TOP_RULE_CANDIDATES)
    .map(candidate => {
      const finalScore =
        candidate.coarseScore +
        (candidate.exactAliasHit ? 2.4 : 0) +
        (candidate.partialAliasHit ? 0.6 : 0) +
        (candidate.highRisk ? -0.9 : 0);
      return {
        ...candidate,
        finalScore,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore);

  return top;
}

function buildCandidateHints(candidates = []) {
  return candidates.slice(0, 3).map(candidate => ({
    key: candidate.previewKey,
    score: Number(candidate.finalScore.toFixed(2)),
    exactAliasHit: candidate.exactAliasHit,
    sectionBucket: candidate.sectionBucket || '',
  }));
}

function selectRankedCandidate(field, rankedCandidates, profile, counters) {
  if (!rankedCandidates.length) return null;

  const best = rankedCandidates[0];
  const runnerUp = rankedCandidates[1] || null;
  const gap = best.finalScore - (runnerUp?.finalScore || 0);
  const highRisk = isHighRiskKey(best.previewKey);
  const meetsThreshold = best.finalScore >= (highRisk ? HIGH_RISK_MATCH_THRESHOLD : FALLBACK_MATCH_THRESHOLD);
  const meetsGap = gap >= FALLBACK_MATCH_MIN_GAP;
  const exactRiskOverride = highRisk && best.exactAliasHit && best.finalScore >= HIGH_RISK_EXACT_ALIAS_THRESHOLD;

  if ((!meetsThreshold || !meetsGap) && !exactRiskOverride) return null;
  if (highRisk && !exactRiskOverride) return null;

  let key = best.rule.key;
  if (best.rule.group) {
    key = claimGroupedKey(counters, best.rule.group, best.rule.subkey);
  }

  return {
    matched: true,
    key,
    value: getProfileValue(profile, key),
    isFile: Boolean(best.rule.isFile),
    manualOnly: isSensitiveField(field, key),
    matchMethod: 'ranked',
    candidateHints: buildCandidateHints(rankedCandidates),
  };
}

const RULE_CANDIDATE_INDEX = buildRuleCandidateIndex(FIELD_RULES);

function getProfileValue(profile, keyPath) {
  const parts = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let value = profile;
  for (const part of parts) {
    if (value == null) return undefined;
    value = value[part];
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value;
}

function buildMatchText(field) {
  const optionText = Array.isArray(field.options)
    ? field.options.map(option => `${option.text} ${option.value}`).join(' ')
    : '';
  const labelCandidates = Array.isArray(field.labelCandidates)
    ? field.labelCandidates.join(' ')
    : '';

  return [
    field.label,
    labelCandidates,
    field.placeholder,
    field.name,
    field.title,
    field.helperText,
    field.sectionLabel,
    field.contextText,
    optionText,
  ].filter(Boolean).join(' ');
}

function isManualOnlyPath(key = '') {
  return MANUAL_ONLY_PREFIXES.some(prefix => key.startsWith(prefix));
}

function isSensitiveField(field, key = '') {
  return isManualOnlyPath(key) || SENSITIVE_KEYWORDS.test(buildMatchText(field));
}

function parseRepeatPath(key = '') {
  const match = key.match(/^([a-zA-Z]+)\[(\d+)\]\./);
  if (!match) return null;
  return {
    section: match[1],
    index: Number(match[2]),
  };
}

function attachFieldMeta(field, key) {
  const repeatInfo = parseRepeatPath(key);
  return {
    ...field,
    normalizedKey: key,
    repeatSection: repeatInfo?.section || null,
    repeatIndex: repeatInfo?.index ?? null,
  };
}

function claimGroupedKey(counters, group, subkey) {
  const groupCounters = counters[group] = counters[group] || {};
  const idx = groupCounters[subkey] || 0;
  groupCounters[subkey] = idx + 1;
  return `${group}[${idx}].${subkey}`;
}

function matchFieldByRule(field, profile, counters, adapter = null) {
  const adapterMatch = adapter?.matchField?.({
    field,
    profile,
    counters,
    helpers: {
      buildMatchText,
      claimGroupedKey: (group, subkey) => claimGroupedKey(counters, group, subkey),
      getProfileValue,
      isSensitiveField,
    },
  });
  if (adapterMatch?.matched) return adapterMatch;

  const matchText = buildMatchText(field);
  const fieldFamily = inferFieldControlFamily(field);
  const fieldSectionBucket = inferSectionBucketForField(field);

  for (let ruleIndex = 0; ruleIndex < FIELD_RULES.length; ruleIndex += 1) {
    const rule = FIELD_RULES[ruleIndex];
    if (!rule.pattern.test(matchText)) continue;
    const previewKey = rule.key || `${rule.group}[].${rule.subkey}`;
    const allowedFamilies = inferAllowedFamiliesForKey(previewKey);
    if (!allowedFamilies.has(fieldFamily)) continue;

    const ruleSectionBucket = RULE_CANDIDATE_INDEX.docs[ruleIndex]?.sectionBucket || '';
    if (fieldSectionBucket && ruleSectionBucket && fieldSectionBucket !== ruleSectionBucket) continue;

    if (rule.isFile) {
      return { matched: true, key: '_resumeFile', value: null, isFile: true, manualOnly: false };
    }

    let key = rule.key;
    if (rule.group) {
      key = claimGroupedKey(counters, rule.group, rule.subkey);
    }

    return {
      matched: true,
      key,
      value: getProfileValue(profile, key),
      isFile: false,
      manualOnly: isSensitiveField(field, key),
      matchMethod: 'rule',
    };
  }

  return { matched: false, key: null, value: null, isFile: false, manualOnly: false, matchMethod: 'none' };
}

function matchField(field, profile, counters, adapter = null) {
  const directMatch = matchFieldByRule(field, profile, counters, adapter);
  if (directMatch.matched) return directMatch;

  const rankedCandidates = rankRuleCandidates(field, RULE_CANDIDATE_INDEX);
  const rankedMatch = selectRankedCandidate(field, rankedCandidates, profile, counters);
  if (rankedMatch) return rankedMatch;

  return {
    matched: false,
    key: null,
    value: null,
    isFile: false,
    manualOnly: false,
    matchMethod: 'none',
    candidateHints: buildCandidateHints(rankedCandidates),
  };
}

async function resolveMappedValue(field, key, rawValue, adapter) {
  if (rawValue == null || rawValue === '') {
    return { matched: true, value: rawValue };
  }

  if (!['select', 'radio', 'checkbox'].includes(field.type) || !field.options?.length) {
    return { matched: true, value: String(rawValue) };
  }

  const enumMappings = await enumMappingsModulePromise;
  const adapterOverride = adapter?.mapEnumValue?.(key, String(rawValue), {
    field,
    options: field.options,
    location,
    document,
  }) || null;

  const result = enumMappings.mapEnumValue({
    fieldKey: key,
    value: String(rawValue),
    options: field.options,
    adapterOverride,
  });

  if (!result.matched) return { matched: false, detail: result };
  return { matched: true, value: String(result.mappedValue), detail: result };
}

async function matchForms(detectResult, profile) {
  const matched = [];
  const unmatched = [];
  const counters = {};
  const diagnostics = {
    missingRequiredFields: [],
    unmappedFields: [],
    sensitiveFieldsSkipped: [],
    unmappedValues: [],
  };
  const adapter = window.__jobpilotGetSiteAdapter?.({ document, location }) || null;

  for (const form of detectResult.forms) {
    for (const field of form.fields) {
      if (field.type === 'file') {
        matched.push({ field, formId: form.id, key: '_resumeFile', value: null, isFile: true });
        continue;
      }

      const result = matchField(field, profile, counters, adapter);
      const required = Boolean(field.required || REQUIRED_KEYWORDS.test(buildMatchText(field)));
      const fieldLabel = field.label || field.name || field.id;

      if (!result.matched) {
        unmatched.push({
          field: {
            ...field,
            candidateHints: result.candidateHints || [],
          },
          formId: form.id,
        });
        diagnostics.unmappedFields.push({
          fieldId: field.id,
          label: fieldLabel,
          required,
        });
        continue;
      }

      const fieldWithMeta = attachFieldMeta(field, result.key);
      if (result.candidateHints?.length) {
        fieldWithMeta.candidateHints = result.candidateHints;
      }

      if (result.value != null && result.value !== '') {
        const mappedValue = await resolveMappedValue(fieldWithMeta, result.key, result.value, adapter);
        if (!mappedValue.matched) {
          unmatched.push({
            field: fieldWithMeta,
            formId: form.id,
            normalizedKey: result.key,
            profileValue: String(result.value),
            reason: 'unmapped_value',
          });
          diagnostics.unmappedValues.push({
            fieldId: field.id,
            label: fieldLabel,
            key: result.key,
            value: String(result.value),
            options: (field.options || []).slice(0, 12),
            required,
          });
          if (required) {
            diagnostics.missingRequiredFields.push({
              fieldId: field.id,
              label: fieldLabel,
              key: result.key,
              reason: 'unmapped_value',
            });
          }
          continue;
        }

        matched.push({
          field: fieldWithMeta,
          formId: form.id,
          key: result.key,
          value: String(mappedValue.value),
          rawValue: String(result.value),
          isFile: false,
        });
        continue;
      }

      if (result.manualOnly) {
        diagnostics.sensitiveFieldsSkipped.push({
          fieldId: field.id,
          label: fieldLabel,
          key: result.key,
          required,
        });
        if (required) {
          diagnostics.missingRequiredFields.push({
            fieldId: field.id,
            label: fieldLabel,
            key: result.key,
            reason: 'manual_only',
          });
        }
        continue;
      }

      unmatched.push({
        field: fieldWithMeta,
        formId: form.id,
        normalizedKey: result.key,
        reason: 'missing_profile_value',
      });

      if (required) {
        diagnostics.missingRequiredFields.push({
          fieldId: field.id,
          label: fieldLabel,
          key: result.key,
          reason: 'missing_profile_value',
        });
      }
    }
  }

  return { matched, unmatched, diagnostics };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'matchFields') {
    (async () => {
      try {
        const result = await matchForms(message.detectResult, message.profile);
        sendResponse({ success: true, data: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  return true;
});

window.__jobpilotMatchForms = matchForms;
window.__jobpilotMatchField = matchField;
window.__jobpilotGetProfileValue = getProfileValue;
