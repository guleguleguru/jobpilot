const formFillerEnumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));
const formFillerFillReportModulePromise = import(chrome.runtime.getURL('lib/fill-report.js'));

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set;

const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value'
)?.set;

function triggerEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function dispatchKeyboardEvent(el, key) {
  if (!el?.dispatchEvent) return;
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function clickLikeUser(el) {
  if (!el) return;
  try {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  } catch (_) {}
  el.click?.();
}

function setInputValue(el, value) {
  el.focus();
  const setter = el.tagName === 'TEXTAREA' ? nativeTextareaSetter : nativeInputValueSetter;
  if (setter) setter.call(el, value);
  else el.value = value;
  triggerEvents(el);
}

function setContentEditableValue(el, value) {
  el.focus?.();
  el.textContent = value;
  triggerEvents(el);
}

function setTextLikeValue(el, value) {
  if (!el) return false;

  if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
    setContentEditableValue(el, value);
    return true;
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const previousReadOnly = el.readOnly;
    const previousDisabled = el.disabled;
    try {
      if (previousReadOnly) el.readOnly = false;
      if (previousDisabled) el.disabled = false;
      setInputValue(el, value);
      return true;
    } finally {
      if (previousReadOnly) el.readOnly = true;
      if (previousDisabled) el.disabled = true;
    }
  }

  if ('value' in el) {
    el.value = value;
    triggerEvents(el);
    return true;
  }

  setContentEditableValue(el, value);
  return true;
}

function setNativeSelectValue(el, value) {
  if (!el?.options || typeof el.options[Symbol.iterator] !== 'function') return false;
  for (const option of el.options) {
    if (option.value === value || option.text.trim() === value) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }

  const valueLower = String(value).toLowerCase();
  for (const option of el.options) {
    const optText = option.text.trim().toLowerCase();
    const optVal = option.value.toLowerCase();
    if (
      optText.includes(valueLower) ||
      valueLower.includes(optText) ||
      optVal.includes(valueLower) ||
      valueLower.includes(optVal)
    ) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }
  return false;
}

