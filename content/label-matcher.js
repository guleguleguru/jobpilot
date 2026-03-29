const enumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));

const FIELD_RULES = [
  { key: 'personal.fullName', aliases: ['姓名', '名字', '中文姓名', 'full name', 'applicant name', 'candidate name'] },
  { key: 'personal.fullNamePinyin', aliases: ['姓名拼音', '姓名全拼', '拼音', 'name pinyin', 'full name pinyin'] },
  { key: 'personal.englishName', aliases: ['英文名', '英文姓名', 'english name'] },
  { key: 'personal.lastName', aliases: ['姓', '姓氏', 'family name', 'last name', 'surname'] },
  { key: 'personal.firstName', aliases: ['名', '名字', 'given name', 'first name'] },
  { key: 'personal.gender', aliases: ['性别', 'gender', 'sex'] },
  { key: 'personal.birthDate', aliases: ['出生日期', '出生年月', '生日', 'birth date', 'date of birth', 'dob'] },
  { key: 'personal.age', aliases: ['年龄', 'age'] },
  { key: 'personal.nationality', aliases: ['国籍', 'nationality', 'citizenship'] },
  { key: 'personal.ethnicity', aliases: ['民族', 'ethnicity'] },
  { key: 'personal.nativePlace', aliases: ['籍贯', '生源地', 'native place', 'hometown'] },
  { key: 'personal.politicalStatus', aliases: ['政治面貌', '政治身份', '党派', 'political status', 'party affiliation'] },
  { key: 'personal.partyJoinDate', aliases: ['入党时间', '加入党派时间', 'party join date'] },
  { key: 'personal.maritalStatus', aliases: ['婚姻状况', 'marital status'] },
  { key: 'personal.healthStatus', aliases: ['健康状况', 'health status'] },
  { key: 'personal.bloodType', aliases: ['血型', 'blood type'] },
  { key: 'personal.heightCm', aliases: ['身高', 'height'] },
  { key: 'personal.weightKg', aliases: ['体重', 'weight'] },
  { key: 'personal.freshGraduateStatus', aliases: ['应届往届', '应届生状态', '毕业生状态', 'fresh graduate', 'graduate status'] },
  { key: 'personal.hasOverseasStudy', aliases: ['海外留学经历有无', '是否海外留学', '留学经历', 'overseas study', 'study abroad'] },

  { key: 'identity.documentType', aliases: ['证件类型', '证件类别', 'id type', 'document type'] },
  { key: 'identity.documentNumber', aliases: ['证件号码', '证件号', '身份证号', '身份证号码', 'id number', 'document number', 'identity card number'] },

  { key: 'contact.phone', aliases: ['手机号', '手机号码', '联系电话', '联系电话号码', 'mobile', 'phone', 'telephone'] },
  { key: 'contact.email', aliases: ['邮箱', '电子邮箱', 'email', 'e-mail'] },
  { key: 'contact.landline', aliases: ['固定电话', 'landline', 'home phone'] },
  { key: 'contact.address', aliases: ['联系地址', '通讯地址', 'mailing address', 'contact address'] },
  { key: 'contact.postalCode', aliases: ['邮编', '邮政编码', 'postal code', 'zip code'] },
  { key: 'contact.wechat', aliases: ['微信', 'wechat', 'weixin'] },
  { key: 'contact.emergencyContactName', aliases: ['紧急联系人', 'emergency contact'] },
  { key: 'contact.emergencyContactPhone', aliases: ['紧急联系电话', '紧急联系人电话', 'emergency phone', 'emergency contact phone'] },

  { key: 'residency.currentCity', aliases: ['现居住地', '当前所在地', '所在城市', '现居城市', 'current city', 'current location'] },
  { key: 'residency.currentAddress', aliases: ['现住地址', '现居地址', '当前地址', 'current address', 'residential address'] },
  { key: 'residency.homeAddress', aliases: ['家庭地址', 'home address'] },
  { key: 'residency.householdType', aliases: ['户口性质', '户籍性质', 'hukou type', 'household type'] },
  { key: 'residency.householdAddress', aliases: ['户籍地址', '户口所在地', 'household address', 'hukou address'] },
  { key: 'residency.policeStation', aliases: ['户口所在派出所', '派出所', 'police station'] },

  { key: 'jobPreferences.expectedLocations', aliases: ['意向城市', '期望城市', '工作城市', 'preferred city', 'desired location'] },
  { key: 'jobPreferences.expectedPositions', aliases: ['意向职位', '期望岗位', '应聘岗位', 'desired position', 'expected position'] },
  { key: 'jobPreferences.expectedSalary', aliases: ['期望薪资', '薪资要求', 'expected salary', 'salary expectation'] },
  { key: 'jobPreferences.availableFrom', aliases: ['到岗时间', '可入职时间', '最快到岗时间', 'available from', 'start availability'] },
  { key: 'jobPreferences.internshipDuration', aliases: ['实习时长', '实习周期', 'internship duration'] },
  { key: 'jobPreferences.jobStatus', aliases: ['求职状态', '当前状态', 'job status'] },
  { key: 'graduationYear', aliases: ['毕业年份', '毕业时间', 'graduation year'] },

  { group: 'education', subkey: 'startDate', aliases: ['开始时间', '入学时间', '入学日期', '教育开始时间', 'start date', 'enrollment date'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'endDate', aliases: ['结束时间', '毕业时间', '毕业日期', '教育结束时间', 'end date', 'graduation date'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'school', aliases: ['学校', '学校名称', '院校', '院校名称', 'university', 'college', 'school'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'schoolCountry', aliases: ['学校所在国家', '院校所在国家', 'country of school', 'school country'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'major', aliases: ['专业', '专业名称', 'major', 'field of study'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'degree', aliases: ['学历', 'degree', 'education level'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'educationLevel', aliases: ['学位', 'degree type', 'academic degree'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'studyMode', aliases: ['学历取得方式', '教育形式', '学习形式', 'study mode'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'gpa', aliases: ['gpa', '绩点', '平均成绩'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'ranking', aliases: ['排名', 'rank', 'class rank'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'scholarships', aliases: ['奖学金', 'scholarship'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'campusPositions', aliases: ['在校职务', '学生干部', 'campus position', 'student position'], sectionBuckets: ['education'] },
  { group: 'education', subkey: 'campusPractice', aliases: ['在校实践', '校内实践', '校园实践', 'campus practice'], sectionBuckets: ['education', 'projects'] },

  { group: 'experience', subkey: 'company', aliases: ['公司', '单位名称', '工作单位', 'employer', 'company'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'department', aliases: ['部门', 'department'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'title', aliases: ['职位', '职位名称', '岗位', 'job title', 'position'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'location', aliases: ['工作地点', 'location'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'startDate', aliases: ['开始时间', '入职时间', 'start date'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'endDate', aliases: ['结束时间', '离职时间', 'end date'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'description', aliases: ['工作内容', '实习内容', '职责描述', '岗位职责', 'description', 'responsibilities'], sectionBuckets: ['experience'] },
  { group: 'experience', subkey: 'achievements', aliases: ['工作业绩', '成果', 'achievement', 'achievements'], sectionBuckets: ['experience'] },

  { group: 'projects', subkey: 'startDate', aliases: ['开始时间', '项目开始时间', '实践开始时间', 'start date'], sectionBuckets: ['projects'] },
  { group: 'projects', subkey: 'endDate', aliases: ['结束时间', '项目结束时间', '实践结束时间', 'end date'], sectionBuckets: ['projects'] },
  { group: 'projects', subkey: 'name', aliases: ['项目名称', '实践名称', 'project name'], sectionBuckets: ['projects'] },
  { group: 'projects', subkey: 'role', aliases: ['项目角色', '担任角色', 'role'], sectionBuckets: ['projects'] },
  { group: 'projects', subkey: 'description', aliases: ['项目描述', '实践描述', 'project description'], sectionBuckets: ['projects'] },
  { group: 'projects', subkey: 'techStack', aliases: ['技术栈', '关键技术', 'tech stack'], sectionBuckets: ['projects'] },

  { group: 'languages', subkey: 'language', aliases: ['语言类型', '语种', 'language'], sectionBuckets: ['languages'] },
  { group: 'languages', subkey: 'proficiency', aliases: ['掌握程度', '语言水平', '熟练程度', 'proficiency', 'level'], sectionBuckets: ['languages'] },
  { group: 'languages', subkey: 'listeningSpeaking', aliases: ['听说', '听力口语', 'listening speaking'], sectionBuckets: ['languages'] },
  { group: 'languages', subkey: 'readingWriting', aliases: ['读写', '阅读写作', 'reading writing'], sectionBuckets: ['languages'] },

  { group: 'familyMembers', subkey: 'relation', aliases: ['与本人关系', '关系', 'relation'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'name', aliases: ['姓名', '成员姓名', 'family member name'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'birthDate', aliases: ['出生日期', 'family birth date', 'birth date'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'politicalStatus', aliases: ['政治面貌', 'political status'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'identityType', aliases: ['身份类别', 'identity type'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'employer', aliases: ['工作单位', 'employer', 'company'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'jobTitle', aliases: ['职务', '职位', 'job title', 'position'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'status', aliases: ['存在状态', '状态', 'status'], sectionBuckets: ['family'] },
  { group: 'familyMembers', subkey: 'location', aliases: ['家庭所在地', '所在地', 'location'], sectionBuckets: ['family'] },

  { group: 'certificates', subkey: 'name', aliases: ['证书', '资格证书', 'certificate', 'credential'] },
  { group: 'certificates', subkey: 'issuer', aliases: ['颁发机构', '发证机构', 'issuer'] },
  { group: 'certificates', subkey: 'issueDate', aliases: ['发证时间', '证书时间', 'issue date'] },
  { group: 'certificates', subkey: 'credentialId', aliases: ['证书编号', 'credential id', 'certificate number'] },

  { group: 'awards', subkey: 'name', aliases: ['奖项', '荣誉', 'award', 'honor'] },
  { group: 'awards', subkey: 'issuer', aliases: ['颁奖机构', 'award issuer', 'issuer'] },
  { group: 'awards', subkey: 'year', aliases: ['获奖年份', 'award year', 'year'] },
  { group: 'awards', subkey: 'description', aliases: ['奖项描述', 'award description'] },

  { key: 'skills', aliases: ['技能', '专业技能', 'technical skills', 'skills', 'expertise'] },
  { key: 'selfIntro', aliases: ['自我评价', '自我介绍', '个人评价', '个人优势', 'summary', 'about me'] },
  { key: '_resumeFile', aliases: ['简历', '附件简历', '上传简历', 'resume', 'cv'], isFile: true },
];

const REQUIRED_KEYWORDS = /(必填|required|\*)/i;
const HIGH_RISK_PREFIXES = [
  'identity.',
  'contact.emergencyContact',
  'familyMembers',
  'residency.household',
  'residency.policeStation',
  'personal.maritalStatus',
  'personal.healthStatus',
  'personal.bloodType',
];
const MANUAL_ONLY_PREFIXES = [];
const TOP_RULE_CANDIDATES = 5;
const MATCH_THRESHOLD = 4.2;
const HIGH_RISK_MATCH_THRESHOLD = 6.2;
const MATCH_MIN_GAP = 0.75;

const SECTION_BUCKET_DEFINITIONS = [
  {
    bucket: 'personal',
    pattern: /(个人信息|基本信息|联系方式|联系信息|personal|contact)/i,
    keyPatterns: [/^personal\./, /^identity\./, /^contact\./, /^residency\./],
  },
  {
    bucket: 'education',
    pattern: /(教育经历|教育背景|学校|学历|学位|education|academic)/i,
    keyPatterns: [/^education\[/, /^graduationYear$/],
  },
  {
    bucket: 'projects',
    pattern: /(在校实践|校内实践|校园实践|项目经历|项目经验|project|practice)/i,
    keyPatterns: [/^projects\[/, /^education\[\d+\]\.(campusPositions|campusPractice)$/],
  },
  {
    bucket: 'experience',
    pattern: /(实习经历|工作经历|职业经历|工作经验|intern|experience|work)/i,
    keyPatterns: [/^experience\[/],
  },
  {
    bucket: 'languages',
    pattern: /(语言能力|外语能力|语种|听说|读写|language)/i,
    keyPatterns: [/^languages\[/],
  },
  {
    bucket: 'family',
    pattern: /(家庭情况|家庭成员|家属|亲属|与本人关系|身份类别|存在状态|家庭所在地|family)/i,
    keyPatterns: [/^familyMembers\[/],
  },
  {
    bucket: 'additional',
    pattern: /(附加信息|补充信息|其他信息|声明|additional)/i,
    keyPatterns: [/^jobPreferences\./, /^selfIntro$/],
  },
];

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

function camelToTerms(value = '') {
  return String(value || '')
    .replace(/\[(\d*)\]/g, ' ')
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
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
    field.containerText,
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
  if (/(birthDate|partyJoinDate|startDate|endDate|issueDate|availableFrom|graduationYear)/.test(key)) {
    return new Set(['date', 'text', 'choice']);
  }
  if (/(description|achievements|selfIntro|campusPractice|campusPositions|skills)/.test(key)) {
    return new Set(['longtext', 'text']);
  }
  if (/(gender|maritalStatus|politicalStatus|healthStatus|bloodType|freshGraduateStatus|hasOverseasStudy|documentType|householdType|relation|identityType|status|educationLevel|degree|studyMode|ethnicity|nationality|nativePlace|language|proficiency|listeningSpeaking|readingWriting|currentCity|expectedLocations|expectedPositions|jobStatus)/.test(key)) {
    return new Set(['choice', 'text']);
  }
  return new Set(['text', 'date']);
}

function isManualOnlyPath(key = '') {
  return MANUAL_ONLY_PREFIXES.some(prefix => key.startsWith(prefix));
}

function isHighRiskKey(key = '') {
  return HIGH_RISK_PREFIXES.some(prefix => key.startsWith(prefix));
}

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
    field.containerText,
    optionText,
  ].filter(Boolean).join(' ');
}

function buildFieldSignals(field = {}) {
  const primaryLabel = field.label ? [field.label] : [];
  const supportingLabels = uniqueStrings(
    (field.labelCandidates || [])
      .filter(candidate => normalizeComparable(candidate) !== normalizeComparable(field.label || ''))
      .slice(0, 4)
  );
  const secondary = uniqueStrings([
    field.placeholder,
    field.name,
    field.title,
  ]);
  const extended = uniqueStrings([
    field.helperText,
    field.sectionLabel,
    field.contextText,
    field.containerText,
    ...(field.options || []).map(option => `${option.text || ''} ${option.value || ''}`.trim()),
  ]);
  const directLabels = uniqueStrings([...primaryLabel, ...supportingLabels]);
  const allTexts = uniqueStrings([...directLabels, ...secondary, ...extended]);

  return {
    primaryLabel,
    supportingLabels,
    directLabels,
    secondary,
    extended,
    allTexts,
    allTokens: tokenizeSearchText(allTexts.join(' ')),
    allNgrams: buildCharNgrams(allTexts.join(' ')),
  };
}

function buildRuleCandidateIndex(rules = []) {
  return rules.map(rule => {
    const previewKey = rule.key || `${rule.group}[].${rule.subkey}`;
    const aliases = uniqueStrings([
      ...(rule.aliases || []),
      camelToTerms(rule.key || ''),
      camelToTerms(rule.group || ''),
      camelToTerms(rule.subkey || ''),
      previewKey.replace(/\[\]/g, '[]'),
    ].filter(Boolean));

    return {
      rule,
      previewKey,
      aliases,
      aliasComparables: aliases.map(alias => ({
        raw: alias,
        comparable: normalizeComparable(alias),
        tokens: tokenizeSearchText(alias),
        ngrams: buildCharNgrams(alias),
      })).filter(alias => alias.comparable),
      sectionBucket: inferSectionBucketForKey(previewKey),
      highRisk: isHighRiskKey(previewKey),
    };
  });
}

function scoreAliasMatch(texts = [], aliasComparable = '') {
  if (!aliasComparable) return 0;
  let best = 0;
  for (const text of texts) {
    const comparable = normalizeComparable(text);
    if (!comparable) continue;
    if (comparable === aliasComparable) best = Math.max(best, 1);
    else if (comparable.includes(aliasComparable) || aliasComparable.includes(comparable)) best = Math.max(best, 0.7);
  }
  return best;
}

function computeLexicalSignals(field, doc) {
  const signals = buildFieldSignals(field);

  let bestExactAlias = '';
  let bestPartialAlias = '';
  let primaryScore = 0;
  let supportingScore = 0;
  let secondaryScore = 0;
  let extendedScore = 0;
  let tokenOverlap = 0;
  let charOverlap = 0;

  for (const alias of doc.aliasComparables) {
    const primary = scoreAliasMatch(signals.primaryLabel, alias.comparable);
    const supporting = Math.max(
      scoreAliasMatch(signals.supportingLabels.slice(0, 1), alias.comparable) * 0.6,
      scoreAliasMatch(signals.supportingLabels.slice(1, 2), alias.comparable) * 0.45,
      scoreAliasMatch(signals.supportingLabels.slice(2), alias.comparable) * 0.25
    );
    const secondary = scoreAliasMatch(signals.secondary, alias.comparable);
    const extended = scoreAliasMatch(signals.extended, alias.comparable);

    if (primary === 1 || secondary === 1) bestExactAlias = bestExactAlias || alias.raw;
    if ((primary >= 0.7 || supporting >= 0.5 || secondary >= 0.7 || extended >= 0.7) && !bestPartialAlias) bestPartialAlias = alias.raw;

    primaryScore = Math.max(primaryScore, primary);
    supportingScore = Math.max(supportingScore, supporting);
    secondaryScore = Math.max(secondaryScore, secondary);
    extendedScore = Math.max(extendedScore, extended);
    tokenOverlap = Math.max(tokenOverlap, computeSetOverlapScore(signals.allTokens, alias.tokens));
    charOverlap = Math.max(charOverlap, computeSetOverlapScore(signals.allNgrams, alias.ngrams));
  }

  return {
    signals,
    primaryScore,
    supportingScore,
    secondaryScore,
    extendedScore,
    tokenOverlap,
    charOverlap,
    exactAliasHit: Boolean(bestExactAlias),
    partialAliasHit: Boolean(bestPartialAlias),
    matchedAlias: bestExactAlias || bestPartialAlias || '',
  };
}

function rankRuleCandidates(field, ruleIndex) {
  const fieldFamily = inferFieldControlFamily(field);
  const fieldSectionBucket = inferSectionBucketForField(field);

  return ruleIndex
    .map(doc => {
      const allowedFamilies = inferAllowedFamiliesForKey(doc.previewKey);
      if (!allowedFamilies.has(fieldFamily)) return null;

      const ruleBuckets = doc.rule.sectionBuckets || (doc.sectionBucket ? [doc.sectionBucket] : []);
      if (fieldSectionBucket && ruleBuckets.length && !ruleBuckets.includes(fieldSectionBucket)) {
        return null;
      }

      const lexical = computeLexicalSignals(field, doc);
      const finalScore =
        lexical.primaryScore * 10 +
        lexical.supportingScore * 3 +
        lexical.secondaryScore * 3.2 +
        lexical.extendedScore * 1.4 +
        lexical.tokenOverlap * 2.4 +
        lexical.charOverlap * 1.6 +
        (lexical.exactAliasHit ? 1.2 : 0) +
        (fieldSectionBucket && ruleBuckets.includes(fieldSectionBucket) ? 0.8 : 0) +
        (doc.highRisk ? -0.35 : 0);

      return {
        ...doc,
        ...lexical,
        finalScore,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, TOP_RULE_CANDIDATES);
}

function buildCandidateHints(candidates = []) {
  return candidates.slice(0, 3).map(candidate => ({
    key: candidate.previewKey,
    score: Number(candidate.finalScore.toFixed(2)),
    exactAliasHit: candidate.exactAliasHit,
    sectionBucket: candidate.sectionBucket || '',
  }));
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

function claimGroupedKey(counters, group, subkey, field = {}) {
  const groupState = counters[group] = counters[group] || {
    nextIndex: 0,
    repeatKeyToIndex: {},
  };

  const repeatGroupKey = field.repeatGroupKey || '';
  let index;
  if (repeatGroupKey) {
    if (groupState.repeatKeyToIndex[repeatGroupKey] == null) {
      groupState.repeatKeyToIndex[repeatGroupKey] = groupState.nextIndex++;
    }
    index = groupState.repeatKeyToIndex[repeatGroupKey];
  } else {
    index = groupState.nextIndex;
  }

  return `${group}[${index}].${subkey}`;
}

function selectRankedCandidate(field, rankedCandidates, profile, counters) {
  if (!rankedCandidates.length) return null;

  const best = rankedCandidates[0];
  const runnerUp = rankedCandidates[1] || null;
  const gap = best.finalScore - (runnerUp?.finalScore || 0);
  const threshold = best.highRisk ? HIGH_RISK_MATCH_THRESHOLD : MATCH_THRESHOLD;

  if (best.finalScore < threshold) return null;
  if (gap < MATCH_MIN_GAP && !best.exactAliasHit) return null;

  let key = best.rule.key;
  if (best.rule.group) {
    key = claimGroupedKey(counters, best.rule.group, best.rule.subkey, field);
  }

  return {
    matched: true,
    key,
    value: getProfileValue(profile, key),
    isFile: Boolean(best.rule.isFile),
    manualOnly: isManualOnlyPath(key),
    matchMethod: 'semantic',
    candidateHints: buildCandidateHints(rankedCandidates),
  };
}

const RULE_CANDIDATE_INDEX = buildRuleCandidateIndex(FIELD_RULES);

function matchField(field, profile, counters, adapter = null) {
  const adapterMatch = adapter?.matchField?.({
    field,
    profile,
    counters,
    helpers: {
      buildMatchText,
      claimGroupedKey: (group, subkey) => claimGroupedKey(counters, group, subkey, field),
      getProfileValue,
      isSensitiveField: () => false,
    },
  });
  if (adapterMatch?.matched) return adapterMatch;

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
