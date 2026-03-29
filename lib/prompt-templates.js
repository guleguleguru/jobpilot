import { getFieldSourceStrategy, isSensitiveFieldPath } from './profile-schema.js';

function copyDefined(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source?.[key] != null && source[key] !== '') {
      result[key] = source[key];
    }
  }
  return result;
}

function sanitizeProfile(profile) {
  const clean = {};

  const legacyName = profile.personal?.fullName || profile.name;
  const legacyFirstName = profile.personal?.firstName || profile.firstName;
  const legacyLastName = profile.personal?.lastName || profile.lastName;
  const legacyGender = profile.personal?.gender || profile.gender;
  const legacyBirth = profile.personal?.birthDate || profile.birthday;
  const legacyEthnicity = profile.personal?.ethnicity || profile.ethnicity;
  const legacyHometown = profile.personal?.nativePlace || profile.hometown;
  const legacyPolitical = profile.personal?.politicalStatus || profile.politicalStatus;
  const legacyDocumentType = profile.identity?.documentType || profile.documentType;
  const legacyPhone = profile.contact?.phone || profile.phone;
  const legacyEmail = profile.contact?.email || profile.email;
  const legacyAddress = profile.contact?.address || profile.address;
  const legacyWechat = profile.contact?.wechat || profile.wechat;

  if (legacyName) clean.name = legacyName;
  if (legacyFirstName) clean.firstName = legacyFirstName;
  if (legacyLastName) clean.lastName = legacyLastName;
  if (legacyGender) clean.gender = legacyGender;
  if (legacyBirth) clean.birthday = legacyBirth;
  if (legacyEthnicity) clean.ethnicity = legacyEthnicity;
  if (legacyHometown) clean.hometown = legacyHometown;
  if (legacyPolitical) clean.politicalStatus = legacyPolitical;
  if (legacyDocumentType) clean.documentType = legacyDocumentType;
  if (legacyPhone) clean.phone = legacyPhone;
  if (legacyEmail) clean.email = legacyEmail;
  if (legacyAddress) clean.address = legacyAddress;
  if (legacyWechat) clean.wechat = legacyWechat;
  if (profile.graduationYear) clean.graduationYear = profile.graduationYear;
  if (profile.selfIntro) clean.selfIntro = profile.selfIntro;

  const personal = copyDefined(profile.personal || {}, [
    'fullName', 'fullNamePinyin', 'englishName', 'firstName', 'lastName', 'gender',
    'birthDate', 'nationality', 'nativePlace',
  ]);
  if (Object.keys(personal).length) clean.personal = personal;

  const contact = copyDefined(profile.contact || {}, ['phone', 'email', 'address']);
  if (Object.keys(contact).length) clean.contact = contact;

  const residency = copyDefined(profile.residency || {}, ['currentCity', 'currentAddress']);
  if (Object.keys(residency).length) clean.residency = residency;

  const jobPreferences = {
    ...copyDefined(profile.jobPreferences || {}, ['expectedSalary', 'availableFrom', 'internshipDuration', 'jobStatus']),
  };
  if (Array.isArray(profile.jobPreferences?.expectedLocations) && profile.jobPreferences.expectedLocations.length) {
    jobPreferences.expectedLocations = profile.jobPreferences.expectedLocations.slice(0, 3);
  } else if (profile.jobPreferences?.expectedCity) {
    jobPreferences.expectedLocations = [profile.jobPreferences.expectedCity];
  }
  if (Array.isArray(profile.jobPreferences?.expectedPositions) && profile.jobPreferences.expectedPositions.length) {
    jobPreferences.expectedPositions = profile.jobPreferences.expectedPositions.slice(0, 3);
  } else if (profile.jobPreferences?.expectedPosition) {
    jobPreferences.expectedPositions = [profile.jobPreferences.expectedPosition];
  }
  if (Object.keys(jobPreferences).length) clean.jobPreferences = jobPreferences;
  if (jobPreferences.expectedLocations?.length) {
    clean.jobPreferences.expectedCity = jobPreferences.expectedLocations[0];
  }

  const arrays = [
    ['education', ['school', 'degree', 'educationLevel', 'major', 'startDate', 'endDate', 'studyMode', 'gpa']],
    ['experience', ['company', 'department', 'title', 'startDate', 'endDate', 'location', 'description', 'achievements']],
    ['projects', ['name', 'role', 'startDate', 'endDate', 'description', 'techStack']],
    ['languages', ['language', 'proficiency', 'listeningSpeaking', 'readingWriting']],
    ['awards', ['name', 'issuer', 'year']],
    ['certificates', ['name', 'issuer', 'issueDate']],
  ];

  for (const [key, fields] of arrays) {
    if (!Array.isArray(profile[key])) continue;
    const items = profile[key]
      .slice(0, 2)
      .map(entry => copyDefined(entry, fields))
      .filter(entry => Object.keys(entry).length);
    if (items.length) clean[key] = items;
  }

  if (Array.isArray(clean.languages)) {
    clean.languages = clean.languages.map((entry, index) => ({
      ...entry,
      name: entry.language || profile.languages?.[index]?.name || '',
      level: entry.proficiency || profile.languages?.[index]?.level || '',
    }));
  } else if (Array.isArray(profile.languages) && profile.languages.length) {
    clean.languages = profile.languages.slice(0, 2).map(entry => ({
      name: entry.name || '',
      level: entry.level || '',
    }));
  }

  if (Array.isArray(profile.skills) && profile.skills.length) {
    clean.skills = profile.skills.slice(0, 12);
  }

  if (profile.links) {
    clean.links = copyDefined(profile.links, ['github', 'linkedin', 'website']);
  }

  return clean;
}

