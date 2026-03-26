/**
 * form-detector.js — 表单检测模块
 * 扫描当前页面（含 iframe）的所有表单字段，输出结构化描述
 * 参考：hddevteam/smart-form-filler 的 formDetector.js
 */

// 忽略的 input 类型
const IGNORED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);

function normalizeText(text, maxLen = 180) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cloneTextWithoutFields(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll('input, select, textarea, button, option').forEach(el => el.remove());
  return normalizeText(clone.textContent || '');
}

/**
 * 为元素生成 CSS selector（简化版，优先用 id）
 * @param {Element} el
 * @param {Document} doc
 * @returns {string}
 */
function buildSelector(el, doc) {
  if (el.id) return `#${CSS.escape(el.id)}`;
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
  if (el.id) return `//*[@id="${el.id}"]`;
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
  while (current && depth < 5) {
    const heading = current.querySelector('h1, h2, h3, h4, h5, h6, .section-title, .form-section-title');
    if (heading) {
      const text = normalizeText(heading.textContent || '', 60);
      if (text) return text;
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
function describeField(el, doc, formId, fieldIndex) {
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

  // 跳过不可见元素（display:none / visibility:hidden）
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return null;

  const label = extractLabel(el, doc);
  const options = extractOptions(el, doc);
  const helperText = extractHelperText(el);
  const sectionLabel = extractSectionLabel(el);
  const contextText = extractContextText(el);

  // radio 字段只记录第一个，避免重复
  if (type === 'radio') {
    const seen = doc._jobpilotSeenRadios = doc._jobpilotSeenRadios || new Set();
    if (seen.has(el.name)) return null;
    seen.add(el.name);
  }

  return {
    id: `${formId}_field_${fieldIndex}`,
    name: el.name || el.id || '',
    type,
    label,
    placeholder: el.placeholder || '',
    title: el.title || '',
    required: el.required || el.getAttribute('aria-required') === 'true',
    options,
    helperText,
    sectionLabel,
    contextText,
    value: el.value || '',
    xpath: buildXPath(el),
    selector: buildSelector(el, doc),
  };
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
      const field = describeField(el, doc, formId, fieldIndex);
      if (field) {
        field.source = source;
        field.iframePath = iframePath;
        fields.push(field);
        fieldIndex++;
      }
    }

    if (fields.length > 0) {
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
      const field = describeField(el, doc, formId, fieldIndex);
      if (field) {
        field.source = source;
        field.iframePath = iframePath;
        fields.push(field);
        fieldIndex++;
      }
    }
    if (fields.length > 0) {
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
  let _debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    const hasFormChange = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && (
          FORM_TAGS.has(n.tagName) ||
          (n.querySelector && n.querySelector('input, select, textarea'))
        )
      )
    );
    if (!hasFormChange) return;

    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'formsUpdated' }).catch(() => {});
    }, 600);
  });

  setTimeout(() => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }, 2000);
})();
