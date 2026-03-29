/**
 * form-detector.js — 表单检测模块
 * 扫描当前页面（含 iframe）的所有表单字段，输出结构化描述
 * 参考：hddevteam/smart-form-filler 的 formDetector.js
 */

// 忽略的 input 类型
const IGNORED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);
const FIELD_NODE_SELECTOR = 'input, select, textarea, button, option, [role="button"], [role="combobox"]';
const FIELD_CONTAINER_SELECTOR = '.form-row, .form-group, .field, .input-group, .question, li, td, tr, .entry-card, .ant-form-item, .el-form-item, .layui-form-item, .ivu-form-item, .row, .col, .ant-col, .el-col';
const LABEL_ELEMENT_SELECTOR = [
  'label',
  '.el-form-item__label',
  '.ant-form-item-label',
  '.ivu-form-item-label',
  '.layui-form-label',
  '[class*="label"]',
  '[class*="Label"]',
  '[class*="title"]',
  '[class*="Title"]',
  '[data-label]',
  'span',
  'div',
].join(', ');
const LABEL_NOISE_PATTERNS = [
  /^(请输入|请选择|请填写|点击选择|点击上传|上传文件|上传附件|搜索|请选择日期)/,
  /^(select|search|choose|upload)$/i,
  /^[*：:（）()\-\s]+$/,
];

const SECTION_TITLE_PATTERNS = /(信息|资料|经历|背景|能力|情况|说明|声明|附加|补充|profile|contact|education|experience|project|language|family|summary)/i;

function normalizeText(text, maxLen = 180) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cloneTextWithoutFields(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll(FIELD_NODE_SELECTOR).forEach(el => el.remove());
  return normalizeText(clone.textContent || '');
}

