/**
 * pdfjs-loader.js — 加载本地 pdf.js ESM 模块
 *
 * 使用相对路径动态 import，避免 chrome.runtime.getURL() 在 MV3 sidepanel
 * 上下文中因模块解析方式不同导致的 "Failed to fetch dynamically imported module" 错误。
 *
 * 文件路径（已内置）：
 *   lib/pdf.min.mjs
 *   lib/pdf.worker.min.mjs
 */

let _pdfjsLib = null;

/**
 * 加载并返回 pdfjsLib。第二次调用直接返回缓存实例。
 * @returns {Promise<object>} pdfjsLib 模块
 */
export async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;

  try {
    // 使用相对路径，由浏览器基于当前模块 URL 解析为 chrome-extension://[id]/lib/pdf.min.mjs
    const mod = await import('./pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
    _pdfjsLib = mod;
    return _pdfjsLib;
  } catch (e) {
    throw new Error(
      'pdf.js 加载失败。\n\n' +
      '请确认 lib/pdf.min.mjs 和 lib/pdf.worker.min.mjs 文件存在，\n' +
      '然后在 chrome://extensions 页面刷新扩展后重试。\n\n' +
      `（技术详情：${e.message}）`
    );
  }
}
