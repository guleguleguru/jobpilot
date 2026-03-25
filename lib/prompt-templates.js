/**
 * prompt-templates.js — AI Prompt 模板集合
 * Stage 1: 表单相关性分析（多 form 页面时选最相关的）
 * Stage 2: 字段映射（核心，把未命中字段发给 AI）
 */

/**
 * 精简 profile，去掉空字段和敏感字段，控制 token 用量
 * @param {object} profile
 * @returns {object}
 */
function sanitizeProfile(profile) {
  const clean = {};

  const copy = (src, dst, keys) => {
    for (const k of keys) {
      if (src[k] != null && src[k] !== '') dst[k] = src[k];
    }
  };

  copy(profile, clean, [
    'name', 'firstName', 'lastName', 'gender', 'birthday',
    'graduationYear', 'ethnicity', 'hometown', 'politicalStatus',
    'documentType',
    'phone', 'email', 'address', 'wechat',
    'selfIntro',
  ]);

  if (profile.jobPreferences) {
    const jobPreferences = {};
    copy(profile.jobPreferences, jobPreferences, [
      'expectedCity', 'availableFrom', 'expectedSalary', 'internshipDuration',
    ]);
    if (Object.keys(jobPreferences).length) clean.jobPreferences = jobPreferences;
  }

  // 教育
  if (Array.isArray(profile.education)) {
    const education = profile.education
      .slice(0, 2)
      .map(entry => {
        const edu = {};
        copy(entry || {}, edu, ['school', 'major', 'degree', 'startDate', 'endDate', 'gpa']);
        return edu;
      })
      .filter(entry => Object.keys(entry).length > 0);
    if (education.length) clean.education = education;
  } else if (profile.education) {
    const edu = {};
    copy(profile.education, edu, ['school', 'major', 'degree', 'startDate', 'endDate', 'gpa']);
    if (Object.keys(edu).length) clean.education = [edu];
  }

  // 工作经历（最多 2 条）
  if (Array.isArray(profile.experience)) {
    const exps = profile.experience
      .slice(0, 2)
      .map(e => {
        const exp = {};
        copy(e, exp, ['company', 'title', 'startDate', 'endDate', 'description']);
        return exp;
      })
      .filter(e => Object.keys(e).length > 0);
    if (exps.length) clean.experience = exps;
  }

  if (Array.isArray(profile.projects)) {
    const projects = profile.projects
      .slice(0, 2)
      .map(project => {
        const result = {};
        copy(project || {}, result, ['name', 'role', 'startDate', 'endDate', 'description']);
        return result;
      })
      .filter(project => Object.keys(project).length > 0);
    if (projects.length) clean.projects = projects;
  }

  if (Array.isArray(profile.awards)) {
    const awards = profile.awards
      .slice(0, 3)
      .map(award => {
        const result = {};
        copy(award || {}, result, ['name', 'issuer', 'year']);
        return result;
      })
      .filter(award => Object.keys(award).length > 0);
    if (awards.length) clean.awards = awards;
  }

  if (Array.isArray(profile.languages)) {
    const languages = profile.languages
      .slice(0, 3)
      .map(language => {
        const result = {};
        copy(language || {}, result, ['name', 'level']);
        return result;
      })
      .filter(language => Object.keys(language).length > 0);
    if (languages.length) clean.languages = languages;
  }

  // 技能
  if (Array.isArray(profile.skills) && profile.skills.length) {
    clean.skills = profile.skills.join(', ');
  } else if (profile.skills) {
    clean.skills = profile.skills;
  }

  // 链接
  if (profile.links) {
    const links = {};
    copy(profile.links, links, ['github', 'linkedin', 'website']);
    if (Object.keys(links).length) clean.links = links;
  }

  // 明确不包含：idNumber、resumeFilePath
  return clean;
}

/**
 * 将字段描述精简为 prompt 友好格式
 * @param {object} field
 * @returns {object}
 */
function summarizeField(field) {
  const f = {
    id: field.id,
    label: field.label || '',
    type: field.type,
  };
  if (field.placeholder) f.placeholder = field.placeholder;
  if (field.name) f.fieldName = field.name;
  if (field.helperText) f.helperText = field.helperText;
  if (field.sectionLabel) f.sectionLabel = field.sectionLabel;
  if (field.contextText) f.contextText = field.contextText;
  if (field.required) f.required = true;
  if (field.options?.length) {
    // 最多 20 个选项，避免 prompt 过长
    f.options = field.options.slice(0, 20).map(o => ({ value: o.value, text: o.text }));
  }
  return f;
}