function setNativeRadioValue(el, value, doc) {
  const valueLower = String(value || '').trim().toLowerCase();
  const labelText = (el.labels?.[0]?.textContent || '').trim().toLowerCase();
  const currentValue = String(el.value || '').trim().toLowerCase();
  if (
    currentValue === valueLower ||
    currentValue.includes(valueLower) ||
    valueLower.includes(currentValue) ||
    labelText.includes(valueLower) ||
    valueLower.includes(labelText)
  ) {
    el.click();
    triggerEvents(el);
    return true;
  }

  const radios = el.name
    ? doc.querySelectorAll(`input[type="radio"][name="${el.name}"]`)
    : el.closest('fieldset, [role="radiogroup"], label, li, div')?.querySelectorAll('input[type="radio"]')
      || doc.querySelectorAll('input[type="radio"]');
  for (const radio of radios) {
    const radioLabel = radio.value.toLowerCase();
    const radioText = (radio.labels?.[0]?.textContent || '').trim().toLowerCase();
    if (
      radio.value === value ||
      radioLabel.includes(valueLower) ||
      valueLower.includes(radioLabel) ||
      radioText.includes(valueLower) ||
      valueLower.includes(radioText)
    ) {
      radio.click();
      triggerEvents(radio);
      return true;
    }
  }
  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr.replace(/\//g, '-');
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`;
  if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  return dateStr;
}

function normalizeLocatorText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()（）\-_/\\,.;:：，。'"`~!@#$%^&*+=?|[\]{}<>]/g, ' ')
    .trim();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isVisibleElement(el) {
  if (!(el instanceof Element)) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function buildLocatorNgrams(value = '') {
  const normalized = normalizeLocatorText(value).replace(/\s+/g, '');
  if (!normalized) return [];
  const result = [];
  for (let size = 2; size <= 3; size += 1) {
    if (normalized.length < size) continue;
    for (let i = 0; i <= normalized.length - size; i += 1) {
      result.push(normalized.slice(i, i + size));
    }
  }
  return [...new Set(result)];
}

function overlapRatio(left = [], right = []) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let hits = 0;
  for (const item of left) {
    if (rightSet.has(item)) hits += 1;
  }
  return hits / Math.max(left.length, 1);
}

function getControlFamily(type = 'text') {
  switch (type) {
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'choice';
    case 'radio':
    case 'checkbox':
      return 'check';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

const GENERIC_DROPDOWN_ROOT_SELECTOR = '.el-select-dropdown, .ant-select-dropdown, .ivu-select-dropdown, .layui-form-select, [role="listbox"], .dropdown-menu, .select-dropdown, .select-options, .ant-picker-dropdown, .el-picker-panel';
const GENERIC_DROPDOWN_OPTION_SELECTOR = '.el-select-dropdown__item, .ant-select-item-option, .ant-select-item-option-content, .ant-select-dropdown-menu-item, .ivu-select-item, .layui-this, [role="option"], .dropdown-item, .option, .select-option, li, td, button';

function collectSearchRoots(element, maxDepth = 4) {
  const roots = [];
  let current = element;
  let depth = 0;
  while (current?.parentElement && depth < maxDepth) {
    current = current.parentElement;
    roots.push(current);
    depth += 1;
  }
  return roots;
}

function getVisibleDropdownRoots(doc = document) {
  return Array.from(doc.querySelectorAll(GENERIC_DROPDOWN_ROOT_SELECTOR)).filter(isVisibleElement);
}

function resolvePopupRoot(trigger) {
  const popupId = trigger?.getAttribute?.('aria-controls') || trigger?.getAttribute?.('aria-owns') || '';
  if (!popupId) return null;
  return trigger.ownerDocument?.getElementById(popupId) || null;
}

function matchesChoiceText(text = '', value = '') {
  const left = normalizeLocatorText(text).replace(/\s+/g, '');
  const right = normalizeLocatorText(value).replace(/\s+/g, '');
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function matchesFilledText(text = '', value = '') {
  return matchesChoiceText(text, value);
}

function getFieldTimingHint(fieldEntry = {}) {
  const field = fieldEntry.field || fieldEntry;
  const combined = normalizeLocatorText([
    fieldEntry.key,
    field.label,
    ...(field.labelCandidates || []),
    field.placeholder,
    field.name,
    field.title,
    field.helperText,
  ].filter(Boolean).join(' '));

  if (/(startdate|starttime|start|from|begin|开始|起始|入学|入职)/.test(combined)) return 'start';
  if (/(enddate|endtime|end|until|finish|to|graduat|结束|截止|毕业|离职)/.test(combined)) return 'end';
  return '';
}

function looksLikeChoiceControl(el, field = {}) {
  if (!el) return false;
  if (field.type === 'select') return true;
  const identity = normalizeLocatorText([
    el.tagName || '',
    el.getAttribute?.('role') || '',
    el.getAttribute?.('aria-haspopup') || '',
    el.getAttribute?.('class') || '',
    el.getAttribute?.('data-testid') || '',
    el.getAttribute?.('placeholder') || '',
  ].join(' '));

  return field.type === 'search'
    || el.getAttribute?.('role') === 'combobox'
    || el.getAttribute?.('aria-haspopup') === 'listbox'
    || /(select|dropdown|picker|autocomplete|suggest|choose|search)/.test(identity);
}

function findChoiceOption(roots, value) {
  const exactPattern = new RegExp(`^${escapeRegExp(String(value || '').trim())}$`, 'i');
  const fuzzyPattern = new RegExp(escapeRegExp(String(value || '').trim()), 'i');

  for (const root of roots.filter(Boolean)) {
    const options = Array.from(root.querySelectorAll(GENERIC_DROPDOWN_OPTION_SELECTOR))
      .filter(option => isVisibleElement(option) && normalizeLocatorText(option.textContent || ''));
    const exact = options.find(option => exactPattern.test(String(option.textContent || '').trim()));
    if (exact) return exact;
    const fuzzy = options.find(option => fuzzyPattern.test(String(option.textContent || '').trim()) || matchesChoiceText(option.textContent || '', value));
    if (fuzzy) return fuzzy;
  }
  return null;
}

async function setGenericChoiceValue(element, value) {
  const text = String(value || '').trim();
  if (!text) return false;

  const doc = element?.ownerDocument || document;
  const trigger = element.closest?.('[role="combobox"], .ant-select, .el-select, .ivu-select, .select, .dropdown, .picker, .autocomplete')
    || element;

  clickLikeUser(trigger);
  clickLikeUser(element);
  trigger.focus?.();
  element.focus?.();

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable) {
    setTextLikeValue(element, text);
    dispatchKeyboardEvent(element, 'ArrowDown');
  }

  await new Promise(resolve => setTimeout(resolve, 120));

  const option = findChoiceOption(
    [
      resolvePopupRoot(trigger),
      ...getVisibleDropdownRoots(doc),
      ...collectSearchRoots(trigger, 4),
    ],
    text
  );

  if (option) {
    clickLikeUser(option);
    triggerEvents(element);
    return true;
  }

  const nearbyOption = Array.from(trigger.closest?.('[role="dialog"], form, section, .modal, .drawer, .panel, body')?.querySelectorAll?.('button, a, [role="option"], [role="button"], li, div, span') || [])
    .find(candidate => isVisibleElement(candidate) && matchesChoiceText(candidate.textContent || '', text));
  if (nearbyOption) {
    clickLikeUser(nearbyOption);
    triggerEvents(element);
    return true;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    dispatchKeyboardEvent(element, 'Enter');
    return matchesFilledText(element.value || trigger.textContent || '', text);
  }

  if (element.isContentEditable) {
    dispatchKeyboardEvent(element, 'Enter');
    return matchesFilledText(element.textContent || trigger.textContent || '', text);
  }

  return matchesFilledText(trigger.textContent || '', text);
}

function formatDateForElement(element, value) {
  const normalized = formatDate(value);
  const type = String(element?.getAttribute?.('type') || element?.type || '').toLowerCase();
  if (type === 'month') return normalized.slice(0, 7);
  if (type === 'date' && /^\d{4}-\d{2}$/.test(String(value || ''))) return `${value}-01`;
  return normalized;
}

function collectDateGroupInputs(element) {
  const root = element?.closest?.('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, .semi-datePicker, .date-range, .date-picker, .datepicker, .throne-biz-date-range-picker-wrapper, .ud__picker-rangeInput, .ud__picker-picker, .ud__picker-inputWrapper, [class*="picker"], [class*="date"], [role="group"], [role="combobox"]')
    || element?.parentElement
    || null;
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll('input, textarea, [role="combobox"], [role="textbox"], [contenteditable="true"]'))
    .filter(isVisibleElement);
}

function resolveDateTargetElement(element, fieldEntry = {}) {
  const inputs = collectDateGroupInputs(element);
  if (!inputs.length) return element;

  const hint = getFieldTimingHint(fieldEntry);
  if (hint === 'start') return inputs[0];
  if (hint === 'end') return inputs[inputs.length - 1];
  return element;
}

async function setGenericDateValue(element, value, fieldEntry = {}) {
  const formatted = formatDateForElement(element, value);
  const target = resolveDateTargetElement(element, fieldEntry);
  const trigger = target.closest?.('.ant-picker, .el-date-editor, .arco-picker, .semi-datepicker, .semi-datePicker, .date-range, .date-picker, .datepicker, .throne-biz-date-range-picker-wrapper, .ud__picker-rangeInput, .ud__picker-picker, .ud__picker-inputWrapper, [class*="picker"]')
    || target;

  clickLikeUser(trigger);
  clickLikeUser(target);
  target.focus?.();

  const wrote = setTextLikeValue(target, formatted);
  dispatchKeyboardEvent(target, 'Enter');
  triggerEvents(target);

  const confirmButton = findChoiceOption(getVisibleDropdownRoots(target.ownerDocument || document), '确定')
    || findChoiceOption(getVisibleDropdownRoots(target.ownerDocument || document), 'OK')
    || findChoiceOption(getVisibleDropdownRoots(target.ownerDocument || document), 'Apply');
  clickLikeUser(confirmButton);

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return wrote && matchesFilledText(target.value || '', formatted);
  }

  return wrote;
}

function collectElementLocatorText(el) {
  const parts = [
    el.getAttribute?.('aria-label') || '',
    el.getAttribute?.('placeholder') || '',
    el.getAttribute?.('title') || '',
    el.getAttribute?.('name') || '',
    el.id || '',
  ];

  if (el.labels?.length) {
    parts.push(...Array.from(el.labels).map(label => label.textContent || ''));
  }

  const parent = el.parentElement;
  if (parent) {
    parts.push(parent.textContent || '');
    const prev = parent.previousElementSibling;
    if (prev) parts.push(prev.textContent || '');
  }

  return normalizeLocatorText(parts.filter(Boolean).join(' '));
}

function getLocatorCandidates(doc, field) {
  const family = getControlFamily(field.type);
  if (family === 'textarea') return Array.from(doc.querySelectorAll('textarea'));
  if (family === 'check') return Array.from(doc.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
  if (family === 'choice') {
    return Array.from(doc.querySelectorAll('select, input, [role="combobox"], [contenteditable="true"]'))
      .filter(el => el.tagName === 'SELECT' || looksLikeChoiceControl(el, field) || el.closest?.('li'));
  }
  return Array.from(doc.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"], [contenteditable="true"]')).filter(el => {
    if (family === 'date') {
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute?.('role') === 'combobox';
    }
    if (el.tagName === 'SELECT') return false;
    if (el.getAttribute?.('role') === 'combobox' || el.getAttribute?.('role') === 'textbox' || el.getAttribute?.('contenteditable') === 'true') {
      return true;
    }
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    return !['radio', 'checkbox', 'file', 'hidden'].includes(type);
  });
}

function scoreElementForField(el, fieldEntry) {
  const field = fieldEntry.field || fieldEntry;
  const targetText = normalizeLocatorText([
    fieldEntry.key,
    field.label,
    ...(field.labelCandidates || []),
    field.placeholder,
    field.name,
    field.title,
    field.sectionLabel,
    field.contextText,
  ].filter(Boolean).join(' '));
  if (!targetText) return -Infinity;

  const elText = collectElementLocatorText(el);
  if (!elText) return -Infinity;

  const targetNgrams = buildLocatorNgrams(targetText);
  const elNgrams = buildLocatorNgrams(elText);
  let score = overlapRatio(targetNgrams, elNgrams) * 5;

  const targetPlaceholder = normalizeLocatorText(field.placeholder);
  const elPlaceholder = normalizeLocatorText(el.getAttribute?.('placeholder') || '');
  if (targetPlaceholder && elPlaceholder) {
    if (targetPlaceholder === elPlaceholder) score += 4;
    else if (elPlaceholder.includes(targetPlaceholder) || targetPlaceholder.includes(elPlaceholder)) score += 2;
  }

  const targetLabel = normalizeLocatorText(field.label);
  if (targetLabel && elText.includes(targetLabel)) score += 3;

  const targetName = normalizeLocatorText(field.name);
  const elName = normalizeLocatorText(el.getAttribute?.('name') || el.id || '');
  if (targetName && elName) {
    if (targetName === elName) score += 4;
    else if (elName.includes(targetName) || targetName.includes(elName)) score += 1.5;
  }

  const targetSection = normalizeLocatorText(field.sectionLabel);
  const parentText = normalizeLocatorText(el.parentElement?.textContent || '');
  if (targetSection && parentText.includes(targetSection)) score += 1.2;

  if (field.type === 'date') {
    const placeholder = normalizeLocatorText(el.getAttribute?.('placeholder') || '');
    if (/(日期|时间|date|time|选择)/.test(placeholder)) score += 1.5;

    const timingHint = getFieldTimingHint(fieldEntry);
    const elementText = normalizeLocatorText([
      el.getAttribute?.('placeholder') || '',
      el.getAttribute?.('name') || '',
      el.id || '',
      el.getAttribute?.('aria-label') || '',
      el.parentElement?.textContent || '',
    ].join(' '));
    if (timingHint === 'start') {
      if (/(start|from|begin|开始|起始|入学|入职)/.test(elementText)) score += 2.5;
      if (/(end|until|finish|结束|截止|毕业|离职)/.test(elementText)) score -= 2;
    }
    if (timingHint === 'end') {
      if (/(end|until|finish|结束|截止|毕业|离职)/.test(elementText)) score += 2.5;
      if (/(start|from|begin|开始|起始|入学|入职)/.test(elementText)) score -= 2;
    }
  }

  return score;
}

function locateElementByHeuristics(fieldEntry, doc) {
  const field = fieldEntry.field || fieldEntry;
  const candidates = getLocatorCandidates(doc, field)
    .map(el => ({ el, score: scoreElementForField(el, fieldEntry) }))
    .filter(item => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || best.score < 4.8) return null;
  const runnerUp = candidates[1];
  if (runnerUp && best.score - runnerUp.score < 0.6) return null;
  return best.el;
}

function locateElement(fieldEntry, doc) {
  const field = fieldEntry.field || fieldEntry;
  if (field.selector) {
    try {
      const el = doc.querySelector(field.selector);
      if (el) return el;
    } catch (_) {}
  }
  if (field.xpath) {
    try {
      const r = doc.evaluate(field.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (r.singleNodeValue) return r.singleNodeValue;
    } catch (_) {}
  }
  if (field.name) {
    const el = doc.querySelector(`[name="${CSS.escape(field.name)}"]`);
    if (el) return el;
  }
  return locateElementByHeuristics(fieldEntry, doc);
}

function parseRepeatPath(key = '') {
  const match = key.match(/^([a-zA-Z]+)\[(\d+)\]\./);
  if (!match) return null;
  return {
    section: match[1],
    index: Number(match[2]),
  };
}

function getFieldKey(entry) {
  return entry.key || entry.field?.normalizedKey || '';
}

function hasMeaningfulFields(entry = {}) {
  return Object.values(entry || {}).some(value => value !== '' && value != null);
}

const REPEATABLE_PROFILE_SECTIONS = ['education', 'experience', 'projects', 'awards', 'competitions', 'languages', 'languageExams', 'developerLanguages', 'familyMembers'];

function getRepeatTargets(profile = {}) {
  return REPEATABLE_PROFILE_SECTIONS
    .map(section => ({
      section,
      items: Array.isArray(profile[section]) ? profile[section].filter(hasMeaningfulFields) : [],
    }))
    .filter(item => item.items.length);
}

function getResultDocument(field) {
  let doc = document;
  if (field?.source === 'iframe' && field?.iframePath) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src === field.iframePath) {
        try {
          doc = iframe.contentDocument || iframe.contentWindow?.document || document;
        } catch (_) {}
        break;
      }
    }
  }
  return doc;
}