function cleanLabelText(text, maxLen = 80) {
  return normalizeText(text || '', maxLen)
    .replace(/^[*＊\s]+/, '')
    .replace(/\s*[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulLabelText(text) {
  const value = cleanLabelText(text);
  if (!value || value.length > 40) return false;
  if (LABEL_NOISE_PATTERNS.some(pattern => pattern.test(value))) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(value);
}

function uniqueTexts(items) {
  return [...new Set(
    (items || [])
      .map(item => cleanLabelText(item))
      .filter(isMeaningfulLabelText)
  )];
}

function nodeContainsField(node, el) {
  return Boolean(node && (node === el || node.contains?.(el)));
}

function nodeHasFieldControls(node) {
  return Boolean(node?.querySelector?.(FIELD_NODE_SELECTOR));
}

function hasVisibleAncestor(node, maxDepth = 5) {
  let current = node?.parentElement || null;
  let depth = 0;
  while (current && depth < maxDepth) {
    const style = window.getComputedStyle(current);
    if (style.display !== 'none' && style.visibility !== 'hidden' && (current.offsetWidth > 0 || current.offsetHeight > 0)) {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

function collectPreviousSiblingTexts(el, limit = 3) {
  const results = [];
  let prev = el.previousElementSibling;
  let guard = 0;
  while (prev && guard < limit) {
    const text = cleanLabelText(cloneTextWithoutFields(prev));
    if (isMeaningfulLabelText(text)) results.push(text);
    prev = prev.previousElementSibling;
    guard += 1;
  }
  return results;
}

function collectParentTextNodes(el) {
  const results = [];
  const parent = el.parentElement;
  if (!parent) return results;

  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanLabelText(node.textContent || '');
      if (isMeaningfulLabelText(text)) results.push(text);
    }
  }
  return results;
}

function collectNodeTexts(node, limit = 6) {
  if (!(node instanceof Element)) return [];
  const texts = [];
  const direct = cleanLabelText(cloneTextWithoutFields(node));
  if (isMeaningfulLabelText(direct)) texts.push(direct);

  const descendants = Array.from(node.querySelectorAll(LABEL_ELEMENT_SELECTOR))
    .filter(child => child instanceof Element && !nodeHasFieldControls(child))
    .slice(0, limit);

  for (const child of descendants) {
    const text = cleanLabelText(cloneTextWithoutFields(child));
    if (isMeaningfulLabelText(text)) texts.push(text);
  }

  return texts;
}

function collectAncestorSiblingTexts(el, maxDepth = 10, siblingLimit = 4) {
  const results = [];
  let current = el;
  let depth = 0;

  while (current?.parentElement && depth < maxDepth) {
    let previous = current.previousElementSibling;
    let guard = 0;
    while (previous && guard < siblingLimit) {
      results.push(...collectNodeTexts(previous));
      previous = previous.previousElementSibling;
      guard += 1;
    }

    const parent = current.parentElement;
    const siblings = Array.from(parent.children)
      .filter(node => node !== current)
      .slice(0, siblingLimit);
    for (const sibling of siblings) {
      results.push(...collectNodeTexts(sibling));
    }

    current = parent;
    depth += 1;
  }

  return uniqueTexts(results);
}

function collectContainerLabelTexts(el) {
  const containers = [];
  const direct = findFieldContainer(el);
  if (direct) containers.push(direct);

  const rowContainer = el.closest('.el-row, .ant-row, .row, tr, li, .grid, .flex');
  if (rowContainer && !containers.includes(rowContainer)) containers.push(rowContainer);

  const results = [];
  for (const container of containers) {
    const fieldRect = el.getBoundingClientRect();
    const fieldCenterY = (fieldRect.top + fieldRect.bottom) / 2;

    const nodes = Array.from(container.querySelectorAll(LABEL_ELEMENT_SELECTOR))
      .filter(node =>
        node instanceof Element &&
        !nodeContainsField(node, el) &&
        !nodeHasFieldControls(node)
      )
      .map(node => {
        const text = cleanLabelText(cloneTextWithoutFields(node));
        if (!isMeaningfulLabelText(text)) return null;

        const rect = node.getBoundingClientRect();
        if (!rect.width && !rect.height) return null;

        const nodeCenterY = (rect.top + rect.bottom) / 2;
        const verticalGap = Math.abs(nodeCenterY - fieldCenterY);
        const leftGap = fieldRect.left - rect.right;
        const aboveGap = fieldRect.top - rect.bottom;
        const alignedLeft = leftGap >= -8 && leftGap <= 240 && verticalGap <= 36;
        const alignedAbove = aboveGap >= -8 && aboveGap <= 28 && Math.abs(rect.left - fieldRect.left) <= 80;
        if (!alignedLeft && !alignedAbove) return null;

        return {
          text,
          score: alignedLeft
            ? leftGap + verticalGap
            : 60 + Math.max(0, aboveGap) + Math.abs(rect.left - fieldRect.left),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    results.push(...nodes.map(item => item.text));
  }

  return results;
}

function extractLabelCandidates(el, doc) {
  const candidates = [];

  if (el.id) {
    const label = doc.querySelector(`label[for="${el.id}"]`);
    if (label) candidates.push(label.textContent);
  }

  candidates.push(el.getAttribute('aria-label') || '');

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const labelEl = doc.getElementById(id);
      if (labelEl) candidates.push(labelEl.textContent);
    }
  }

  const parentLabel = el.closest('label');
  if (parentLabel) candidates.push(cloneTextWithoutFields(parentLabel));

  candidates.push(...collectPreviousSiblingTexts(el));
  candidates.push(...collectParentTextNodes(el));
  candidates.push(...collectContainerLabelTexts(el));
  candidates.push(...collectAncestorSiblingTexts(el));
  candidates.push(el.title || '');
  candidates.push(el.placeholder || '');

  return uniqueTexts(candidates);
}

function hasUniqueId(doc, id) {
  if (!id) return false;
  try {
    return doc.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1;
  } catch (_) {
    return false;
  }
}

/**
 * 为元素生成 CSS selector（简化版，优先用 id）
 * @param {Element} el
 * @param {Document} doc
 * @returns {string}
 */
function buildSelector(el, doc) {
  if (el.id && hasUniqueId(doc, el.id)) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
  if (siblings.length === 1) {
    const parentSel = buildSelector(parent, doc);
    return `${parentSel} > ${tag}`;
  }
  const idx = siblings.indexOf(el) + 1;
  const parentSel = buildSelector(parent, doc);
  return `${parentSel} > ${tag}:nth-of-type(${idx})`;
}

/**
 * 为元素生成 XPath
 * @param {Element} el
 * @returns {string}
 */
function buildXPath(el) {
  if (el.id && hasUniqueId(el.ownerDocument || document, el.id)) return `//*[@id="${el.id}"]`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(`${tag}[${idx}]`);
    } else {
      parts.unshift(tag);
    }
    node = parent;
  }
  return '/' + parts.join('/');
}

/**
 * 提取字段的 label 文本
 * 优先级：<label for="..."> → aria-label → placeholder → title → 父元素/相邻文本
 * @param {Element} el
 * @param {Document} doc
 * @returns {string}
 */
function extractLabel(el, doc) {
  // 1. <label for="id">
  if (el.id) {
    const label = doc.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. aria-label
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();

  // 3. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = doc.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  // 4. placeholder
  if (el.placeholder) return el.placeholder.trim();

  // 5. title
  if (el.title) return el.title.trim();

  // 6. 父元素 <label> 包裹
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // 去掉 input 本身的文本，取 label 的纯文本
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // 7. 前一个兄弟节点文本
  let prev = el.previousElementSibling;
  while (prev) {
    const text = prev.textContent.trim();
    if (text && text.length < 50) return text;
    prev = prev.previousElementSibling;
  }

  // 8. name 属性作为最后 fallback
  return el.name || el.id || '';
}

function extractHelperText(el) {
  const bits = [];

  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    for (const id of describedBy.split(/\s+/)) {
      const node = el.ownerDocument.getElementById(id);
      if (node) bits.push(node.textContent);
    }
  }

  let next = el.nextElementSibling;
  let guard = 0;
  while (next && guard < 2) {
    const text = normalizeText(next.textContent || '', 80);
    if (text && text.length >= 2) bits.push(text);
    next = next.nextElementSibling;
    guard++;
  }

  return normalizeText(bits.join(' '), 140);
}

function extractSectionLabel(el) {
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = normalizeText(legend.textContent || '', 60);
      if (text) return text;
    }
  }

  let current = el.parentElement;
  let depth = 0;
  while (current && depth < 10) {
    const heading = current.querySelector('h1, h2, h3, h4, h5, h6, .section-title, .form-section-title');
    if (heading) {
      const text = normalizeText(heading.textContent || '', 60);
      if (text) return text;
    }

    let previous = current.previousElementSibling;
    let guard = 0;
    while (previous && guard < 3) {
      const texts = collectNodeTexts(previous, 4);
      const sectionText = texts.find(text => SECTION_TITLE_PATTERNS.test(text));
      if (sectionText) return sectionText;
      previous = previous.previousElementSibling;
      guard += 1;
    }

    current = current.parentElement;
    depth++;
  }

  return '';
}

function extractContextText(el) {
  const fragments = [];
  const parent = el.parentElement;
  if (parent) {
    const parentText = cloneTextWithoutFields(parent);
    if (parentText) fragments.push(parentText);
  }

  const container = el.closest('.form-row, .form-group, .field, .input-group, .question, li, td, .entry-card');
  if (container && container !== parent) {
    const containerText = cloneTextWithoutFields(container);
    if (containerText) fragments.push(containerText);
  }

  return normalizeText(fragments.join(' '), 180);
}

function findFieldContainer(el) {
  return el.closest(FIELD_CONTAINER_SELECTOR);
}

function buildRepeatGroupKey(el, doc) {
  let current = el.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 24) {
    const controlCount = current.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"]').length;
    if (controlCount >= 2 && current.matches?.('form, .form[name], div.form')) {
      return buildSelector(current, doc);
    }
    current = current.parentElement;
    depth += 1;
  }

  const identityCandidates = [];
  const structuralCandidates = [];
  current = el.parentElement;
  depth = 0;

  while (current && current !== document.body && depth < 24) {
    const controlCount = current.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"]').length;
    const identity = current.id
      || current.getAttribute('data-id')
      || current.getAttribute('data-key')
      || current.getAttribute('data-index')
      || '';
    const className = normalizeText(current.className || '', 120);
    const looksStructured = Boolean(identity) || /(item|entry|card|panel|block|module|section|group|row|form)/i.test(className);

    if (controlCount >= 2 && looksStructured) {
      if (identity) identityCandidates.push(identity);
      else structuralCandidates.push(`${current.tagName.toLowerCase()}:${className}`);
    }

    current = current.parentElement;
    depth += 1;
  }

  if (identityCandidates.length) return identityCandidates[identityCandidates.length - 1];
  return structuralCandidates[0] || '';
}

