/**
 * file-uploader.js — 简历文件上传模块
 * 三种方案依次尝试：DataTransfer API → 模拟 drag-drop → 高亮提示手动操作
 * 参考：sainikhil1605/ApplyEase 的 uploadFile() 和 tryDropFile()
 */

/**
 * 将 base64 Data URL 转换为 File 对象
 * @param {string} dataUrl - 'data:application/pdf;base64,...'
 * @param {string} filename
 * @returns {File}
 */
function dataUrlToFile(dataUrl, filename) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/**
 * 在元素周围找到最近的 dropzone 容器
 * 常见特征：有 ondrop / ondragover 监听器，或有 dropzone / upload 相关类名
 * @param {HTMLInputElement} inputEl
 * @returns {Element|null}
 */
function findDropzone(inputEl) {
  const dropKeywords = /drop|upload|attach|file|resume|cv/i;
  let el = inputEl.parentElement;
  let depth = 0;
  while (el && depth < 5) {
    const cls = el.className || '';
    const id  = el.id || '';
    if (dropKeywords.test(cls) || dropKeywords.test(id)) return el;
    // 检查是否绑定了 drop 事件（无法直接探测，但容器通常有特殊样式）
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' && el.tagName !== 'BUTTON') return el;
    el = el.parentElement;
    depth++;
  }
  return null;
}

/**
 * 给元素添加高亮样式，2 秒后自动移除
 * @param {Element} el
 * @param {string} color - CSS 颜色
 */
function highlight(el, color = '#f59e0b') {
  const prev = el.style.cssText;
  el.style.outline = `3px dashed ${color}`;
  el.style.outlineOffset = '4px';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { el.style.cssText = prev; }, 3000);
}

/**
 * 显示页面内 toast 提示（用于文件上传手动提示）
 * @param {string} msg
 */
function showPageToast(msg) {
  const id = '__jobpilot_file_toast';
  document.getElementById(id)?.remove();
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
    'background:#1f2937', 'color:#fff', 'padding:12px 18px',
    'border-radius:10px', 'font:13px/1.5 system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.3)', 'max-width:280px',
    'display:flex', 'align-items:flex-start', 'gap:8px',
  ].join(';');
  div.innerHTML = `<span>📎</span><span>${msg}</span>`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

/**
 * 方案 1：用 DataTransfer API 设置 input.files
 * @param {HTMLInputElement} inputEl
 * @param {File} file
 * @returns {boolean}
 */
function tryDataTransfer(inputEl, file) {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
    return true;
  } catch (e) {
    console.debug('[JobPilot] DataTransfer 失败:', e.message);
    return false;
  }
}

/**
 * 方案 2：模拟 drag-and-drop 到 dropzone 容器
 * @param {Element} dropzone
 * @param {File} file
 * @returns {boolean}
 */
function tryDragDrop(dropzone, file) {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);

    const makeEvent = (type) => new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: dt,
    });

    dropzone.dispatchEvent(makeEvent('dragenter'));
    dropzone.dispatchEvent(makeEvent('dragover'));
    dropzone.dispatchEvent(makeEvent('drop'));
    return true;
  } catch (e) {
    console.debug('[JobPilot] DragDrop 失败:', e.message);
    return false;
  }
}

/**
 * 主入口：尝试将简历文件注入 file input 元素
 * @param {HTMLInputElement} inputEl
 * @param {{ name: string, data: string, type: string }} fileData - chrome.storage 中的文件数据
 * @returns {{ method: 'dataTransfer'|'dragDrop'|'manual', success: boolean }}
 */
function uploadFileToInput(inputEl, fileData) {
  const file = dataUrlToFile(fileData.data, fileData.name);

  // 方案 1
  if (tryDataTransfer(inputEl, file)) {
    return { method: 'dataTransfer', success: true };
  }

  // 方案 2
  const dropzone = findDropzone(inputEl);
  if (dropzone && tryDragDrop(dropzone, file)) {
    return { method: 'dragDrop', success: true };
  }

  // 方案 3：高亮提示用户手动操作
  highlight(inputEl);
  showPageToast(`请手动选择简历文件：${fileData.name}\n（JobPilot 无法自动上传此类型的上传控件）`);
  return { method: 'manual', success: false };
}

// ── 消息监听 ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'uploadResume') {
    const { selector, xpath, fileData } = message;

    // 定位 file input 元素
    let inputEl = null;
    if (selector) {
      try { inputEl = document.querySelector(selector); } catch (_) {}
    }
    if (!inputEl && xpath) {
      try {
        const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        inputEl = r.singleNodeValue;
      } catch (_) {}
    }

    if (!inputEl) {
      sendResponse({ success: false, error: '找不到文件上传元素' });
      return true;
    }
    if (!fileData) {
      highlight(inputEl);
      showPageToast('未找到已上传的简历文件，请先在「资料」标签上传简历');
      sendResponse({ success: false, error: '未找到简历文件数据' });
      return true;
    }

    const result = uploadFileToInput(inputEl, fileData);
    sendResponse({ success: result.success, method: result.method });
  }
  return true;
});

// 暴露给 form-filler.js 直接调用（同一 content script 上下文）
window.__jobpilotUploadFile = uploadFileToInput;