async function rerunMatch(profile) {
  const detectResult = window.__jobpilotDetectForms?.();
  if (!detectResult) return null;
  const matchResult = await window.__jobpilotMatchForms?.(detectResult, profile);
  if (!matchResult) return null;
  return { detectResult, matchResult };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REPEAT_SECTION_PATTERNS = {
  awards: /(\u83b7\u5956\u4fe1\u606f|\u83b7\u5956\u7ecf\u5386|\u5956\u9879|\u8363\u8a89|award|honor)/i,
  competitions: /(\u7ade\u8d5b|\u5927\u8d5b|\u6bd4\u8d5b|\u5927\u8d5b\u7ecf\u5386|\u7ade\u8d5b\u7ecf\u5386|\u6bd4\u8d5b\u7ecf\u5386|\u8d5b\u4e8b\u7ecf\u5386|competition)/i,
  developerLanguages: /(\u5f00\u53d1\u8bed\u8a00|\u6280\u672f\u5f00\u53d1\u8bed\u8a00|\u7f16\u7a0b\u8bed\u8a00|programming language|coding language)/i,
  education: /(教育经历|教育背景|学校|学历|学位|入学|毕业|education|academic)/i,
  experience: /(实习经历|工作经历|工作经验|单位名称|职位名称|实习内容|experience|intern)/i,
  projects: /(在校实践|校内实践|校园实践|项目经历|项目名称|实践名称|实践描述|project|practice)/i,
  languages: /(语言能力|外语能力|语种|语言类型|掌握程度|听说|读写|language)/i,
  languageExams: /(\u5916\u8bed\u8003\u8bd5|\u8bed\u8a00\u8003\u8bd5|\u8003\u8bd5\u7b49\u7ea7|\u5916\u8bed\u8003\u8bd5\/\u7b49\u7ea7|language exam|english test)/i,
  familyMembers: /(家庭情况|家庭成员|家属|与本人关系|身份类别|家庭所在地|family)/i,
};
const LANGUAGE_EXAM_REPEAT_STRUCTURAL_PATTERN = /(language_exam|exam_type|\b(?:cet|toefl|ielts|gre|gmat|tem|sat|act|cerf)\b)/i;

function inferRepeatSectionFromField(field = {}) {
  const structuralText = [
    field.selector,
    field.name,
    field.id,
    field.repeatGroupKey,
  ].filter(Boolean).join(' ');

  if (/(project_list|formily-item-project_list|formily-item-role\b|formily-item-link\b)/i.test(structuralText)) return 'projects';
  if (/(career_list|formily-item-career_list|formily-item-company\b|formily-item-title\b)/i.test(structuralText)) return 'experience';
  if (/(education_list|formily-item-school\b|formily-item-degree\b|field_of_study|education_type)/i.test(structuralText)) return 'education';
  if (/(formily-item-language\b|formily-item-proficiency\b)/i.test(structuralText)) return 'languages';
  if (LANGUAGE_EXAM_REPEAT_STRUCTURAL_PATTERN.test(structuralText)) return 'languageExams';

  for (const [sectionKey, pattern] of Object.entries(REPEAT_SECTION_PATTERNS)) {
    if (pattern.test(String(field.sectionLabel || ''))) return sectionKey;
  }

  const fallbackText = [
    field.label,
    ...(field.labelCandidates || []).slice(0, 2),
    field.placeholder,
  ].filter(Boolean).join(' ');

  for (const [sectionKey, pattern] of Object.entries(REPEAT_SECTION_PATTERNS)) {
    if (pattern.test(fallbackText)) return sectionKey;
  }
  return '';
}

function extractRepeatKeys(matchResult, sectionKey) {
  const keys = [];
  for (const entry of matchResult?.matched || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  for (const entry of matchResult?.unmatched || []) {
    if (entry.normalizedKey?.startsWith(`${sectionKey}[`)) keys.push(entry.normalizedKey);
  }
  for (const entry of matchResult?.diagnostics?.missingRequiredFields || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  for (const entry of matchResult?.diagnostics?.sensitiveFieldsSkipped || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  return [...new Set(keys)];
}

function getRepeatCount(matchResult, sectionKey) {
  const indices = new Set();
  for (const key of extractRepeatKeys(matchResult, sectionKey)) {
    const parsed = parseRepeatPath(key);
    if (parsed) indices.add(parsed.index);
  }
  return indices.size;
}

function getRepeatCountFromDetect(detectResult, sectionKey) {
  if (!detectResult?.forms?.length) return 0;

  const groupCounts = new Map();
  const labelCounts = new Map();
  for (const form of detectResult.forms) {
    for (const field of form.fields || []) {
      if (inferRepeatSectionFromField(field) !== sectionKey) continue;
      const labelText = String(field.label || '').trim();
      if (
        field.type === 'checkbox' &&
        /^(没有|无).*(经历|项目|奖项|竞赛|作品|语言|证书)/.test(labelText)
      ) {
        continue;
      }
      if (field.repeatGroupKey) {
        groupCounts.set(field.repeatGroupKey, (groupCounts.get(field.repeatGroupKey) || 0) + 1);
      }

      const normalizedLabel = labelText;
      if (!normalizedLabel || normalizedLabel === '至今') continue;
      labelCounts.set(normalizedLabel, (labelCounts.get(normalizedLabel) || 0) + 1);
    }
  }

  const groupCount = [...groupCounts.values()].filter(count => count >= 2).length;
  const labelCount = Math.max(0, ...labelCounts.values());

  // Once detect can distinguish repeat containers, trust the container groups.
  // Repeated labels like "开始时间 / 结束时间" appear across many sections and
  // can otherwise inflate the count for sections that only have one visible item.
  if (groupCount) return groupCount;
  return labelCount;
}

async function rerunMatchUntilRepeatCountChanges(profile, sectionKey, previousCount, attempts = 6) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(250 * attempt);
    }
    latest = await rerunMatch(profile);
    const nextCount = getRepeatCountFromDetect(latest?.detectResult, sectionKey)
      || getRepeatCount(latest?.matchResult, sectionKey);
    if (nextCount > previousCount) {
      return latest;
    }
  }
  return latest;
}

function mergeMappings(baseMappings, repeatMappings) {
  const sectionsToReplace = new Set(
    repeatMappings
      .map(entry => parseRepeatPath(getFieldKey(entry))?.section)
      .filter(Boolean)
  );

  const next = baseMappings.filter(entry => {
    const parsed = parseRepeatPath(getFieldKey(entry));
    return !parsed || !sectionsToReplace.has(parsed.section);
  });

  const seenFieldIds = new Set(next.map(entry => entry.field?.id).filter(Boolean));
  for (const entry of repeatMappings) {
    if (seenFieldIds.has(entry.field?.id)) continue;
    seenFieldIds.add(entry.field?.id);
    next.push({ ...entry, source: entry.source || 'regex' });
  }

  return next;
}

async function ensureRepeatableSections(profile, adapter, report, reportUtils) {
  if (!profile || !adapter) {
    return { latestMatch: null, repeatSupport: {} };
  }

  const repeatTargets = getRepeatTargets(profile);
  if (!repeatTargets.length) {
    return { latestMatch: null, repeatSupport: {} };
  }

  let latest = await rerunMatch(profile);
  const repeatSupport = {};

  for (const target of repeatTargets) {
    const existingDetectedCount = getRepeatCountFromDetect(latest?.detectResult, target.section);
    const sectionReport = {
      section: target.section,
      expected: target.items.length,
      existing: existingDetectedCount || getRepeatCount(latest?.matchResult, target.section),
      created: 0,
      filled: 0,
      warnings: [],
    };

    let currentCount = sectionReport.existing;
    let guard = 0;
    while (currentCount < target.items.length && guard < target.items.length + 2) {
      const outcome = await adapter.ensureRepeatItem(target.section, currentCount, {
        profile,
        currentCount,
        desiredCount: target.items.length,
        detectResult: latest?.detectResult,
        matchResult: latest?.matchResult,
        document,
        location,
      });

      if (!outcome?.created) {
        const fallbackMatch = await rerunMatchUntilRepeatCountChanges(profile, target.section, currentCount);
        const fallbackCount = getRepeatCountFromDetect(fallbackMatch?.detectResult, target.section)
          || getRepeatCount(fallbackMatch?.matchResult, target.section);
        if (fallbackCount > currentCount) {
          sectionReport.created += 1;
          latest = fallbackMatch;
          currentCount = fallbackCount;
          guard += 1;
          continue;
        }
        sectionReport.warnings.push(
          outcome?.reason
            ? `${target.section}: ${outcome.reason}`
            : `${target.section}: unable_to_create_repeat_item`
        );
        break;
      }

      sectionReport.created += 1;
      latest = await rerunMatchUntilRepeatCountChanges(profile, target.section, currentCount);
      const nextCount = getRepeatCountFromDetect(latest?.detectResult, target.section)
        || getRepeatCount(latest?.matchResult, target.section);
      if (nextCount <= currentCount) {
        sectionReport.warnings.push(`${target.section}: repeat_item_created_but_not_detected`);
        break;
      }
      currentCount = nextCount;
      guard += 1;
    }

    repeatSupport[target.section] = currentCount >= target.items.length;
    reportUtils.upsertRepeatSection(report, sectionReport);
  }

  for (const sectionReport of report.repeatSections || []) {
    const finalCount = getRepeatCountFromDetect(latest?.detectResult, sectionReport.section)
      || getRepeatCount(latest?.matchResult, sectionReport.section);
    if (finalCount >= sectionReport.expected) {
      repeatSupport[sectionReport.section] = true;
      sectionReport.warnings = (sectionReport.warnings || []).filter(
        warning => !String(warning || '').endsWith('repeat_item_created_but_not_detected')
      );
    }
  }

  if (latest?.matchResult?.diagnostics) {
    reportUtils.mergeDiagnosticsIntoReport(report, latest.matchResult.diagnostics);
  }

  return { latestMatch: latest, repeatSupport };
}

async function normalizeRuntimeValue(fieldEntry, adapter) {
  const field = fieldEntry.field;
  const rawValue = fieldEntry.rawValue ?? fieldEntry.value;
  if (rawValue == null || rawValue === '') {
    return { ok: false, reason: 'empty_value' };
  }

  if (!['select', 'radio', 'checkbox'].includes(field.type) || !field.options?.length) {
    return { ok: true, value: String(fieldEntry.value ?? rawValue), rawValue: String(rawValue) };
  }

  const directOption = field.options.find(option => option.value === String(fieldEntry.value));
  if (directOption) {
    return {
      ok: true,
      value: String(directOption.value),
      rawValue: String(rawValue),
    };
  }

  const enumMappings = await formFillerEnumMappingsModulePromise;
  const adapterOverride = adapter?.mapEnumValue?.(getFieldKey(fieldEntry), String(rawValue), {
    field,
    options: field.options,
    location,
    document,
  }) || null;

  const mapped = enumMappings.mapEnumValue({
    fieldKey: getFieldKey(fieldEntry),
    value: String(rawValue),
    options: field.options,
    adapterOverride,
  });

  if (!mapped.matched) {
    return { ok: false, reason: 'unmapped_value', rawValue: String(rawValue) };
  }

  return {
    ok: true,
    value: String(mapped.mappedValue),
    rawValue: String(rawValue),
  };
}

async function fillField(fieldEntry, doc, context) {
  const { field } = fieldEntry;
  const { adapter, report } = context;

  if (!fieldEntry.value && !fieldEntry.isFile) {
    return { fieldId: field.id, status: 'skipped', message: 'empty_value', key: getFieldKey(fieldEntry) };
  }

  let el = locateElement(fieldEntry, doc);
  if (!el) {
    await adapter?.ensureFieldReady?.({ fieldEntry, document: doc, location });
    el = locateElement(fieldEntry, doc);
  }
  if (!el) {
    report.warnings.push(`element_not_found:${field.id}`);
    return { fieldId: field.id, status: 'error', message: 'element_not_found', key: getFieldKey(fieldEntry) };
  }

  const runtimeValue = await normalizeRuntimeValue(fieldEntry, adapter);
  if (!runtimeValue.ok && !fieldEntry.isFile) {
    report.unmappedValues.push({
      fieldId: field.id,
      label: field.label || field.name || field.id,
      key: getFieldKey(fieldEntry),
      value: runtimeValue.rawValue || String(fieldEntry.value || ''),
      options: (field.options || []).slice(0, 12),
      required: Boolean(field.required),
    });
    return { fieldId: field.id, status: 'skipped', message: runtimeValue.reason, key: getFieldKey(fieldEntry) };
  }

  const value = runtimeValue.value;
  const utils = {
    setInputValue,
    setTextLikeValue,
    setNativeRadioValue,
    setNativeSelectValue,
    setGenericChoiceValue,
    setGenericDateValue,
    triggerEvents,
  };

  try {
    if (field.type === 'select') {
      const adapterHandled = await adapter?.setSelectValue?.({ element: el, field, value, context, utils });
      const ok = adapterHandled == null
        ? (setNativeSelectValue(el, value) || await setGenericChoiceValue(el, value))
        : (adapterHandled || setNativeSelectValue(el, value) || await setGenericChoiceValue(el, value));
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : 'no_matching_option', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'radio') {
      const adapterHandled = await adapter?.setRadioValue?.({ element: el, field, value, context, utils });
      const ok = adapterHandled == null ? setNativeRadioValue(el, value, doc) : (adapterHandled || setNativeRadioValue(el, value, doc));
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : 'no_matching_option', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'checkbox') {
      const shouldCheck = /true|yes|是|1/i.test(value);
      if (el.checked !== shouldCheck) el.click();
      triggerEvents(el);
      return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'date') {
      const formattedValue = formatDateForElement(el, value);
      const adapterHandled = await adapter?.setDateValue?.({ element: el, field, value: formattedValue, context, utils });
      if (adapterHandled == null || adapterHandled === false) {
        const ok = await setGenericDateValue(el, formattedValue, fieldEntry);
        if (!ok) setTextLikeValue(el, formattedValue);
      }
      return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'file') {
      if (typeof window.__jobpilotUploadFile === 'function' && fieldEntry.fileData) {
        const result = window.__jobpilotUploadFile(el, fieldEntry.fileData);
        return {
          fieldId: field.id,
          status: result.success ? 'filled' : 'skipped',
          message: result.success ? `uploaded:${result.method}` : 'manual_resume_upload_required',
          key: getFieldKey(fieldEntry),
        };
      }
      return { fieldId: field.id, status: 'skipped', message: 'manual_resume_upload_required', key: getFieldKey(fieldEntry) };
    }

    if (looksLikeChoiceControl(el, field)) {
      const ok = await setGenericChoiceValue(el, value);
      if (!ok) setTextLikeValue(el, value);
    } else {
      setTextLikeValue(el, value);
    }
    return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
  } catch (error) {
    report.warnings.push(`fill_error:${field.id}:${error.message}`);
    return { fieldId: field.id, status: 'error', message: error.message, key: getFieldKey(fieldEntry) };
  }
}

function applyFieldOutcomesToRepeatSections(report, results) {
  for (const section of report.repeatSections || []) {
    const indices = new Set();
    for (const result of results) {
      if (result.status !== 'filled') continue;
      const parsed = parseRepeatPath(result.key);
      if (parsed?.section === section.section) indices.add(parsed.index);
    }
    section.filled = indices.size;
  }
}

function reconcileRepeatSectionWarnings(report) {
  for (const section of report.repeatSections || []) {
    if ((section.filled || 0) < (section.expected || 0)) continue;
    section.warnings = (section.warnings || []).filter(
      warning => !String(warning || '').endsWith('repeat_item_created_but_not_detected')
    );
  }
}

async function fillForms(mappings, options = {}) {
  const reportUtils = await formFillerFillReportModulePromise;
  const adapter = window.__jobpilotGetSiteAdapter?.({ document, location }) || null;
  const initialDetect = window.__jobpilotDetectForms?.();
  const report = reportUtils.createFillReport({
    hostname: location.hostname,
    pageTitle: document.title,
    adapterUsed: adapter?.id || 'generic',
    detectedCount: initialDetect?.totalFields || mappings.length,
  });

  reportUtils.mergeDiagnosticsIntoReport(report, options.diagnostics || {});
  const beforeFillMeta = await adapter?.beforeFill?.({ document, location, mappings, profile: options.profile });
  if (beforeFillMeta?.warnings?.length) report.warnings.push(...beforeFillMeta.warnings);

  const repeatSections = new Set(getRepeatTargets(options.profile || {}).map(item => item.section));
  const repeatResolution = await ensureRepeatableSections(options.profile, adapter, report, reportUtils);
  const repeatMappings = repeatResolution.latestMatch?.matchResult?.matched
    ?.filter(entry => {
      const parsed = parseRepeatPath(entry.key);
      return parsed && repeatSections.has(parsed.section);
    })
    .map(entry => ({ ...entry, source: 'regex' })) || [];

  if (repeatResolution.latestMatch?.matchResult?.diagnostics) {
    reportUtils.mergeDiagnosticsIntoReport(report, repeatResolution.latestMatch.matchResult.diagnostics);
  }

  let effectiveMappings = repeatMappings.length ? mergeMappings(mappings, repeatMappings) : mappings.slice();
  effectiveMappings = effectiveMappings.map(entry => ({
    ...entry,
    profile: options.profile || null,
    fillDiagnostics: options.diagnostics || null,
  }));

  const results = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of effectiveMappings) {
    const doc = getResultDocument(entry.field);
    const result = await fillField(entry, doc, { adapter, report });
    results.push(result);
    reportUtils.recordFieldOutcome(report, result);
    if (result.status === 'filled') filled += 1;
    else if (result.status === 'skipped') skipped += 1;
    else errors += 1;
  }

  applyFieldOutcomesToRepeatSections(report, results);
  reconcileRepeatSectionWarnings(report);

  const adapterHints = adapter?.getDiagnosticsHints?.({
    document,
    location,
    profile: options.profile,
    repeatSupport: repeatResolution.repeatSupport,
  }) || [];
  report.warnings.push(...adapterHints);

  const adapterDiagnostics = adapter?.getRuntimeDiagnostics?.() || null;
  if (adapterDiagnostics?.triggerAttempts?.length) {
    report.adapterDiagnostics = {
      ...(report.adapterDiagnostics || {}),
      triggerAttempts: [
        ...((report.adapterDiagnostics && report.adapterDiagnostics.triggerAttempts) || []),
        ...adapterDiagnostics.triggerAttempts,
      ],
    };
  }

  const afterFillMeta = await adapter?.afterFill?.({ document, location, results, report });
  if (afterFillMeta?.warnings?.length) report.warnings.push(...afterFillMeta.warnings);

  return {
    results,
    summary: { filled, skipped, errors, total: effectiveMappings.length },
    report: reportUtils.finalizeFillReport(report),
  };
}

