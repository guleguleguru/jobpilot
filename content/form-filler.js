/**
 * form-filler.js — 表单填写模块
 * 根据匹配结果（label-matcher 或 AI）将值写入 DOM
 * 参考：sainikhil1605/ApplyEase 的 contentscript.js
 */

// 用于兼容 React 受控组件的原生 setter
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
)?.set;

const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
)?.set;

function triggerEvents(el) {
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
}

function setInputValue(el, value) {
  el.focus();
  const setter = el.tagName === 'TEXTAREA' ? nativeTextareaSetter : nativeInputValueSetter;
  if (setter) setter.call(el, value);
  else el.value = value;
  triggerEvents(el);
}

function setSelectValue(el, value) {
  for (const option of el.options) {
    if (option.value === value || option.text.trim() === value) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }
  const valueLower = value.toLowerCase();
  for (const option of el.options) {
    const optText = option.text.trim().toLowerCase();
    const optVal  = option.value.toLowerCase();
    if (optText.includes(valueLower) || valueLower.includes(optText) ||
        optVal.includes(valueLower)  || valueLower.includes(optVal)) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }
  return false;
}

function setRadioValue(el, value, doc) {
  const radios = doc.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
  const valueLower = value.toLowerCase();
  for (const radio of radios) {
    const radioLabel = radio.value.toLowerCase();
    const labelText  = (radio.labels?.[0]?.textContent || '').trim().toLowerCase();
    if (radio.value === value ||
        radioLabel.includes(valueLower) || valueLower.includes(radioLabel) ||
        labelText.includes(valueLower)  || valueLower.includes(labelText)) {
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
  if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
  return dateStr;
}

function locateElement(field, doc) {
  if (field.selector) {
    try { const el = doc.querySelector(field.selector); if (el) return el; } catch (_) {}
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
  return null;
}

/**
 * 填写单个字段（async，处理文件上传）
 * @param {object} fieldEntry
 * @param {Document} doc
 * @returns {Promise<{ fieldId, status, message }>}
 */
async function fillField(fieldEntry, doc) {
  const { field, value } = fieldEntry;

  if (!value && !fieldEntry.isFile) {
    return { fieldId: field.id, status: 'skipped', message: '值为空' };
  }

  const el = locateElement(field, doc);
  if (!el) {
    return { fieldId: field.id, status: 'error', message: '找不到元素' };
  }

  try {
    const type = field.type;

    if (type === 'select') {
      const ok = setSelectValue(el, value);
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : '无匹配选项' };
    }

    if (type === 'radio') {
      const ok = setRadioValue(el, value, doc);
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : '无匹配选项' };
    }

    if (type === 'checkbox') {
      const shouldCheck = /true|yes|是|1/i.test(value);
      if (el.checked !== shouldCheck) el.click();
      triggerEvents(el);
      return { fieldId: field.id, status: 'filled', message: '' };
    }

    if (type === 'date') {
      setInputValue(el, formatDate(value));
      return { fieldId: field.id, status: 'filled', message: '' };
    }

    if (type === 'file') {
      // 调用 file-uploader.js 暴露的上传函数
      if (typeof window.__jobpilotUploadFile === 'function' && fieldEntry.fileData) {
        const result = window.__jobpilotUploadFile(el, fieldEntry.fileData);
        return {
          fieldId: field.id,
          status: result.success ? 'filled' : 'skipped',
          message: result.success ? `已上传（${result.method}）` : '请手动上传简历',
        };
      }
      // 无文件数据或上传器不可用
      return { fieldId: field.id, status: 'skipped', message: '请手动上传简历文件' };
    }

    // text, email, tel, number, textarea 等
    setInputValue(el, value);
    return { fieldId: field.id, status: 'filled', message: '' };

  } catch (e) {
    return { fieldId: field.id, status: 'error', message: e.message };
  }
}

/**
 * 批量填写（async）
 * @param {object[]} mappings
 */
async function fillForms(mappings) {
  const results = [];
  let filled = 0, skipped = 0, errors = 0;

  for (const entry of mappings) {
    // 确定操作的 document（iframe 支持）
    let doc = document;
    if (entry.field?.source === 'iframe' && entry.field?.iframePath) {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src === entry.field.iframePath) {
          try { doc = iframe.contentDocument || iframe.contentWindow.document; } catch (_) {}
          break;
        }
      }
    }

    const result = await fillField(entry, doc);
    results.push(result);
    if (result.status === 'filled')       filled++;
    else if (result.status === 'skipped') skipped++;
    else                                   errors++;
  }

  return { results, summary: { filled, skipped, errors, total: mappings.length } };
}

// ── 高亮字段（点击结果列表时滚动 + 发光） ────────────────────

function highlightFieldEl(field) {
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

  const el = locateElement(field, doc);
  if (!el) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = { outline: el.style.outline, boxShadow: el.style.boxShadow, transition: el.style.transition };
  el.style.transition  = 'all 0.2s';
  el.style.outline     = '3px solid #2563eb';
  el.style.boxShadow   = '0 0 0 6px rgba(37,99,235,0.2)';
  el.focus?.();
  setTimeout(() => {
    el.style.outline   = prev.outline;
    el.style.boxShadow = prev.boxShadow;
  }, 2000);
  return true;
}

// ── Alt+J 快捷键：仅正则匹配，不调 AI ────────────────────────

async function handleQuickFill() {
  const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
  if (!profileResp?.success || !profileResp.data) {
    showInPageToast('JobPilot：请先在侧边栏填写个人资料', '#ef4444');
    return { success: false };
  }
  const profile = profileResp.data;

  // 用已挂到 window 的函数（来自 form-detector 和 label-matcher）
  const detectResult = window.__jobpilotDetectForms?.();
  if (!detectResult || detectResult.totalFields === 0) {
    showInPageToast('JobPilot：当前页面未检测到表单', '#6b7280');
    return { success: false };
  }

  const { matched } = window.__jobpilotMatchForms?.(detectResult, profile) ?? { matched: [] };
  const fillResult  = await fillForms(matched.map(m => ({ ...m, source: 'regex' })));

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
    'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'max-width:300px',
  ].join(';');
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ── 消息监听 ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.action;

  if (action === 'fillForms') {
    (async () => {
      try {
        const result = await fillForms(message.mappings);
        sendResponse({ success: true, data: result });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
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
    // 重新填写单个字段（用户编辑后触发）
    (async () => {
      try {
        const result = await fillField({ field: message.field, value: message.value }, document);
        sendResponse({ success: true, data: result });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (action === 'quickFill') {
    (async () => {
      try {
        const result = await handleQuickFill();
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  return true;
});

// 调试
window.__jobpilotFillForms = fillForms;
window.__jobpilotFillField = fillField;
