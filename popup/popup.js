const statusLoading = document.getElementById('statusLoading');
const statusOk = document.getElementById('statusOk');
const statusNone = document.getElementById('statusNone');
const fieldCountEl = document.getElementById('fieldCount');
const statusBreakdown = document.getElementById('statusBreakdown');
const diagnosticsCard = document.getElementById('diagnosticsCard');
const warnApiKey = document.getElementById('warnApiKey');
const btnFill = document.getElementById('btnFill');
const fillResult = document.getElementById('fillResult');
const fillResultText = document.getElementById('fillResultText');
const profileSelect = document.getElementById('profileSelect');

let detectedData = null;
let activeTab = null;
let latestMatch = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTopFrame(action, data = {}) {
  const tab = activeTab || await getActiveTab();
  if (!tab) throw new Error('获取当前标签页失败');
  return chrome.tabs.sendMessage(tab.id, { action, ...data });
}

function showFillResult(ok, text) {
  fillResult.style.display = 'block';
  fillResult.className = ok ? 'fill-result' : 'fill-result error';
  fillResultText.textContent = text;
}

function renderDiagnostics({ diagnostics, report } = {}) {
  const parts = [];
  if (report?.adapterUsed) parts.push(`适配器 ${report.adapterUsed}`);
  if (diagnostics?.missingRequiredFields?.length) parts.push(`缺失 ${diagnostics.missingRequiredFields.length}`);
  if (diagnostics?.sensitiveFieldsSkipped?.length) parts.push(`敏感跳过 ${diagnostics.sensitiveFieldsSkipped.length}`);
  if (diagnostics?.unmappedFields?.length) parts.push(`未映射字段 ${diagnostics.unmappedFields.length}`);
  if (diagnostics?.unmappedValues?.length) parts.push(`未映射值 ${diagnostics.unmappedValues.length}`);
  if (report?.repeatSections?.some(section => section.warnings?.length)) parts.push('重复段需人工确认');
  if (report?.warnings?.length) parts.push(`告警 ${report.warnings.length}`);

  if (!parts.length) {
    diagnosticsCard.style.display = 'none';
    diagnosticsCard.textContent = '';
    return;
  }

  diagnosticsCard.textContent = parts.join(' · ');
  diagnosticsCard.style.display = 'block';
}

async function loadProfiles() {
  const result = await chrome.storage.local.get(['profiles', 'activeProfile']);
  const profiles = result.profiles || {};
  const activeId = result.activeProfile || Object.keys(profiles)[0] || '';
  const ids = Object.keys(profiles);

  profileSelect.innerHTML = '';
  if (!ids.length) {
    profileSelect.innerHTML = '<option value="">暂无资料</option>';
    profileSelect.disabled = true;
    return activeId;
  }

  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = profiles[id].name || id;
    option.selected = id === activeId;
    profileSelect.appendChild(option);
  }

  profileSelect.disabled = ids.length <= 1;
  return activeId;
}

function buildStatusBreakdown(matchData, settings) {
  const matched = matchData?.matched?.length || 0;
  const aiCount = (matchData?.unmatched || []).filter(item => item.field.type !== 'file').length;
  const diagnostics = matchData?.diagnostics || {};
  const parts = [`规则 ${matched}`];
  if (aiCount > 0) {
    parts.push(settings.aiEnabled && (settings.provider === 'ollama' || settings.apiKey) ? `AI 候选 ${aiCount}` : `未匹配 ${aiCount}`);
  }
  if (diagnostics.missingRequiredFields?.length) parts.push(`缺失 ${diagnostics.missingRequiredFields.length}`);
  if (diagnostics.unmappedValues?.length) parts.push(`值未映射 ${diagnostics.unmappedValues.length}`);
  return parts.join(' · ');
}

async function refreshPreview() {
  activeTab = await getActiveTab();
  const settingsResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = settingsResp?.data || {};
  const providerNeedsKey = settings.provider !== 'ollama';

  warnApiKey.style.display = (providerNeedsKey && !settings.apiKey) || !settings.aiEnabled ? 'flex' : 'none';

  const detectResp = await chrome.runtime.sendMessage({ action: 'detectAllFrames', tabId: activeTab.id });
  if (!detectResp?.success || detectResp.data.totalFields === 0) {
    detectedData = null;
    latestMatch = null;
    statusLoading.style.display = 'none';
    statusOk.style.display = 'none';
    statusNone.style.display = 'block';
    btnFill.disabled = true;
    renderDiagnostics();
    return;
  }

  detectedData = detectResp.data;
  fieldCountEl.textContent = String(detectResp.data.totalFields);

  const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
  if (profileResp?.success && profileResp.data) {
    const matchResp = await sendToTopFrame('matchFields', {
      detectResult: detectedData,
      profile: profileResp.data,
    });
    if (matchResp?.success) {
      latestMatch = matchResp.data;
      statusBreakdown.textContent = buildStatusBreakdown(matchResp.data, settings);
      renderDiagnostics({ diagnostics: matchResp.data.diagnostics });
    } else {
      latestMatch = null;
      statusBreakdown.textContent = '字段匹配失败';
      renderDiagnostics();
    }
  } else {
    latestMatch = null;
    statusBreakdown.textContent = '请先在侧边栏填写资料';
    renderDiagnostics();
  }

  statusLoading.style.display = 'none';
  statusOk.style.display = 'flex';
  statusNone.style.display = 'none';
  btnFill.disabled = false;
}

