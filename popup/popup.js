/**
 * popup.js — 弹出面板逻辑（Phase 4 更新）
 * 支持：多模板快速切换 / 表单检测预览 / 完整 AI + 正则填写 / API Key 状态提示
 */

const statusLoading  = document.getElementById('statusLoading');
const statusOk       = document.getElementById('statusOk');
const statusNone     = document.getElementById('statusNone');
const fieldCountEl   = document.getElementById('fieldCount');
const statusBreakdown= document.getElementById('statusBreakdown');
const warnApiKey     = document.getElementById('warnApiKey');
const btnFill        = document.getElementById('btnFill');
const fillResult     = document.getElementById('fillResult');
const fillResultText = document.getElementById('fillResultText');
const profileSelect  = document.getElementById('profileSelect');

let detectedData = null;
let matchPreview = null;

// ── 工具函数 ──

async function sendToContent(action, data = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('获取标签页失败');
  return chrome.tabs.sendMessage(tab.id, { action, ...data });
}

function showFillResult(ok, text) {
  fillResult.style.display = 'block';
  fillResult.className = ok ? 'fill-result' : 'fill-result error';
  fillResultText.textContent = text;
}

// ── 多模板：从 storage 直接读取 ──

async function loadProfiles() {
  const result = await chrome.storage.local.get(['profiles', 'activeProfile']);
  const profiles = result.profiles || {};
  const activeId = result.activeProfile || Object.keys(profiles)[0] || '';
  const ids = Object.keys(profiles);

  profileSelect.innerHTML = '';
  if (ids.length === 0) {
    profileSelect.innerHTML = '<option value="">暂无资料</option>';
    profileSelect.disabled = true;
    return activeId;
  }

  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = profiles[id].name || id;
    opt.selected = id === activeId;
    profileSelect.appendChild(opt);
  }

  profileSelect.disabled = ids.length <= 1;
  return activeId;
}

// ── 初始化 ──

(async () => {
  try {
    // 加载模板列表
    await loadProfiles();

    const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const s = settings?.data || {};
    const providerNeedsKey = s.provider !== 'ollama';

    // API Key 提示
    if ((providerNeedsKey && !s.apiKey) || !s.aiEnabled) {
      warnApiKey.style.display = 'flex';
    }

    // 检测表单
    const resp = await sendToContent('detectForms');
    if (!resp?.success || resp.data.totalFields === 0) {
      statusLoading.style.display = 'none';
      statusNone.style.display    = 'block';
      return;
    }

    detectedData = resp.data;
    fieldCountEl.textContent = resp.data.totalFields;

    // 预览：匹配数量
    const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
    if (profileResp?.success && profileResp.data) {
      const matchResp = await sendToContent('matchFields', {
        detectResult: detectedData,
        profile: profileResp.data,
      });
      if (matchResp?.success) {
        matchPreview = matchResp.data;
        const { matched, unmatched } = matchResp.data;
        const aiCount = unmatched.filter(u => u.field.type !== 'file').length;
        let breakdown = `正则 ${matched.length} 个`;
        if (aiCount > 0) {
          breakdown += (!providerNeedsKey || s.apiKey) && s.aiEnabled
            ? `，AI ${aiCount} 个`
            : `，${aiCount} 个未匹配`;
        }
        statusBreakdown.textContent = breakdown;
      }
    } else {
      statusBreakdown.textContent = '请先在侧边栏填写资料';
    }

    statusLoading.style.display = 'none';
    statusOk.style.display      = 'flex';
    btnFill.disabled = false;

  } catch (e) {
    statusLoading.style.display = 'none';
    statusNone.style.display    = 'block';
    statusNone.textContent      = '无法连接到页面';
  }
})();

// ── 模板切换 ──

profileSelect.addEventListener('change', async () => {
  const newId = profileSelect.value;
  if (!newId) return;
  await chrome.storage.local.set({ activeProfile: newId });

  // 切换后重新预览匹配数量
  statusBreakdown.textContent = '已切换，请重新点击填写';
  matchPreview = null;
});

// ── 一键填写 ──

btnFill.addEventListener('click', async () => {
  if (!detectedData) return;

  btnFill.disabled = true;
  btnFill.textContent = '填写中...';
  fillResult.style.display = 'none';

  try {
    const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
    if (!profileResp?.success || !profileResp.data) {
      showFillResult(false, '请先在侧边栏填写个人资料');
      return;
    }
    const profile = profileResp.data;
    const settingsResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsResp?.data || {};
    const providerNeedsKey = settings.provider !== 'ollama';

    // 1. 正则匹配
    const matchResp = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResp?.success) throw new Error('匹配失败');
    const { matched, unmatched } = matchResp.data;

    const resumeResp = await chrome.runtime.sendMessage({ action: 'getResumeFile' });
    const resumeFile = resumeResp?.data || null;

    let allMappings = matched.map(m => ({
      ...m, source: 'regex',
      ...(m.isFile && resumeFile ? { fileData: resumeFile } : {}),
    }));

    // 2. AI 匹配（若已配置）
    const aiCandidates = unmatched.filter(u => u.field.type !== 'file');
    if (aiCandidates.length > 0 && settings.aiEnabled && (!providerNeedsKey || settings.apiKey)) {
      const port = chrome.runtime.connect({ name: 'keepalive' });
      try {
        const aiResp = await chrome.runtime.sendMessage({
          action: 'aiFieldMapping',
          payload: { unmatchedFields: aiCandidates.map(u => u.field), profile },
        });
        if (aiResp?.success) {
          for (const mapping of aiResp.data?.fieldMappings || []) {
            if (!mapping.suggestedValue) continue;
            const u = aiCandidates.find(x => x.field.id === mapping.fieldId);
            if (u) allMappings.push({
              field: u.field, formId: u.formId,
              value: mapping.suggestedValue, isFile: false,
              source: 'ai', confidence: mapping.confidence ?? 1,
            });
          }
        }
      } finally {
        port.disconnect();
      }
    }

    // 3. 填写
    const fillResp = await sendToContent('fillForms', { mappings: allMappings });
    if (!fillResp?.success) throw new Error('填写失败');

    const { summary } = fillResp.data;
    const aiCount = allMappings.filter(m => m.source === 'ai').length;
    let msg = `已填写 ${summary.filled} 个`;
    if (aiCount > 0) msg += `（含 AI ${aiCount} 个）`;
    if (summary.skipped > 0) msg += `，跳过 ${summary.skipped} 个`;
    showFillResult(true, msg);

    // 保存历史
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({
      action: 'saveHistory',
      payload: {
        url: tab?.url || '', title: tab?.title || '',
        fieldsCount: summary.total, successCount: summary.filled,
        failCount: summary.errors, aiCount,
      },
    });

  } catch (e) {
    showFillResult(false, `失败：${e.message}`);
  } finally {
    btnFill.disabled = false;
    btnFill.textContent = '一键填写';
  }
});

// ── 底部链接 ──

document.getElementById('btnSidepanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) { await chrome.sidePanel.open({ tabId: tab.id }); window.close(); }
});

document.getElementById('btnSettings').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) { await chrome.sidePanel.open({ tabId: tab.id }); }
  window.close();
});

document.getElementById('btnGoSettings').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) { await chrome.sidePanel.open({ tabId: tab.id }); }
  window.close();
});