// ── Stage 1: 表单相关性分析 ───────────────────────────────────

/**
 * 构建 Stage 1 prompt：从多个 form 中选出求职申请表
 * @param {object[]} forms - form-detector 输出的 forms 数组
 * @returns {object[]} messages
 */
function buildFormSelectionPrompt(forms) {
  const formsDesc = forms.map(f => ({
    id: f.id,
    name: f.name,
    fieldCount: f.fields.length,
    // 只发字段 label 列表，不发完整字段描述，节省 token
    fieldLabels: f.fields.map(fld => fld.label || fld.name).filter(Boolean).slice(0, 20),
  }));

  const systemMsg = `你是一个表单分析助手。判断页面上哪个表单是求职/招聘申请表单。
只返回 JSON，格式：{"recommendedFormId": "form_0", "confidence": 0.95}`;

  const userMsg = `页面表单列表：
${JSON.stringify(formsDesc, null, 2)}

请分析哪个表单是求职申请表单，返回 JSON。`;

  return [
    { role: 'system', content: systemMsg },
    { role: 'user', content: userMsg },
  ];
}

// ── Stage 2: 字段映射 ─────────────────────────────────────────

/**
 * 构建 Stage 2 prompt：为未匹配字段生成填写值
 * @param {object[]} fields - 未匹配的字段列表（form-detector 格式）
 * @param {object} profile - 用户个人资料（sanitized）
 * @returns {object[]} messages
 */
function buildFieldMappingPrompt(fields, profile) {
  const profileJSON = JSON.stringify(sanitizeProfile(profile), null, 2);
  const fieldsJSON = JSON.stringify(fields.map(summarizeField), null, 2);

  const systemMsg = `你是一个求职表单自动填写助手。根据用户的个人资料，为表单字段生成合适的填写值。

规则：
1. 根据字段的 label、placeholder、type、fieldName 理解语义
2. 从用户资料中找最匹配的值
3. select/radio 类型：suggestedValue 必须是 options 数组中的某个 value 值（不是 text）
4. 开放性问题（如"为什么想加入""自我介绍"）：结合用户资料生成简短、自然、积极的中文回答（100字以内）
5. 无法推断的字段：设 confidence 为 0，suggestedValue 为 null
6. 不要编造不在资料中的事实（如虚构公司名、学历等）

只返回 JSON，格式：
{
  "fieldMappings": [
    {
      "fieldId": "form_0_field_3",
      "suggestedValue": "填写的值或null",
      "confidence": 0.9,
      "reasoning": "简短说明"
    }
  ]
}`;

  const userMsg = `用户个人资料：
${profileJSON}

需要填写的表单字段（已通过正则匹配过滤，以下是无法自动匹配的）：
${fieldsJSON}

请为每个字段生成填写值，返回 JSON。`;

  return [
    { role: 'system', content: systemMsg },
    { role: 'user', content: userMsg },
  ];
}

/**
 * 验证并修复 Stage 2 的 AI 输出
 * 确保 select/radio 的值在 options 中
 * @param {object[]} fieldMappings - AI 返回的映射
 * @param {object[]} fields - 原始字段（含 options）
 * @returns {object[]} 修复后的映射
 */
function validateFieldMappings(fieldMappings, fields) {
  return fieldMappings.map(mapping => {
    const field = fields.find(f => f.id === mapping.fieldId);
    if (!field || !mapping.suggestedValue) return mapping;

    // select/radio：验证 value 在 options 中
    if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
      const options = field.options;
      const val = String(mapping.suggestedValue);

      // 精确匹配 value
      if (options.some(o => o.value === val)) return mapping;

      // AI 可能返回了 text 而非 value，尝试反查
      const byText = options.find(o => o.text === val || o.text.includes(val) || val.includes(o.text));
      if (byText) {
        return { ...mapping, suggestedValue: byText.value };
      }

      // 找不到匹配项，降低置信度
      return { ...mapping, confidence: Math.min(mapping.confidence, 0.3) };
    }

    return mapping;
  });
}

export { buildFormSelectionPrompt, buildFieldMappingPrompt, validateFieldMappings, sanitizeProfile };
