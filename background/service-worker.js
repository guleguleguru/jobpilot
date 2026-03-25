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