function highlightFieldEl(field) {
  const doc = getResultDocument(field);
  const el = locateElement({ field }, doc);
  if (!el) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = { outline: el.style.outline, boxShadow: el.style.boxShadow, transition: el.style.transition };
  el.style.transition = 'all 0.2s';
  el.style.outline = '3px solid #2563eb';
  el.style.boxShadow = '0 0 0 6px rgba(37,99,235,0.2)';
  el.focus?.();
  setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.boxShadow = prev.boxShadow;
  }, 2000);
  return true;
}

async function handleQuickFill() {
  const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
  if (!profileResp?.success || !profileResp.data) {
    showInPageToast('JobPilot：请先在侧边栏填写个人资料', '#ef4444');
    return { success: false };
  }
  const profile = profileResp.data;

  const detectResult = window.__jobpilotDetectForms?.();
  if (!detectResult || detectResult.totalFields === 0) {
    showInPageToast('JobPilot：当前页面未检测到表单', '#6b7280');
    return { success: false };
  }

  const matchResult = await window.__jobpilotMatchForms?.(detectResult, profile);
  const fillResult = await fillForms(
    (matchResult?.matched || []).map(entry => ({ ...entry, source: 'regex' })),
    { profile, diagnostics: matchResult?.diagnostics || {} }
  );

  const { filled, skipped } = fillResult.summary;
  showInPageToast(`JobPilot 填写完成：${filled} 个成功，${skipped} 个跳过`, '#16a34a');
  return { success: true, data: fillResult };
}