/**
 * 提取 select/radio 的选项列表
 * @param {Element} el
 * @param {Document} doc
 * @returns {Array<{value: string, text: string}>}
 */
function extractOptions(el, doc) {
  if (el.tagName === 'SELECT') {
    return Array.from(el.options)
      .filter(o => o.value !== '')
      .map(o => ({ value: o.value, text: o.text.trim() }));
  }
  // radio group
  if (el.type === 'radio' && el.name) {
    return Array.from(doc.querySelectorAll(`input[type="radio"][name="${el.name}"]`))
      .map(r => ({
        value: r.value,
        text: extractLabel(r, doc) || r.value,
      }));
  }
  return [];
}

/**
 * 处理单个表单字段元素，返回字段描述对象
 * @param {Element} el
 * @param {Document} doc
 * @param {string} formId
 * @param {number} fieldIndex
 * @returns {object|null}
 */
function describeField(el, doc, formId, fieldIndex, adapter = null) {
  const tag = el.tagName.toLowerCase();
  let type = 'text';

  if (tag === 'input') {
    type = el.type || 'text';
    if (IGNORED_TYPES.has(type)) return null;
  } else if (tag === 'textarea') {
    type = 'textarea';
  } else if (tag === 'select') {
    type = 'select';
  }

  // 跳过不可见元素（display:none / visibility:hidden）。
  // 某些 ATS 会把 radio/checkbox input 隐藏，只保留外层可见壳子，这里保留这类控件。
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    if (!['radio', 'checkbox'].includes(type) || !hasVisibleAncestor(el)) return null;
  }

  const labelCandidates = extractLabelCandidates(el, doc);
  const label = labelCandidates[0] || extractLabel(el, doc);
  const options = extractOptions(el, doc);
  const helperText = extractHelperText(el);
  const sectionLabel = extractSectionLabel(el);
  const contextText = extractContextText(el);
  const container = findFieldContainer(el);

  // radio 字段只记录第一个，避免重复
  if (type === 'radio') {
    const seen = doc._jobpilotSeenRadios = doc._jobpilotSeenRadios || new Set();
    if (seen.has(el.name)) return null;
    seen.add(el.name);
  }

  const descriptor = {
    id: `${formId}_field_${fieldIndex}`,
    name: el.name || el.id || '',
    type,
    label,
    labelCandidates,
    placeholder: el.placeholder || '',
    title: el.title || '',
    required: el.required || el.getAttribute('aria-required') === 'true',
    options,
    helperText,
    sectionLabel,
    contextText,
    containerText: normalizeText(container?.textContent || '', 180),
    value: el.value || '',
    xpath: buildXPath(el),
    selector: buildSelector(el, doc),
    containerSelector: container ? buildSelector(container, doc) : '',
    repeatGroupKey: buildRepeatGroupKey(el, doc),
  };

  const patch = adapter?.enrichFieldDescriptor?.({
    element: el,
    field: descriptor,
    doc,
    helpers: {
      cleanLabelText,
      cloneTextWithoutFields,
      extractLabelCandidates,
      findFieldContainer,
      isMeaningfulLabelText,
      normalizeText,
      uniqueTexts,
    },
  });

  if (patch && typeof patch === 'object') {
    if (Array.isArray(patch.labelCandidates)) {
      descriptor.labelCandidates = uniqueTexts([...(descriptor.labelCandidates || []), ...patch.labelCandidates]);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'labelCandidates') continue;
      descriptor[key] = value;
    }
    descriptor.label = cleanLabelText(descriptor.label) || descriptor.labelCandidates?.[0] || descriptor.label;
  }

  if (!descriptor.label && descriptor.labelCandidates?.length) {
    descriptor.label = descriptor.labelCandidates[0];
  }

  return descriptor;
}

