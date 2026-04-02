/**
 * service-worker.js — Background Service Worker
 * 负责：AI API 调用、消息路由、快捷键、历史记录、sidepanel 管理
 */

import {
  getLastFillReport,
  getProfile,
  getResumeFile,
  getSettings,
  saveHistoryEntry,
  saveLastFillReport,
  saveTargetProfileDraft,
} from '../lib/storage.js';
import { AIProvider } from '../lib/ai-provider.js';
import { PROVIDER_PRESETS } from '../lib/ai-provider.js';
import { mergeFillReports } from '../lib/fill-report.js';
import { buildFieldMappingPrompt, buildTargetProfilePrompt, validateFieldMappings } from '../lib/prompt-templates.js';
import { sanitizeProfileOverridePatch } from '../lib/profile-schema.js';
import { normalizeTargetProfileContext } from '../lib/target-profile.js';

const CONTENT_SCRIPT_FILES = [
  'content/form-detector.js',
  'content/site-adapters/base-adapter.js',
  'content/site-adapters/index.js',
  'content/site-adapters/china-taiping.js',
  'content/site-adapters/antgroup.js',
  'content/site-adapters/generic.js',
  'content/label-matcher.js',
  'content/file-uploader.js',
  'content/form-filler.js',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function shouldBootstrapFrame(error) {
  const message = String(error?.message || '');
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(message);
}

async function bootstrapFrameContentScripts(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: CONTENT_SCRIPT_FILES,
    });
    return true;
  } catch (error) {
    console.debug('[JobPilot SW] 注入内容脚本失败:', frameId, error.message);
    return false;
  }
}

async function sendMessageWithBootstrap(tabId, message, frameId, options = {}) {
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const messageTimeoutMs = options.messageTimeoutMs ?? 0;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage(tabId, message, { frameId }),
        messageTimeoutMs,
        `Message ${message?.action || 'unknown'} to frame ${frameId}`
      );
      if (response != null) return response;
    } catch (error) {
      lastError = error;
      if (shouldBootstrapFrame(error)) {
        await bootstrapFrameContentScripts(tabId, frameId);
      } else if (attempt === retries) {
        throw error;
      }
    }

    if (attempt < retries) {
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  if (lastError) throw lastError;
  return null;
}

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
  try {
    await sendMessageWithBootstrap(tab.id, { action: 'quickFill' }, 0, { retries: 1, retryDelayMs: 150 });
  } catch (_) {}
});

// ── 消息总路由 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'getProfile':
          sendResponse({
            success: true,
            data: await getProfile(
              message.hostname || message.siteKey || sender?.tab?.url || '',
              message.targetKey || ''
            ),
          });
          break;

        case 'getSettings':
          sendResponse({ success: true, data: await getSettings() });
          break;

        case 'getResumeFile':
          sendResponse({ success: true, data: await getResumeFile() });
          break;

        case 'getLastFillReport':
          sendResponse({ success: true, data: await getLastFillReport() });
          break;

        case 'aiFieldMapping':
          sendResponse(await handleAIFieldMapping(message.payload));
          break;

        case 'generateTargetProfileDraft':
          sendResponse(await handleGenerateTargetProfileDraft(message.payload));
          break;

        case 'saveHistory':
          await saveHistoryEntry(message.payload);
          sendResponse({ success: true });
          break;

        case 'detectAllFrames':
          sendResponse(await detectAllFrames(message.tabId));
          break;

        case 'fillAllFrames':
          sendResponse(await fillAllFrames(
            message.payload.tabId,
            message.payload.allMappings,
            message.payload.profile,
            message.payload.diagnostics
          ));
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

async function handleGenerateTargetProfileDraft(payload = {}) {
  const settings = await getSettings();
  const preset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;

  if (!settings.aiEnabled) {
    return { success: false, error: 'AI is disabled in settings' };
  }
  if (!preset.noApiKey && !settings.apiKey) {
    return { success: false, error: 'API key is required before generating a target draft' };
  }

  const profileId = String(payload.profileId || '').trim();
  if (!profileId) {
    return { success: false, error: 'Profile id is required' };
  }

  const context = normalizeTargetProfileContext(payload.jobContext || {});
  if (!context.targetKey) {
    return { success: false, error: 'Target company or role is required' };
  }

  const provider = new AIProvider({
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: settings.temperature ?? 0.1,
  });

  const messages = buildTargetProfilePrompt(context, payload.profile || {});

  let json;
  let usage;
  try {
    ({ json, usage } = await provider.completeJSON(messages, { timeout: 60000 }));
  } catch (error) {
    console.error('[JobPilot SW] target draft generation failed:', error.message);
    return { success: false, error: error.message || 'Failed to generate target draft' };
  }

  const rawPatch =
    json && typeof json === 'object' && !Array.isArray(json) && json.patch && typeof json.patch === 'object' && !Array.isArray(json.patch)
      ? json.patch
      : json;
  const patch = sanitizeProfileOverridePatch(
    rawPatch && typeof rawPatch === 'object' && !Array.isArray(rawPatch) ? rawPatch : {}
  );

  await saveTargetProfileDraft(profileId, context.targetKey, patch, { merge: false });

  return {
    success: true,
    data: {
      targetKey: context.targetKey,
      context,
      patch: patch || {},
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
  let lastResult = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    lastResult = await detectAllFramesOnce(tabId);
    if (lastResult?.data?.totalFields > 0) return lastResult;
    await sleep(300 * (attempt + 1));
  }
  return lastResult || {
    success: true,
    data: { forms: [], totalFields: 0, scannedAt: new Date().toISOString() },
  };
}

async function detectAllFramesOnce(tabId) {
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
      const resp = await sendMessageWithBootstrap(
        tabId,
        { action: 'detectForms' },
        frame.frameId,
        { retries: 2, retryDelayMs: 200 }
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
async function fillAllFrames(tabId, allMappings, profile = null, diagnostics = null) {
  const byFrame = new Map();
  for (const m of allMappings) {
    const fid = m.field?.frameId ?? 0;
    if (!byFrame.has(fid)) byFrame.set(fid, []);
    byFrame.get(fid).push(m);
  }

  const allResults = [];
  const summary    = { filled: 0, skipped: 0, errors: 0, total: allMappings.length };
  const reports = [];

  for (const [frameId, mappings] of byFrame) {
    try {
      const resp = await sendMessageWithBootstrap(
        tabId,
        {
          action: 'fillForms',
          mappings,
          profile,
          diagnostics,
        },
        frameId,
        { retries: 1, retryDelayMs: 150, messageTimeoutMs: 45000 }
      );
      if (!resp?.success) continue;
      allResults.push(...(resp.data?.results ?? []));
      summary.filled  += resp.data?.summary?.filled  ?? 0;
      summary.skipped += resp.data?.summary?.skipped ?? 0;
      summary.errors  += resp.data?.summary?.errors  ?? 0;
      if (resp.data?.report) reports.push(resp.data.report);
    } catch (e) {
      console.error('[JobPilot SW] 填写帧', frameId, '失败:', e.message);
      // 帧已销毁（SPA 路由切换），将该帧所有字段计入失败数
      allResults.push(...mappings.map(mapping => ({
        fieldId: mapping.field?.id || '',
        status: 'error',
        message: e.message || 'fill_frame_failed',
        key: mapping.key || mapping.field?.normalizedKey || '',
      })));
      summary.errors += mappings.length;
    }
  }

  const report = mergeFillReports(reports);
  await saveLastFillReport(report);
  return { success: true, data: { results: allResults, summary, report } };
}