async function buildAiCandidates(unmatched) {
  return unmatched
    .filter(item => item.field.type !== 'file')
    .map(item => ({
      ...item.field,
      normalizedKey: item.normalizedKey || item.field.normalizedKey || null,
    }));
}

(async () => {
  try {
    await loadProfiles();
    await refreshPreview();
  } catch (error) {
    statusLoading.style.display = 'none';
    statusOk.style.display = 'none';
    statusNone.style.display = 'block';
    statusNone.textContent = '无法连接到页面';
  }
})();

profileSelect.addEventListener('change', async () => {
  if (!profileSelect.value) return;
  await chrome.storage.local.set({ activeProfile: profileSelect.value });
  statusBreakdown.textContent = '已切换，重新检测中...';
  await refreshPreview();
});

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

    const matchResp = await sendToTopFrame('matchFields', { detectResult: detectedData, profile });
    if (!matchResp?.success) throw new Error(matchResp?.error || '匹配失败');
    latestMatch = matchResp.data;

    const { matched, unmatched, diagnostics } = matchResp.data;
    const resumeResp = await chrome.runtime.sendMessage({ action: 'getResumeFile' });
    const resumeFile = resumeResp?.data || null;

    let allMappings = matched.map(entry => ({
      ...entry,
      source: 'regex',
      ...(entry.isFile && resumeFile ? { fileData: resumeFile } : {}),
    }));

    const aiCandidates = await buildAiCandidates(unmatched);
    if (aiCandidates.length && settings.aiEnabled && (!providerNeedsKey || settings.apiKey)) {
      const port = chrome.runtime.connect({ name: 'keepalive' });
      try {
        const aiResp = await chrome.runtime.sendMessage({
          action: 'aiFieldMapping',
          payload: { unmatchedFields: aiCandidates, profile },
        });
        if (aiResp?.success) {
          for (const mapping of aiResp.data?.fieldMappings || []) {
            if (!mapping?.suggestedValue) continue;
            const target = unmatched.find(item => item.field.id === mapping.fieldId);
            if (!target) continue;
            allMappings.push({
              field: target.field,
              formId: target.formId,
              key: target.normalizedKey || target.field.normalizedKey || null,
              value: mapping.suggestedValue,
              isFile: false,
              source: 'ai',
              confidence: mapping.confidence ?? 1,
            });
          }
        }
      } finally {
        port.disconnect();
      }
    }

    const fillResp = await chrome.runtime.sendMessage({
      action: 'fillAllFrames',
      payload: { tabId: activeTab.id, allMappings, profile, diagnostics },
    });
    if (!fillResp?.success) throw new Error(fillResp?.error || '填写失败');

    const { summary, report } = fillResp.data;
    const aiCount = allMappings.filter(item => item.source === 'ai').length;
    let message = `已填写 ${summary.filled} 个`;
    if (aiCount) message += `，含 AI ${aiCount} 个`;
    if (summary.skipped) message += `，跳过 ${summary.skipped} 个`;
    showFillResult(true, message);
    renderDiagnostics({ report });

    await chrome.runtime.sendMessage({
      action: 'saveHistory',
      payload: {
        url: activeTab?.url || '',
        title: activeTab?.title || '',
        fieldsCount: summary.total,
        successCount: summary.filled,
        failCount: summary.errors,
        aiCount,
        diagnostics,
        fillReport: report,
      },
    });
  } catch (error) {
    showFillResult(false, `失败：${error.message}`);
  } finally {
    btnFill.disabled = false;
    btnFill.textContent = '一键填写';
  }
});

document.getElementById('btnSidepanel').addEventListener('click', async () => {
  const tab = activeTab || await getActiveTab();
  if (tab) {
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});

document.getElementById('btnSettings').addEventListener('click', async () => {
  const tab = activeTab || await getActiveTab();
  if (tab) await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

document.getElementById('btnGoSettings').addEventListener('click', async () => {
  const tab = activeTab || await getActiveTab();
  if (tab) await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});