function propagateGroupSectionLabels(fields = []) {
  const groups = new Map();

  for (const field of fields) {
    if (!field.repeatGroupKey) continue;
    const group = groups.get(field.repeatGroupKey) || [];
    group.push(field);
    groups.set(field.repeatGroupKey, group);
  }

  for (const groupFields of groups.values()) {
    const sectionCounts = new Map();
    for (const field of groupFields) {
      if (!field.sectionLabel) continue;
      sectionCounts.set(field.sectionLabel, (sectionCounts.get(field.sectionLabel) || 0) + 1);
    }

    const bestSection = [...sectionCounts.entries()]
      .sort((left, right) => right[1] - left[1])[0]?.[0] || '';
    if (!bestSection) continue;

    for (const field of groupFields) {
      if (!field.sectionLabel) field.sectionLabel = bestSection;
    }
  }
}

/**
 * 从 document 中扫描所有表单字段
 * @param {Document} doc
 * @param {string} source  - "main" 或 "iframe"
 * @param {string} iframePath
 * @returns {Array<object>} forms 数组
 */
function scanDocument(doc, source = 'main', iframePath = '') {
  const forms = [];
  let formIndex = 0;
  const adapter = window.__jobpilotGetSiteAdapter?.({
    document: doc,
    location: doc.defaultView?.location || window.location,
  }) || null;

  // 重置 radio 去重记录
  delete doc._jobpilotSeenRadios;

  // 收集所有表单元素
  const formElements = Array.from(doc.forms);

  // 处理不在 <form> 内的独立字段
  const standaloneSelector = 'input:not(form input), textarea:not(form textarea), select:not(form select)';
  const standaloneFields = Array.from(doc.querySelectorAll(standaloneSelector));

  // 处理每个 <form>
  for (const form of formElements) {
    const formId = `form_${formIndex++}`;
    const fields = [];
    let fieldIndex = 0;

    const inputs = form.querySelectorAll('input, textarea, select');
    for (const el of inputs) {
      const field = describeField(el, doc, formId, fieldIndex, adapter);
      if (field) {
        field.source = source;
        field.iframePath = iframePath;
        fields.push(field);
        fieldIndex++;
      }
    }

    if (fields.length > 0) {
      propagateGroupSectionLabels(fields);
      forms.push({
        id: formId,
        name: form.name || form.id || form.getAttribute('action') || '',
        action: form.getAttribute('action') || '',
        source,
        iframePath,
        fields,
      });
    }
  }

  // 处理独立字段（合并为一个虚拟表单）
  if (standaloneFields.length > 0) {
    const formId = `form_${formIndex++}`;
    const fields = [];
    let fieldIndex = 0;
    for (const el of standaloneFields) {
      const field = describeField(el, doc, formId, fieldIndex, adapter);
      if (field) {
        field.source = source;
        field.iframePath = iframePath;
        fields.push(field);
        fieldIndex++;
      }
    }
    if (fields.length > 0) {
      propagateGroupSectionLabels(fields);
      forms.push({
        id: formId,
        name: '_standalone',
        action: '',
        source,
        iframePath,
        fields,
      });
    }
  }

  return forms;
}