function summarizeField(field) {
  const result = {
    id: field.id,
    label: field.label || '',
    type: field.type,
  };
  if (field.placeholder) result.placeholder = field.placeholder;
  if (field.name) result.fieldName = field.name;
  if (field.helperText) result.helperText = field.helperText;
  if (field.sectionLabel) result.sectionLabel = field.sectionLabel;
  if (field.contextText) result.contextText = field.contextText;
  if (field.required) result.required = true;
  if (field.normalizedKey) result.normalizedKey = field.normalizedKey;
  if (field.sourceStrategy) result.sourceStrategy = field.sourceStrategy;
  if (field.candidateHints?.length) {
    result.candidateHints = field.candidateHints.slice(0, 3);
  }
  if (field.options?.length) {
    result.options = field.options.slice(0, 20).map(option => ({ value: option.value, text: option.text }));
  }
  return result;
}

function buildFormSelectionPrompt(forms) {
  const formsDesc = forms.map(form => ({
    id: form.id,
    name: form.name,
    fieldCount: form.fields.length,
    fieldLabels: form.fields.map(field => field.label || field.name).filter(Boolean).slice(0, 20),
  }));

  return [
    {
      role: 'system',
      content: '你是表单分析助手。请选择最像求职申请表的 form，只返回 JSON: {"recommendedFormId":"form_0","confidence":0.95}',
    },
    {
      role: 'user',
      content: `页面表单列表：\n${JSON.stringify(formsDesc, null, 2)}`,
    },
  ];
}

function buildFieldMappingPrompt(fields, profile) {
  const safeFields = fields.map(field => {
    const normalizedKey = field.normalizedKey || null;
    return {
      ...field,
      normalizedKey,
      sourceStrategy: normalizedKey ? getFieldSourceStrategy(normalizedKey) : 'resume_extractable',
    };
  });

  const profileJSON = JSON.stringify(sanitizeProfile(profile), null, 2);
  const fieldsJSON = JSON.stringify(safeFields.map(summarizeField), null, 2);

  return [
    {
      role: 'system',
      content: `你是 ATS 自动填表助手。你的任务是只为低风险字段生成候选值。
规则：
1. 只能根据提供的 profile 填值，禁止编造。
2. sourceStrategy 为 manual_only 的字段必须返回 suggestedValue:null。
3. 涉及身份证、婚姻、健康、血型、政治面貌、户籍、家庭成员、紧急联系人时必须返回 null。
4. select/radio 必须返回 options 中的 value。
5. 无法确认时返回 confidence:0 和 suggestedValue:null。
6. 只返回 JSON。`,
    },
    {
      role: 'user',
      content: `用户资料：\n${profileJSON}\n\n待填字段：\n${fieldsJSON}\n\n返回格式：
{
  "fieldMappings": [
    {
      "fieldId": "form_0_field_1",
      "suggestedValue": "候选值或 null",
      "confidence": 0.9,
      "reasoning": "简短原因"
    }
  ]
}`,
    },
  ];
}

function validateFieldMappings(fieldMappings, fields) {
  return fieldMappings.map(mapping => {
    const field = fields.find(item => item.id === mapping.fieldId);
    if (!field) return mapping;

    const key = field.normalizedKey || '';
    if (key && isSensitiveFieldPath(key)) {
      return { ...mapping, suggestedValue: null, confidence: 0 };
    }

    if (!mapping.suggestedValue) return mapping;

    if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
      const raw = String(mapping.suggestedValue);
      const exact = field.options.find(option => option.value === raw);
      if (exact) return mapping;

      const fuzzy = field.options.find(option =>
        option.text === raw ||
        option.text.includes(raw) ||
        raw.includes(option.text) ||
        option.value.includes(raw) ||
        raw.includes(option.value)
      );

      if (fuzzy) {
        return { ...mapping, suggestedValue: fuzzy.value };
      }

      return { ...mapping, suggestedValue: null, confidence: Math.min(mapping.confidence ?? 0, 0.3) };
    }

    return mapping;
  });
}

export { buildFieldMappingPrompt, buildFormSelectionPrompt, sanitizeProfile, validateFieldMappings };
