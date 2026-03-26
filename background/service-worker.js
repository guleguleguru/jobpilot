/**
 * service-worker.js — Background Service Worker
 * 负责：AI API 调用、消息路由、快捷键、历史记录、sidepanel 管理
 */

import { getProfile, getSettings, getResumeFile, saveHistoryEntry } from '../lib/storage.js';
import { AIProvider } from '../lib/ai-provider.js';
import { PROVIDER_PRESETS } from '../lib/ai-provider.js';
import { buildFieldMappingPrompt, validateFieldMappings } from '../lib/prompt-templates.js';

// ── 侧边栏：点击图标时打开 ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Keep-alive：防止 AI 调用期间 SW 被休眠 ──
// sidepanel 在 AI 调用前用 chrome.runtime.connect('keepalive') 保持连接
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'keepalive') {
    // 只要 port 保持开启，SW 就不会被休眠
    port.onDisconnect.addListener(() => {});
  }
});

// ── 快捷键：Alt+J 触发一键填写 ──
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-fill') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  // 向 content script 发 quickFill 指令（仅正则匹配，无 AI，速度最快）
  chrome.tabs.sendMessage(tab.id, { action: 'quickFill' }).catch(() => {});
});

// ── 消息总路由 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'getProfile':
          sendResponse({ success: true, data: await getProfile() });
          break;

        case 'getSettings':
          sendResponse({ success: true, data: await getSettings() });
          break;

        case 'getResumeFile':
          sendResponse({ success: true, data: await getResumeFile() });
          break;

        case 'aiFieldMapping':
          sendResponse(await handleAIFieldMapping(message.payload));
          break;

        case 'saveHistory':
          await saveHistoryEntry(message.payload);
          sendResponse({ success: true });
          break;

        case 'detectAllFrames':
          sendResponse(await detectAllFrames(message.tabId));
          break;

        case 'fillAllFrames':
          sendResponse(await fillAllFrames(message.payload.tabId, message.payload.allMappings));
          break;

        case 'formsUpdated':
          // 内容脚本广播，SW 不需要处理
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: `未知 action: ${message.action}` });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
});

// ── AI 字段映射 ──────────────────────────────────────────────

/**
 * @param {{ unmatchedFields: object[], profile: object }} payload
 */
async function handleAIFieldMapping(payload) {
  const settings = await getSettings();
  const preset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;

  if (!settings.aiEnabled) {
    return { success: true, data: { fieldMappings: [] }, message: 'AI 未启用' };
  }
  if (!preset.noApiKey && !settings.apiKey) {
    return { success: false, error: '未配置 API Key，请在「设置」标签中填写' };
  }

  const { unmatchedFields, profile } = payload;
  if (!unmatchedFields?.length) {
    return { success: true, data: { fieldMappings: [] }, message: '无未匹配字段' };
  }

  const provider = new AIProvider({
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: settings.temperature ?? 0.1,
  });

  const messages = buildFieldMappingPrompt(unmatchedFields, profile);

  let json, usage;
  try {
    ({ json, usage } = await provider.completeJSON(messages));
  } catch (err) {
    console.error('[JobPilot SW] AI 调用失败:', err.message);
    return {
      success: true,
      data: { fieldMappings: [] },
      message: `AI 调用失败（${err.message}），已跳过 AI 匹配`,
      aiError: err.message,
    };
  }

  const raw = json.fieldMappings ?? [];
  const fieldMappings = validateFieldMappings(raw, unmatchedFields);

  return {
    success: true,
    data: {
      fieldMappings,
      usage,
      model: `${settings.provider}/${settings.model}`,
    },
  };
}

// ── 多帧检测（支持跨域 iframe）─────────────────────────────────

/**
 * 枚举标签页所有帧并分别触发 detectForms。
 * 同源子帧由主帧 form-detector.js 直接访问 contentDocument，此处跳过。
 * 跨域子帧注入了独立 content script，直接按 frameId 查询。
 */
async function detectAllFrames(tabId) {
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    frames = [{ frameId: 0, url: '' }];
  }

  const topFrame = frames.find(f => f.frameId === 0);
  let topOrigin = '';
  try { topOrigin = topFrame?.url ? new URL(topFrame.url).origin : ''; } catch {}

  const allForms   = [];
  let totalFields  = 0;

  for (const frame of frames) {
    // 跳过同源子帧（主帧已通过 contentDocument 扫描）
    if (frame.frameId !== 0) {
      let frameOrigin = '';
      try { frameOrigin = frame.url ? new URL(frame.url).origin : ''; } catch {}
      if (!frameOrigin || frame.url === 'about:blank' || (topOrigin && frameOrigin === topOrigin)) continue;
    }

    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { action: 'detectForms' },
        { frameId: frame.frameId }
      );
      if (!resp?.success || !resp.data?.forms?.length) continue;

      // 跨域子帧字段打上 frameId 标记，供填写时路由
      if (frame.frameId !== 0) {
        for (const form of resp.data.forms) {
          form.frameId = frame.frameId;
          for (const field of form.fields) {
            field.frameId    = frame.frameId;
            field.source     = 'cross-iframe';
            field.iframePath = frame.url;
          }
        }
      }

      allForms.push(...resp.data.forms);
    } catch {
      // 该帧无 content script（pdf、扩展页等），跳过
    }
  }

  // 从实际收集的字段重算，避免与主帧已包含同源 iframe 字段时的计数不一致
  totalFields = allForms.reduce((sum, f) => sum + f.fields.length, 0);

  return {
    success: true,
    data: { forms: allForms, totalFields, scannedAt: new Date().toISOString() },
  };
}

// ── 多帧填写（按 frameId 分组分发）───────────────────────────────

/**
 * 将映射按 frameId 分组后分别发送到对应帧。
 * frameId 0：主帧（同时处理同源 iframe via contentDocument）。
 * frameId N：跨域 iframe 直接路由。
 */
async function fillAllFrames(tabId, allMappings) {
  const byFrame = new Map();
  for (const m of allMappings) {
    const fid = m.field?.frameId ?? 0;
    if (!byFrame.has(fid)) byFrame.set(fid, []);
    byFrame.get(fid).push(m);
  }

  const allResults = [];
  const summary    = { filled: 0, skipped: 0, errors: 0, total: allMappings.length };

  for (const [frameId, mappings] of byFrame) {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { action: 'fillForms', mappings },
        { frameId }
      );
      if (!resp?.success) continue;
      allResults.push(...(resp.data?.results ?? []));
      summary.filled  += resp.data?.summary?.filled  ?? 0;
      summary.skipped += resp.data?.summary?.skipped ?? 0;
      summary.errors  += resp.data?.summary?.errors  ?? 0;
    } catch (e) {
      console.error('[JobPilot SW] 填写帧', frameId, '失败:', e.message);
      // 帧已销毁（SPA 路由切换），将该帧所有字段计入失败数
      summary.errors += mappings.length;
    }
  }

  return { success: true, data: { results: allResults, summary } };
}