function showInPageToast(msg, bg = '#1f2937') {
  const id = '__jobpilot_quick_toast';
  document.getElementById(id)?.remove();
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
    `background:${bg}`, 'color:#fff', 'padding:11px 16px',
    'border-radius:10px', 'font:13px/1.5 system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'max-width:320px',
  ].join(';');
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.action;

  if (action === 'fillForms') {
    (async () => {
      try {
        const result = await fillForms(message.mappings, {
          profile: message.profile,
          diagnostics: message.diagnostics,
        });
        sendResponse({ success: true, data: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (action === 'highlightField') {
    const ok = highlightFieldEl(message.field);
    sendResponse({ success: ok });
    return true;
  }

  if (action === 'refillField') {
    (async () => {
      try {
        const result = await fillField({ field: message.field, value: message.value }, document, {
          adapter: window.__jobpilotGetSiteAdapter?.({ document, location }) || null,
          report: (await formFillerFillReportModulePromise).createFillReport({
            hostname: location.hostname,
            pageTitle: document.title,
            adapterUsed: window.__jobpilotGetSiteAdapter?.({ document, location })?.id || 'generic',
          }),
        });
        sendResponse({ success: true, data: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (action === 'quickFill') {
    (async () => {
      try {
        const result = await handleQuickFill();
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return true;
});

window.__jobpilotFormFillerDebug = {
  getFieldTimingHint,
  getRepeatCountFromDetect,
  inferRepeatSectionFromField,
  reconcileRepeatSectionWarnings,
  resolveDateTargetElement,
  scoreElementForField,
};

window.__jobpilotFillForms = fillForms;
window.__jobpilotFillField = fillField;