/**
 * 主入口：扫描当前页面（含 iframe）的所有表单
 * @returns {object} { forms: [...], totalFields: number, scannedAt: string }
 */
function detectForms() {
  const allForms = [];

  // 扫描主文档
  const mainForms = scanDocument(document, 'main', '');
  allForms.push(...mainForms);

  // 扫描所有 iframe
  const iframes = document.querySelectorAll('iframe');
  for (let i = 0; i < iframes.length; i++) {
    try {
      const iframe = iframes[i];
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;

      const iframePath = iframe.src || `iframe[${i}]`;
      const iframeForms = scanDocument(iframeDoc, 'iframe', iframePath);
      allForms.push(...iframeForms);
    } catch (e) {
      // 跨域 iframe，无法访问，跳过
      console.debug('[JobPilot] 跳过跨域 iframe:', e.message);
    }
  }

  const totalFields = allForms.reduce((sum, f) => sum + f.fields.length, 0);

  return {
    forms: allForms,
    totalFields,
    scannedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
  };
}

// 监听来自 background/sidepanel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detectForms') {
    try {
      const result = detectForms();
      sendResponse({ success: true, data: result });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true; // 保持 sendResponse 有效
});

// 暴露到 window 供调试
window.__jobpilotDetectForms = detectForms;

// ── MutationObserver：监听 SPA 路由后新增的表单字段 ────────────
// 检测到 input/select/textarea 被添加到 DOM 后，通知侧边栏重新检测。
// 延迟 2 秒启动，避免页面初始加载时的大量 mutation 触发误检。
(function setupFormObserver() {
  const FORM_TAGS   = new Set(['FORM', 'INPUT', 'SELECT', 'TEXTAREA']);
  const OBSERVED_SELECTOR = 'input, select, textarea, [role="combobox"], [role="textbox"], [contenteditable="true"]';
  let _debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    const hasFormChange = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && (
          FORM_TAGS.has(n.tagName) ||
          n.matches?.(OBSERVED_SELECTOR) ||
          (n.querySelector && n.querySelector(OBSERVED_SELECTOR))
        )
      )
    );
    if (!hasFormChange) return;

    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'formsUpdated' }).catch(() => {});
    }, 600);
  });

  function startObserver() {
    if (!document.body) return false;
    observer.observe(document.body, { childList: true, subtree: true });
    return true;
  }

  if (!startObserver()) {
    const bootObserver = new MutationObserver(() => {
      if (!startObserver()) return;
      bootObserver.disconnect();
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  [400, 1200, 2500].forEach(delay => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'formsUpdated' }).catch(() => {});
    }, delay);
  });
})();
