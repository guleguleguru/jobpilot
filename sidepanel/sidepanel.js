import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfileId,
  getHistory,
  getProfileSnapshots,
  getProfiles,
  getResumeFile,
  getSemanticFieldMemory,
  getSettings,
  getSiteProfileOverride,
  getTargetProfileDraft,
  migrateEducationToArray,
  migrateToMultiProfile,
  restoreProfileSnapshot,
  learnSemanticFieldMemorySamples,
  saveActiveProfileData,
  saveHistoryEntry,
  saveResumeFile,
  saveSemanticFieldMemory,
  saveSettings,
  saveSiteProfileOverride,
  saveTargetProfileDraft,
  setActiveProfile,
  clearHistory,
} from '../lib/storage.js';
import { AIProvider, PROVIDER_PRESETS, checkOllamaRunning } from '../lib/ai-provider.js';
import { loadPdfJs } from '../lib/pdfjs-loader.js';
import { summarizeFillReport } from '../lib/fill-report.js';
import { buildAiParsePrompt, extractPdfContent, extractPdfText, getFieldValue, parseLocalRegex, setFieldValue } from '../lib/pdf-parser.js';
import { createEmptyProfile, mergeProfileWithOverride, normalizeProfile, normalizeSiteKey, setByPath } from '../lib/profile-schema.js';
import { buildSemanticFieldSample, extractSemanticSamplesFromDebugExport } from '../lib/semantic-field-memory.js';
import { getTargetDraftDisplayLabel, hasTargetProfileContext, normalizeTargetProfileContext } from '../lib/target-profile.js';

let detectedData = null;
let allMappings = [];
let profilesData = {};
let activeProfileId = '';
let fillInProgress = false;
let detectInProgress = false;
let pdfCandidateProfile = null;
let currentPdfFile = null;

const detectInfo = document.getElementById('detectInfo');
const fillPreview = document.getElementById('fillPreview');
const fillDiagnostics = document.getElementById('fillDiagnostics');
const fillResults = document.getElementById('fillResults');
const resultsSummary = document.getElementById('resultsSummary');
const resultsList = document.getElementById('resultsList');
const emptyHint = document.getElementById('emptyHint');
const btnFillMain = document.getElementById('btnFillMain');
const btnGenerateTargetDraft = document.getElementById('btnGenerateTargetDraft');
const btnClearTargetDraft = document.getElementById('btnClearTargetDraft');
const btnExportDebug = ensureDebugExportButton();
const profileForm = document.getElementById('profileForm');
const profileSelect = document.getElementById('profileSelect');
const snapshotList = document.getElementById('snapshotList');
const siteOverrideHost = document.getElementById('siteOverrideHost');
const siteOverrideEditor = document.getElementById('siteOverrideEditor');
const siteOverridePreview = document.getElementById('siteOverridePreview');
const semanticMemoryStatus = document.getElementById('semanticMemoryStatus');
const targetCompanyInput = document.getElementById('targetCompany');
const targetRoleInput = document.getElementById('targetRole');
const targetNotesInput = document.getElementById('targetNotes');
const targetDraftStatus = document.getElementById('targetDraftStatus');

const LIST_CONFIG = {
  education: {
    listId: 'educationList',
    label: '鏁欒偛缁忓巻',
    fields: ['school', 'major', 'degree', 'startDate', 'endDate', 'studyMode', 'gpa'],
  },
  experience: {
    listId: 'experienceList',
    label: '宸ヤ綔缁忓巻',
    fields: ['company', 'department', 'title', 'location', 'startDate', 'endDate', 'description', 'achievements'],
  },
  projects: {
    listId: 'projectList',
    label: '椤圭洰缁忓巻',
    fields: ['name', 'role', 'startDate', 'endDate', 'description', 'techStack'],
  },
  awards: {
    listId: 'awardList',
    label: '濂栭」',
    fields: ['name', 'issuer', 'year', 'description'],
  },
  competitions: {
    listId: 'competitionList',
    label: '绔炶禌',
    fields: ['name', 'level', 'award', 'date', 'description'],
  },
  languages: {
    listId: 'languageList',
    label: '璇█',
    fields: ['language', 'proficiency', 'listeningSpeaking', 'readingWriting'],
  },
  languageExams: {
    listId: 'languageExamList',
    label: 'Language Exam',
    fields: ['examType', 'score'],
  },
  developerLanguages: {
    listId: 'developerLanguageList',
    label: '寮�鍙戣瑷�',
    fields: ['name', 'level'],
  },
  familyMembers: {
    listId: 'familyList',
    label: '瀹跺涵鎴愬憳',
    fields: ['relation', 'name', 'birthDate', 'politicalStatus', 'employer', 'jobTitle', 'status', 'location'],
  },
};

const PDF_PREVIEW_FIELDS = [
  ['濮撳悕', 'personal.fullName'],
  ['鎵嬫満', 'contact.phone'],
  ['閭', 'contact.email'],
  ['韬珮', 'personal.heightCm'],
  ['浣撻噸', 'personal.weightKg'],
  ['鐜板眳鍩庡競', 'residency.currentCity'],
  ['鏈熸湜鍩庡競', 'jobPreferences.expectedLocations'],
  ['鏈熸湜宀椾綅', 'jobPreferences.expectedPositions'],
  ['鏁欒偛 1 瀛︽牎', 'education[0].school'],
  ['鏁欒偛 1 涓撲笟', 'education[0].major'],
  ['缁忓巻 1 鍏徃', 'experience[0].company'],
  ['缁忓巻 1 鑱屼綅', 'experience[0].title'],
  ['椤圭洰 1 鍚嶇О', 'projects[0].name'],
  ['璇█ 1', 'languages[0].language'],
  ['技能', 'skills'],
];

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function ensureDebugExportButton() {
  const existing = document.getElementById('btnExportDebug');
  if (existing) return existing;

  const button = document.createElement('button');
  button.id = 'btnExportDebug';
  button.type = 'button';
  button.className = 'btn-debug-export';
  button.textContent = '瀵煎嚭褰撳墠椤佃皟璇?JSON';
  button.style.display = 'none';

  const anchor = document.getElementById('fillDiagnostics');
  anchor?.insertAdjacentElement('afterend', button);
  return button;
}

function sanitizeFilenamePart(value) {
  return String(value || '')
    .replace(/https?:\/\//g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'page';
}

function formatExportTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const anchor = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function summarizeFieldForDebug(field) {
  if (!field) return null;
  return {
    id: field.id,
    type: field.type,
    name: field.name,
    label: field.label,
    labelCandidates: field.labelCandidates || [],
    placeholder: field.placeholder || '',
    title: field.title || '',
    required: Boolean(field.required),
    helperText: field.helperText || '',
    sectionLabel: field.sectionLabel || '',
    contextText: field.contextText || '',
    containerText: field.containerText || '',
    options: Array.isArray(field.options) ? field.options.slice(0, 20) : [],
    selector: field.selector || '',
    containerSelector: field.containerSelector || '',
    xpath: field.xpath || '',
    normalizedKey: field.normalizedKey || null,
    repeatSection: field.repeatSection || null,
    repeatIndex: field.repeatIndex ?? null,
  };
}

function buildDebugExportPayload({ tab, detectResult, matchResult, profileName }) {
  const matched = matchResult?.matched || [];
  const unmatched = matchResult?.unmatched || [];
  const diagnostics = matchResult?.diagnostics || {};
  const forms = (detectResult?.forms || []).map(form => ({
    id: form.id,
    fieldCount: form.fields?.length || 0,
    fields: (form.fields || []).map(summarizeFieldForDebug),
  }));

  return {
    exportedAt: new Date().toISOString(),
    page: {
      url: tab?.url || '',
      title: tab?.title || '',
      hostname: tab?.url ? new URL(tab.url).hostname : '',
    },
    profile: {
      name: profileName || 'default',
    },
    summary: {
      totalForms: forms.length,
      totalFields: detectResult?.totalFields || 0,
      matched: matched.length,
      unmatched: unmatched.length,
      unmappedFields: diagnostics.unmappedFields?.length || 0,
      unmappedValues: diagnostics.unmappedValues?.length || 0,
      missingRequiredFields: diagnostics.missingRequiredFields?.length || 0,
      sensitiveSkipped: diagnostics.sensitiveFieldsSkipped?.length || 0,
    },
    diagnostics,
    forms,
    matched: matched.map(item => ({
      formId: item.formId,
      key: item.key || null,
      value: item.value ?? null,
      rawValue: item.rawValue ?? null,
      isFile: Boolean(item.isFile),
      field: summarizeFieldForDebug(item.field),
    })),
    unmatched: unmatched.map(item => ({
      formId: item.formId,
      normalizedKey: item.normalizedKey || item.field?.normalizedKey || null,
      profileValue: item.profileValue ?? null,
      reason: item.reason || null,
      field: summarizeFieldForDebug(item.field),
    })),
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(action, data = {}, options) {
  const tab = await getActiveTab();
  if (!tab) throw new Error('Cannot access active tab');
  return chrome.tabs.sendMessage(tab.id, { action, ...data }, options);
}

async function getActiveSiteProfile() {
  const tab = await getActiveTab();
  const targetContext = normalizeTargetProfileContext({
    company: targetCompanyInput?.value,
    role: targetRoleInput?.value,
    notes: targetNotesInput?.value,
  });
  const response = await chrome.runtime.sendMessage({
    action: 'getProfile',
    hostname: tab?.url || '',
    targetKey: targetContext.targetKey,
  });
  return response?.success ? response.data : null;
}

async function getCurrentSiteContext() {
  const tab = await getActiveTab();
  return {
    tab,
    hostname: normalizeSiteKey(tab?.url || ''),
  };
}

function getCurrentTargetContext() {
  return normalizeTargetProfileContext({
    company: targetCompanyInput?.value,
    role: targetRoleInput?.value,
    notes: targetNotesInput?.value,
  });
}

async function renderTargetDraftStatus(message = '') {
  if (!targetDraftStatus) return;

  const context = getCurrentTargetContext();
  if (!hasTargetProfileContext(context) || !activeProfileId) {
    targetDraftStatus.textContent = message || '未设置目标岗位，当前使用通用资料。';
    if (btnClearTargetDraft) btnClearTargetDraft.disabled = true;
    return;
  }

  const patch = await getTargetProfileDraft(activeProfileId, context.targetKey);
  const label = getTargetDraftDisplayLabel(context) || context.targetKey;
  const fieldCount = Object.keys(patch || {}).length;

  if (patch) {
    targetDraftStatus.innerHTML = `${escapeHtml(label)} 已加载岗位版资料，当前覆盖 <strong>${fieldCount}</strong> 个顶层字段。`;
  } else {
    targetDraftStatus.innerHTML = `${escapeHtml(label)} 暂无岗位版资料，当前仍使用通用资料。`;
  }

  if (message) {
    targetDraftStatus.innerHTML += ` ${escapeHtml(message)}`;
  }
  if (btnClearTargetDraft) btnClearTargetDraft.disabled = !patch;
}

async function generateTargetDraft() {
  const context = getCurrentTargetContext();
  if (!hasTargetProfileContext(context)) {
    throw new Error('请先填写目标公司或岗位');
  }

  profilesData[activeProfileId].data = formToProfile();
  await saveActiveProfileData(profilesData[activeProfileId].data, { snapshotReason: 'active_profile_save' });

  const settings = await getSettings();
  const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
  if (!settings.aiEnabled || (!provider.noApiKey && !settings.apiKey)) {
    throw new Error('璇峰厛鍦ㄨ缃腑鍚敤鍙敤鐨?AI 妯″瀷');
  }

  setDetectInfo(`姝ｅ湪鐢熸垚 ${getTargetDraftDisplayLabel(context) || context.targetKey} 鐨勫矖浣嶇増璧勬枡...`, true);
  const port = chrome.runtime.connect({ name: 'keepalive' });
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'generateTargetProfileDraft',
      payload: {
        profileId: activeProfileId,
        profile: profilesData[activeProfileId].data,
        jobContext: context,
      },
    });
    if (!response?.success) {
      throw new Error(response?.error || '岗位版资料生成失败');
    }

    const fieldCount = Object.keys(response.data?.patch || {}).length;
    await renderSnapshots();
    await renderTargetDraftStatus(fieldCount ? `AI 已更新 ${fieldCount} 个顶层字段。` : 'AI 判定无需额外覆盖字段。');
    if (detectedData) await showFillPreview();
    showToast(fieldCount ? `岗位版资料已生成：${fieldCount} 个字段` : '岗位版资料已刷新，无需新增覆盖', 'success');
  } finally {
    restoreDetectInfoSummary();
    port.disconnect();
  }
}

async function clearTargetDraft() {
  const context = getCurrentTargetContext();
  if (!hasTargetProfileContext(context)) {
    throw new Error('请先填写要清空的目标公司或岗位');
  }

  await saveTargetProfileDraft(activeProfileId, context.targetKey, undefined, { merge: false });
  await renderSnapshots();
  await renderTargetDraftStatus('已清空该岗位版资料。');
  if (detectedData) await showFillPreview();
}

function buildSiteOverridePreview(baseProfile, overridePatch) {
  if (!overridePatch) return '鏆傛棤绔欑偣瑕嗙洊';
  const mergedProfile = mergeProfileWithOverride(baseProfile || {}, overridePatch);
  const preview = {};
  for (const key of Object.keys(overridePatch)) {
    preview[key] = mergedProfile[key];
  }
  return JSON.stringify(preview, null, 2);
}

function renderSiteOverrideDraftPreview() {
  if (!siteOverrideEditor || !siteOverridePreview) return;
  const raw = siteOverrideEditor.value.trim();
  if (!raw) {
    siteOverridePreview.textContent = '鏆傛棤绔欑偣瑕嗙洊';
    return;
  }

  try {
    const patch = JSON.parse(raw);
    const baseProfile = normalizeProfile(profilesData[activeProfileId]?.data || {});
    siteOverridePreview.textContent = buildSiteOverridePreview(baseProfile, patch);
  } catch {
    siteOverridePreview.textContent = 'JSON 无法解析，当前预览不可用。';
  }
}

async function renderSiteOverridePanel() {
  if (!siteOverrideHost || !siteOverrideEditor || !siteOverridePreview) return;

  const { hostname } = await getCurrentSiteContext();
  if (!hostname || !activeProfileId) {
    siteOverrideHost.textContent = '未识别站点';
    siteOverrideEditor.value = '';
    siteOverridePreview.textContent = '请先切到一个真实招聘页面，再编辑站点覆盖资料。';
    return;
  }

  const overridePatch = await getSiteProfileOverride(activeProfileId, hostname);
  const baseProfile = normalizeProfile(profilesData[activeProfileId]?.data || {});

  siteOverrideHost.textContent = hostname;
  siteOverrideEditor.value = overridePatch ? JSON.stringify(overridePatch, null, 2) : '';
  siteOverridePreview.textContent = buildSiteOverridePreview(baseProfile, overridePatch);
}

function setDetectInfo(message, loading = false) {
  detectInfo.innerHTML = loading ? `<span class="spinner-sm"></span> ${message}` : message;
}

function restoreDetectInfoSummary() {
  if (detectedData?.totalFields) {
    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 涓瓧娈礰);
    return;
  }
  setDetectInfo('鍦ㄦ嫑鑱橀〉闈㈢偣鍑烩�滀竴閿～琛ㄢ�濓紝鑷姩濉叆鍙敤璧勬枡骞舵彁绀虹己澶遍」');
}

function renderDiagnostics(diagnostics, report = null) {
  const missing = diagnostics?.missingRequiredFields?.length || report?.missingRequiredFields?.length || 0;
  const unmapped = diagnostics?.unmappedFields?.length || report?.unmappedFields?.length || 0;
  const unmappedValues = diagnostics?.unmappedValues?.length || report?.unmappedValues?.length || 0;
  const sensitive = diagnostics?.sensitiveFieldsSkipped?.length || report?.skippedSensitive?.length || 0;
  const warnings = report?.warnings?.length || 0;
  if (!missing && !unmapped && !unmappedValues && !sensitive && !warnings) {
    fillDiagnostics.style.display = 'none';
    fillDiagnostics.innerHTML = '';
    return;
  }
  const parts = [];
  if (report?.adapterUsed) parts.push(`閫傞厤鍣?<strong>${escapeHtml(report.adapterUsed)}</strong>`);
  if (missing) parts.push(`<strong>${missing}</strong> 涓繀濉瓧娈电己璧勬枡`);
  if (sensitive) parts.push(`<strong>${sensitive}</strong> 涓晱鎰熷瓧娈靛凡璺宠繃`);
  if (unmapped) parts.push(`<strong>${unmapped}</strong> 涓瓧娈垫殏鏈鐩朻);
  if (unmappedValues) parts.push(`<strong>${unmappedValues}</strong> 涓�兼湭鏄犲皠`);
  if (warnings) parts.push(`<strong>${warnings}</strong> 涓珯鐐瑰憡璀);
  fillDiagnostics.innerHTML = parts.join(' 璺?');
  fillDiagnostics.style.display = 'block';
}

async function detectForms() {
  if (detectInProgress) return;
  detectInProgress = true;
  detectedData = null;
  fillPreview.style.display = 'none';
  fillDiagnostics.style.display = 'none';
  fillResults.style.display = 'none';
  emptyHint.style.display = 'none';
  btnFillMain.disabled = true;
  btnExportDebug.style.display = 'none';
  setDetectInfo('姝ｅ湪妫�娴嬭〃鍗?..', true);

  try {
    const tab = await getActiveTab();
    const response = await chrome.runtime.sendMessage({ action: 'detectAllFrames', tabId: tab.id });
    if (!response?.success || !response.data?.totalFields) {
      setDetectInfo('褰撳墠椤甸潰鏈娴嬪埌鍙～琛ㄥ崟');
      emptyHint.style.display = 'block';
      return;
    }
    detectedData = response.data;
    btnFillMain.disabled = false;
    btnExportDebug.style.display = '';
    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${response.data.totalFields}</strong> 涓瓧娈礰);
    await showFillPreview();
  } catch {
    setDetectInfo('鏃犳硶杩炴帴鍒伴〉闈紝璇峰埛鏂板悗閲嶈瘯');
    emptyHint.style.display = 'block';
  } finally {
    detectInProgress = false;
  }
}

async function showFillPreview() {
  if (!detectedData) return;
  const profile = await getActiveSiteProfile();
  if (!profile) return;

  try {
    const response = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!response?.success) return;
    const { matched, unmatched, diagnostics } = response.data;
    const settings = await getSettings();
    const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    const aiCandidates = unmatched
      .filter(item => item.field.type !== 'file')
      .map(item => ({
        ...item,
        field: {
          ...item.field,
          normalizedKey: item.normalizedKey || item.field.normalizedKey || null,
        },
      }));
    const previewProfileName = profilesData[activeProfileId]?.name || 'default';
    const previewParts = [`璧勬枡 <strong>${escapeHtml(previewProfileName)}</strong>`, `瑙勫垯鍛戒腑 <strong>${matched.length}</strong> 椤筦];
    const targetContext = getCurrentTargetContext();
    if (hasTargetProfileContext(targetContext)) {
      previewParts.push(`宀椾綅鐗?<strong>${escapeHtml(getTargetDraftDisplayLabel(targetContext) || targetContext.targetKey)}</strong>`);
    }
    if (aiCandidates.length) {
      previewParts.push(
        (settings.aiEnabled && (provider.noApiKey || settings.apiKey))
          ? `AI 鍊欓�?<strong>${aiCandidates.length}</strong> 椤筦
          : `鏈尮閰?<strong>${aiCandidates.length}</strong> 椤筦
      );
    }
    if (diagnostics?.unmappedValues?.length) {
      previewParts.push(`鍊兼湭鏄犲皠 <strong>${diagnostics.unmappedValues.length}</strong> 椤筦);
    }
    fillPreview.innerHTML = previewParts.join(' 璺?');
    fillPreview.style.display = 'block';
    renderDiagnostics(diagnostics);
  } catch {}
}

async function exportDebugSnapshot() {
  try {
    if (!detectedData?.totalFields) {
      await detectForms();
    }
    if (!detectedData?.totalFields) {
      throw new Error('璇峰厛鍦ㄥ綋鍓嶉〉闈㈡娴嬪埌琛ㄥ崟鍚庡啀瀵煎嚭');
    }

    setDetectInfo('姝ｅ湪瀵煎嚭褰撳墠椤甸潰璋冭瘯淇℃伅...', true);
    const profile = await getActiveSiteProfile();
    if (!profile) {
      throw new Error('璇峰厛淇濆瓨涓汉璧勬枡');
    }

    const matchResponse = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResponse?.success) {
      throw new Error(matchResponse?.error || '瀛楁鍖归厤澶辫触');
    }

    const tab = await getActiveTab();
    const payload = buildDebugExportPayload({
      tab,
      detectResult: detectedData,
      matchResult: matchResponse.data,
      profileName: profilesData[activeProfileId]?.name || 'default',
    });
    const hostname = sanitizeFilenamePart(payload.page.hostname || tab?.title || 'page');
    const filename = `jobpilot-debug-${hostname}-${formatExportTimestamp()}.json`;
    downloadJsonFile(filename, payload);
    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 涓瓧娈礰);
    showToast(`璋冭瘯缁撴灉宸插鍑猴細${filename}`, 'success');
  } catch (error) {
    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${detectedData?.totalFields || 0}</strong> 涓瓧娈礰);
    showToast(error.message, 'error');
  }
}

async function runFill() {
  if (!detectedData) return;
  fillInProgress = true;
  btnFillMain.disabled = true;
  btnFillMain.textContent = '濉〃涓?..';

  try {
    const profile = await getActiveSiteProfile();
    if (!profile) throw new Error('璇峰厛淇濆瓨涓汉璧勬枡');
    const settings = await getSettings();
    const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    const matchResponse = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResponse?.success) throw new Error(matchResponse?.error || '瀛楁鍖归厤澶辫触');

    const { matched, unmatched, diagnostics } = matchResponse.data;
    renderDiagnostics(diagnostics);
    const resumeFile = await getResumeFile();
    allMappings = matched.map(item => ({ ...item, source: 'regex', ...(item.isFile && resumeFile ? { fileData: resumeFile } : {}) }));

    const aiCandidates = unmatched.filter(item => item.field.type !== 'file');
    let aiMeta = null;
    if (aiCandidates.length && settings.aiEnabled && (provider.noApiKey || settings.apiKey)) {
      setDetectInfo(`AI 姝ｅ湪琛ュ厖 ${aiCandidates.length} 涓瓧娈?..`, true);
      const port = chrome.runtime.connect({ name: 'keepalive' });
      try {
        const aiResponse = await chrome.runtime.sendMessage({
          action: 'aiFieldMapping',
          payload: { unmatchedFields: aiCandidates.map(item => item.field), profile },
        });
        if (aiResponse?.success) {
          aiMeta = { model: aiResponse.data?.model, usage: aiResponse.data?.usage };
          for (const mapping of aiResponse.data?.fieldMappings || []) {
            if (!mapping?.suggestedValue) continue;
            const target = aiCandidates.find(item => item.field.id === mapping.fieldId);
            if (!target) continue;
            allMappings.push({
              field: target.field,
              formId: target.formId,
              key: target.normalizedKey || target.field.normalizedKey || null,
              value: mapping.suggestedValue,
              source: 'ai',
              confidence: mapping.confidence ?? 1,
            });
          }
        }
      } finally {
        port.disconnect();
      }
    }

    setDetectInfo('姝ｅ湪鍐欏叆椤甸潰瀛楁...', true);
    const tab = await getActiveTab();
    const fillResponse = await chrome.runtime.sendMessage({
      action: 'fillAllFrames',
      payload: { tabId: tab.id, allMappings, profile, diagnostics },
    });
    if (!fillResponse?.success) throw new Error(fillResponse?.error || '濉〃澶辫触');
    await renderResults(
      fillResponse.data.results,
      fillResponse.data.summary,
      fillResponse.data.report,
      aiMeta,
      settings.confidenceThreshold
    );

    await saveHistoryEntry({
      url: tab?.url || '',
      title: tab?.title || '',
      fieldsCount: fillResponse.data.summary.total,
      successCount: fillResponse.data.summary.filled,
      failCount: fillResponse.data.summary.errors,
      aiCount: allMappings.filter(item => item.source === 'ai').length,
      diagnostics,
      fillReport: fillResponse.data.report,
      leanMappings: allMappings.filter(item => item.value && !item.isFile),
    });
    await learnFromSuccessfulFill(tab, fillResponse.data.results);

    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 涓瓧娈礰);
    showToast(`濉〃瀹屾垚锛?{fillResponse.data.summary.filled} 椤规垚鍔焋, 'success');
  } catch (error) {
    setDetectInfo(`妫�娴嬪埌 <strong style="color:#2563eb">${detectedData?.totalFields || 0}</strong> 涓瓧娈礰);
    showToast(error.message, 'error');
  } finally {
    fillInProgress = false;
    btnFillMain.disabled = false;
    btnFillMain.textContent = '一键填表';
  }
}

async function learnFromSuccessfulFill(tab, fillResults = []) {
  if (!Array.isArray(fillResults) || !fillResults.length) return;

  const hostname = (() => {
    try {
      return new URL(tab?.url || '').hostname || '';
    } catch {
      return '';
    }
  })();

  const successfulMappings = fillResults
    .filter(result => result?.status === 'filled')
    .map(result => allMappings.find(mapping => mapping.field?.id === result.fieldId))
    .filter(mapping => mapping && mapping.key && mapping.source === 'regex' && !mapping.isFile);

  if (!successfulMappings.length) return;

  const samples = successfulMappings
    .map(mapping => buildSemanticFieldSample(mapping.field, mapping.key, {
      hostname,
      source: mapping.matchMethod || mapping.source || 'regex',
    }))
    .filter(Boolean);

  if (!samples.length) return;
  await learnSemanticFieldMemorySamples(samples);
  await renderSemanticMemoryStatus();
}

async function renderSemanticMemoryStatus(extraText = '') {
  if (!semanticMemoryStatus) return;
  const memory = await getSemanticFieldMemory();
  const hostCount = new Set(memory.map(entry => entry.hostname).filter(Boolean)).size;
  semanticMemoryStatus.textContent = `已学习 ${memory.length} 条字段样本，覆盖 ${hostCount} 个站点${extraText ? ` · ${extraText}` : ''}`;
}

async function importSemanticDebugFiles(files = []) {
  const fileList = Array.from(files || []).filter(Boolean);
  if (!fileList.length) return;

  const beforeMemory = await getSemanticFieldMemory();
  const samples = [];
  let parsedFiles = 0;
  let failedFiles = 0;
  let matchedLearned = 0;
  let unmatchedLearned = 0;

  for (const file of fileList) {
    try {
      const payload = JSON.parse(await file.text());
      const extracted = extractSemanticSamplesFromDebugExport(payload);
      if (!extracted.samples.length) {
        failedFiles += 1;
        continue;
      }
      samples.push(...extracted.samples);
      matchedLearned += extracted.stats.matchedLearned;
      unmatchedLearned += extracted.stats.unmatchedLearned;
      parsedFiles += 1;
    } catch (error) {
      console.warn('[JobPilot] debug JSON import skipped:', file.name, error.message);
      failedFiles += 1;
    }
  }

  if (!samples.length) {
    await renderSemanticMemoryStatus();
    throw new Error('没有从所选 Debug JSON 中提取到可学习样本');
  }

  const afterMemory = await learnSemanticFieldMemorySamples(samples);
  const delta = Math.max(0, afterMemory.length - beforeMemory.length);
  await renderSemanticMemoryStatus(`鏈鏂板 ${delta} 鏉);

  const summary = `宸插鐞?${parsedFiles}/${fileList.length} 涓枃浠讹紝瀛︿範 ${samples.length} 鏉℃牱鏈紙鍛戒腑 ${matchedLearned}锛岀己鍊?${unmatchedLearned}锛塦;
  if (failedFiles) {
    showToast(`${summary}锛岃烦杩?${failedFiles} 涓棤鏁堟枃浠禶, 'success');
    return;
  }
  showToast(summary, 'success');
}

async function renderResults(results, summary, report, aiMeta, confidenceThreshold) {
  fillPreview.style.display = 'none';
  fillResults.style.display = 'block';
  emptyHint.style.display = 'none';
  renderDiagnostics(null, report);

  const enriched = results.map(result => {
    const mapping = allMappings.find(item => item.field.id === result.fieldId);
    return {
      ...result,
      label: mapping?.field?.label || result.fieldId,
      value: mapping?.rawValue || mapping?.value || '',
      source: mapping?.source || 'unknown',
      confidence: mapping?.confidence ?? 1,
    };
  });

  let summaryHtml = `鎴愬姛 <strong>${summary.filled}</strong> 椤?路 璺宠繃 ${summary.skipped} 椤筦;
  if (summary.errors) summaryHtml += ` 路 <span style="color:var(--red)">澶辫触 ${summary.errors} 椤?/span>`;
  if (aiMeta?.usage) {
    const tokens = (aiMeta.usage.promptTokens || 0) + (aiMeta.usage.completionTokens || 0);
    summaryHtml += ` 路 AI ${escapeHtml(aiMeta.model || '')} (${tokens} tokens)`;
  }
  resultsSummary.innerHTML = summaryHtml;
  const reportSummary = summarizeFillReport(report || {});
  const reportBits = [`鎴愬姛 <strong>${summary.filled}</strong> 椤筦, `璺宠繃 ${summary.skipped} 椤筦];
  const targetContext = getCurrentTargetContext();
  if (hasTargetProfileContext(targetContext)) {
    reportBits.push(`宀椾綅鐗?${escapeHtml(getTargetDraftDisplayLabel(targetContext) || targetContext.targetKey)}`);
  }
  if (summary.errors) reportBits.push(`<span style="color:var(--red)">澶辫触 ${summary.errors} 椤?/span>`);
  if (reportSummary.unmappedValueCount) reportBits.push(`鍊兼湭鏄犲皠 ${reportSummary.unmappedValueCount}`);
  if (reportSummary.warningCount) reportBits.push(`鍛婅 ${reportSummary.warningCount}`);
  if (aiMeta?.usage) {
    const tokens = (aiMeta.usage.promptTokens || 0) + (aiMeta.usage.completionTokens || 0);
    reportBits.push(`AI ${escapeHtml(aiMeta.model || '')} (${tokens} tokens)`);
  }
  resultsSummary.innerHTML = reportBits.join(' 璺?');
  resultsList.innerHTML = '';

  for (const item of enriched) {
    const low = item.source === 'ai' && item.status === 'filled' && item.confidence < confidenceThreshold;
    const li = document.createElement('li');
    li.className = `result-item ${item.status === 'filled' ? (low ? 'ai-low' : item.source === 'ai' ? 'ai' : 'filled') : item.status}`;
    li.dataset.fieldId = item.fieldId;
    li.innerHTML = `
      <span class="result-icon">${item.status === 'filled' ? '?' : item.status === 'skipped' ? '○' : '×'}</span>
      <div class="result-body">
        <div class="result-top">
          <span class="result-label">${escapeHtml(item.label)}</span>
          ${item.source === 'regex' && item.status === 'filled' ? '<span class="badge badge-green">瑙勫垯</span>' : ''}
          ${item.source === 'ai' && item.status === 'filled' ? `<span class="badge ${low ? 'badge-yellow' : 'badge-blue'}">AI ${Math.round(item.confidence * 100)}%</span>` : ''}
        </div>
        <span class="result-value">${escapeHtml(item.value || item.message || '')}</span>
      </div>`;
    resultsList.appendChild(li);
  }
}

function refreshCardHeaders(listId, label) {
  const cards = [...document.getElementById(listId).querySelectorAll('.entry-card')];
  cards.forEach((card, index) => {
    card.querySelector('.entry-card-label').textContent = `${label} ${index + 1}`;
    card.querySelector('.btn-card-up').disabled = index === 0;
    card.querySelector('.btn-card-down').disabled = index === cards.length - 1;
  });
}

function renderCards(listId, entries, createCard, label) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  const values = entries?.length ? entries : [{}];
  values.forEach(item => list.appendChild(createCard(item)));
  refreshCardHeaders(listId, label);
}

function readCards(listId, fields) {
  return [...document.getElementById(listId).querySelectorAll('.entry-card')]
    .map(card => {
      const result = {};
      fields.forEach(field => {
        setFieldValue(result, field, card.querySelector(`[data-field="${field}"]`)?.value?.trim?.() || '');
      });
      return result;
    })
    .filter(item => fields.some(field => {
      const value = getFieldValue(item, field);
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }));
}

function createCardShell(innerHtml) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="涓婄Щ">鈫?/button>
        <button type="button" class="btn-icon btn-card-down" title="涓嬬Щ">鈫?/button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="鍒犻櫎">脳</button>
      </div>
    </div>
    ${innerHtml}`;
  return card;
}

function createEducationCard(entry = {}) {
  return createCardShell(`
    <div class="form-row"><label>瀛︽牎</label><input type="text" data-field="school" value="${escapeAttr(entry.school)}"></div>
    <div class="form-row two-col">
      <div><label>涓撲笟</label><input type="text" data-field="major" value="${escapeAttr(entry.major)}"></div>
      <div><label>瀛﹀巻</label><input type="text" data-field="degree" value="${escapeAttr(entry.degree)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鍏ュ鏃堕棿</label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>姣曚笟鏃堕棿</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>瀛︿範褰㈠紡</label><input type="text" data-field="studyMode" value="${escapeAttr(entry.studyMode)}"></div>
      <div><label>GPA / 鎺掑悕</label><input type="text" data-field="gpa" value="${escapeAttr(entry.gpa)}"></div>
    </div>`);
}

function createExperienceCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>鍏徃</label><input type="text" data-field="company" value="${escapeAttr(entry.company)}"></div>
      <div><label>閮ㄩ棬</label><input type="text" data-field="department" value="${escapeAttr(entry.department)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鑱屼綅</label><input type="text" data-field="title" value="${escapeAttr(entry.title)}"></div>
      <div><label>鍦扮偣</label><input type="text" data-field="location" value="${escapeAttr(entry.location)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>寮�濮嬫椂闂?/label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>缁撴潫鏃堕棿</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>宸ヤ綔鎻忚堪</label><textarea data-field="description" rows="3">${escapeHtml(entry.description)}</textarea></div>
    <div class="form-row"><label>涓昏涓氱哗</label><textarea data-field="achievements" rows="2">${escapeHtml(entry.achievements)}</textarea></div>`);
}

function createProjectCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>椤圭洰鍚嶇О</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
      <div><label>椤圭洰瑙掕壊</label><input type="text" data-field="role" value="${escapeAttr(entry.role)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>寮�濮嬫椂闂?/label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>缁撴潫鏃堕棿</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>椤圭洰鎻忚堪</label><textarea data-field="description" rows="3">${escapeHtml(entry.description)}</textarea></div>
    <div class="form-row"><label>鎶�鏈爤</label><input type="text" data-field="techStack" value="${escapeAttr(entry.techStack)}"></div>`);
}

function createAwardCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>濂栭」鍚嶇О</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
      <div><label>鑾峰骞翠唤</label><input type="text" data-field="year" value="${escapeAttr(entry.year)}"></div>
    </div>
    <div class="form-row"><label>棰佸彂鍗曚綅</label><input type="text" data-field="issuer" value="${escapeAttr(entry.issuer)}"></div>
    <div class="form-row"><label>澶囨敞</label><input type="text" data-field="description" value="${escapeAttr(entry.description)}"></div>`);
}

function createCompetitionCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>绔炶禌鍚嶇О</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
      <div><label>绛夌骇</label><input type="text" data-field="level" value="${escapeAttr(entry.level)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鑾峰 / 鑽ｈ獕</label><input type="text" data-field="award" value="${escapeAttr(entry.award)}"></div>
      <div><label>鏃堕棿</label><input type="month" data-field="date" value="${escapeAttr(entry.date)}"></div>
    </div>
    <div class="form-row"><label>缁忓巻鎻忚堪</label><textarea data-field="description" rows="3">${escapeHtml(entry.description)}</textarea></div>`);
}

function createLanguageCard(entry = {}) {
  const certType = getFieldValue(entry, 'customFields.certType') || '';
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>璇█</label><input type="text" data-field="language" value="${escapeAttr(entry.language || entry.name)}"></div>
      <div><label>鎺屾彙绋嬪害</label><input type="text" data-field="proficiency" value="${escapeAttr(entry.proficiency || entry.level)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鍚</label><input type="text" data-field="listeningSpeaking" value="${escapeAttr(entry.listeningSpeaking)}"></div>
      <div><label>璇诲啓</label><input type="text" data-field="readingWriting" value="${escapeAttr(entry.readingWriting)}"></div>
    </div>`);
}

function createLanguageCardEnhanced(entry = {}) {
  const certType = getFieldValue(entry, 'customFields.certType') || '';
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>璇█</label><input type="text" data-field="language" value="${escapeAttr(entry.language || entry.name)}"></div>
      <div><label>鎺屾彙绋嬪害</label><input type="text" data-field="proficiency" value="${escapeAttr(entry.proficiency || entry.level)}"></div>
    </div>
    <div class="form-row"><label>澶栬鑰冭瘯 / 绛夌骇</label><input type="text" data-field="customFields.certType" value="${escapeAttr(certType)}" placeholder="CET-6 / IELTS 7.5 / TEM-8"></div>
    <div class="form-row two-col">
      <div><label>鍚</label><input type="text" data-field="listeningSpeaking" value="${escapeAttr(entry.listeningSpeaking)}"></div>
      <div><label>璇诲啓</label><input type="text" data-field="readingWriting" value="${escapeAttr(entry.readingWriting)}"></div>
    </div>`);
}

function createLanguageExamCard(entry = {}) {
  const examType = entry.examType || '';
  const examOptions = [
    '',
    'CET-4',
    'CET-6',
    'TOEFL',
    'GRE',
    'GMAT',
    'IELTS',
    'TEM',
    'SAT',
    'ACT',
    'CERF',
  ];
  const optionsHtml = examOptions
    .map(option => `<option value="${escapeAttr(option)}"${option === examType ? ' selected' : ''}>${escapeHtml(option || 'Select Exam')}</option>`)
    .join('');

  return createCardShell(`
    <div class="form-row two-col">
      <div><label>Exam Type</label><select data-field="examType">${optionsHtml}</select></div>
      <div><label>Score / Level</label><input type="text" data-field="score" value="${escapeAttr(entry.score)}" placeholder="520 / 7.5 / B2"></div>
    </div>`);
}

function createDeveloperLanguageCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>寮�鍙戣瑷�</label><input type="text" data-field="name" value="${escapeAttr(entry.name || entry.language)}"></div>
      <div><label>鎺屾彙绋嬪害</label><input type="text" data-field="level" value="${escapeAttr(entry.level || entry.proficiency)}"></div>
    </div>`);
}

function createFamilyCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>鍏崇郴</label><input type="text" data-field="relation" value="${escapeAttr(entry.relation)}"></div>
      <div><label>濮撳悕</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鍑虹敓鏃ユ湡</label><input type="text" data-field="birthDate" value="${escapeAttr(entry.birthDate)}"></div>
      <div><label>鏀挎不闈㈣矊</label><input type="text" data-field="politicalStatus" value="${escapeAttr(entry.politicalStatus)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>宸ヤ綔鍗曚綅</label><input type="text" data-field="employer" value="${escapeAttr(entry.employer)}"></div>
      <div><label>鑱屽姟</label><input type="text" data-field="jobTitle" value="${escapeAttr(entry.jobTitle)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>鐘舵�?/label><input type="text" data-field="status" value="${escapeAttr(entry.status)}"></div>
      <div><label>鎵�鍦ㄥ湴</label><input type="text" data-field="location" value="${escapeAttr(entry.location)}"></div>
    </div>`);
}

LIST_CONFIG.education.createCard = createEducationCard;
LIST_CONFIG.experience.createCard = createExperienceCard;
LIST_CONFIG.projects.createCard = createProjectCard;
LIST_CONFIG.awards.createCard = createAwardCard;
LIST_CONFIG.competitions.createCard = createCompetitionCard;
LIST_CONFIG.languages.createCard = createLanguageCard;
LIST_CONFIG.languageExams.createCard = createLanguageExamCard;
LIST_CONFIG.developerLanguages.createCard = createDeveloperLanguageCard;
LIST_CONFIG.familyMembers.createCard = createFamilyCard;

function bindCardList(listId, label) {
  const list = document.getElementById(listId);
  list.addEventListener('click', event => {
    const card = event.target.closest('.entry-card');
    if (!card) return;
    const cards = [...list.querySelectorAll('.entry-card')];
    const index = cards.indexOf(card);
    if (event.target.closest('.btn-card-del')) {
      if (cards.length <= 1) return showToast('至少保留一条记录', 'error');
      card.remove();
    } else if (event.target.closest('.btn-card-up') && index > 0) {
      list.insertBefore(card, cards[index - 1]);
    } else if (event.target.closest('.btn-card-down') && index < cards.length - 1) {
      list.insertBefore(cards[index + 1], card);
    }
    refreshCardHeaders(listId, label);
  });
}

function formToProfile() {
  const get = name => profileForm.querySelector(`[name="${name}"]`)?.value?.trim?.() || '';
  const profile = createEmptyProfile();
  const getOptionalNumber = name => {
    const value = get(name);
    return value === '' ? null : Number(value);
  };
  const getOptionalBoolean = name => {
    const value = get(name);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  };

  setByPath(profile, 'personal.fullName', get('name'));
  setByPath(profile, 'personal.fullNamePinyin', get('personal.fullNamePinyin'));
  setByPath(profile, 'personal.firstName', get('firstName'));
  setByPath(profile, 'personal.lastName', get('lastName'));
  setByPath(profile, 'personal.englishName', get('personal.englishName'));
  setByPath(profile, 'personal.gender', get('gender'));
  setByPath(profile, 'personal.birthDate', get('birthday'));
  setByPath(profile, 'personal.age', getOptionalNumber('personal.age'));
  setByPath(profile, 'personal.nationality', get('personal.nationality'));
  setByPath(profile, 'personal.ethnicity', get('ethnicity'));
  setByPath(profile, 'personal.heightCm', getOptionalNumber('personal.heightCm'));
  setByPath(profile, 'personal.weightKg', getOptionalNumber('personal.weightKg'));
  setByPath(profile, 'personal.maritalStatus', get('personal.maritalStatus'));
  setByPath(profile, 'personal.healthStatus', get('personal.healthStatus'));
  setByPath(profile, 'personal.bloodType', get('personal.bloodType'));
  setByPath(profile, 'personal.nativePlace', get('hometown'));
  setByPath(profile, 'personal.politicalStatus', get('politicalStatus'));
  setByPath(profile, 'personal.partyJoinDate', get('personal.partyJoinDate'));
  setByPath(profile, 'personal.freshGraduateStatus', get('personal.freshGraduateStatus'));
  setByPath(profile, 'personal.hasOverseasStudy', getOptionalBoolean('personal.hasOverseasStudy'));
  setByPath(profile, 'identity.documentType', get('documentType'));
  setByPath(profile, 'identity.documentNumber', get('idNumber'));
  setByPath(profile, 'contact.phone', get('phone'));
  setByPath(profile, 'contact.email', get('email'));
  setByPath(profile, 'contact.address', get('address'));
  setByPath(profile, 'contact.wechat', get('wechat'));
  setByPath(profile, 'contact.qq', get('qq'));
  setByPath(profile, 'contact.landline', get('contact.landline'));
  setByPath(profile, 'contact.postalCode', get('contact.postalCode'));
  setByPath(profile, 'contact.emergencyContactName', get('contact.emergencyContactName'));
  setByPath(profile, 'contact.emergencyContactPhone', get('contact.emergencyContactPhone'));
  setByPath(profile, 'residency.currentCity', get('residency.currentCity'));
  setByPath(profile, 'residency.currentAddress', get('residency.currentAddress'));
  setByPath(profile, 'residency.homeAddress', get('residency.homeAddress'));
  setByPath(profile, 'residency.householdType', get('residency.householdType'));
  setByPath(profile, 'residency.householdAddress', get('residency.householdAddress'));
  setByPath(profile, 'residency.policeStation', get('residency.policeStation'));
  setByPath(profile, 'jobPreferences.expectedLocations', get('jobPreferences.expectedCity').split(/[,锛屻�乚/).map(item => item.trim()).filter(Boolean));
  setByPath(profile, 'jobPreferences.expectedPositions', get('jobPreferences.expectedPositions').split(/[,锛屻�乚/).map(item => item.trim()).filter(Boolean));
  setByPath(profile, 'jobPreferences.availableFrom', get('jobPreferences.availableFrom'));
  setByPath(profile, 'jobPreferences.expectedSalary', get('jobPreferences.expectedSalary'));
  setByPath(profile, 'jobPreferences.internshipDuration', get('jobPreferences.internshipDuration'));
  setByPath(profile, 'jobPreferences.jobStatus', get('jobPreferences.jobStatus'));
  setByPath(
    profile,
    'jobPreferences.interviewLocations',
    get('jobPreferences.interviewLocations').split(/[,锛屻�乚/).map(item => item.trim()).filter(Boolean)
  );
  Object.entries(LIST_CONFIG).forEach(([key, config]) => setByPath(profile, key, readCards(config.listId, config.fields)));
  setByPath(profile, 'skills', get('skills').split(/[,锛屻�乚/).map(item => item.trim()).filter(Boolean));
  setByPath(profile, 'links.github', get('links.github'));
  setByPath(profile, 'links.linkedin', get('links.linkedin'));
  setByPath(profile, 'links.website', get('links.website'));
  profile.graduationYear = get('graduationYear');
  profile.selfIntro = get('selfIntro');
  return normalizeProfile(profile);
}

function profileToForm(profile) {
  const normalized = normalizeProfile(profile || {});
  profileForm.querySelectorAll('[name]').forEach(element => { element.value = ''; });
  const set = (name, value) => {
    const element = profileForm.querySelector(`[name="${name}"]`);
    if (element) element.value = value ?? '';
  };

  set('name', normalized.personal.fullName);
  set('personal.fullNamePinyin', normalized.personal.fullNamePinyin);
  set('firstName', normalized.personal.firstName);
  set('lastName', normalized.personal.lastName);
  set('personal.englishName', normalized.personal.englishName);
  set('gender', normalized.personal.gender);
  set('birthday', normalized.personal.birthDate);
  set('personal.age', normalized.personal.age ?? '');
  set('personal.nationality', normalized.personal.nationality);
  set('ethnicity', normalized.personal.ethnicity);
  set('personal.heightCm', normalized.personal.heightCm ?? '');
  set('personal.weightKg', normalized.personal.weightKg ?? '');
  set('personal.maritalStatus', normalized.personal.maritalStatus);
  set('personal.healthStatus', normalized.personal.healthStatus);
  set('personal.bloodType', normalized.personal.bloodType);
  set('hometown', normalized.personal.nativePlace);
  set('politicalStatus', normalized.personal.politicalStatus);
  set('personal.partyJoinDate', normalized.personal.partyJoinDate);
  set('personal.freshGraduateStatus', normalized.personal.freshGraduateStatus);
  set('personal.hasOverseasStudy', normalized.personal.hasOverseasStudy == null ? '' : String(normalized.personal.hasOverseasStudy));
  set('documentType', normalized.identity.documentType);
  set('idNumber', normalized.identity.documentNumber);
  set('phone', normalized.contact.phone);
  set('email', normalized.contact.email);
  set('address', normalized.contact.address);
  set('wechat', normalized.contact.wechat);
  set('qq', normalized.contact.qq);
  set('contact.landline', normalized.contact.landline);
  set('contact.postalCode', normalized.contact.postalCode);
  set('contact.emergencyContactName', normalized.contact.emergencyContactName);
  set('contact.emergencyContactPhone', normalized.contact.emergencyContactPhone);
  set('residency.currentCity', normalized.residency.currentCity);
  set('residency.currentAddress', normalized.residency.currentAddress);
  set('residency.homeAddress', normalized.residency.homeAddress);
  set('residency.householdType', normalized.residency.householdType);
  set('residency.householdAddress', normalized.residency.householdAddress);
  set('residency.policeStation', normalized.residency.policeStation);
  set('jobPreferences.expectedCity', normalized.jobPreferences.expectedLocations.join(', '));
  set('jobPreferences.interviewLocations', normalized.jobPreferences.interviewLocations.join(', '));
  set('jobPreferences.expectedPositions', normalized.jobPreferences.expectedPositions.join(', '));
  set('jobPreferences.availableFrom', normalized.jobPreferences.availableFrom);
  set('jobPreferences.expectedSalary', normalized.jobPreferences.expectedSalary);
  set('jobPreferences.internshipDuration', normalized.jobPreferences.internshipDuration);
  set('jobPreferences.jobStatus', normalized.jobPreferences.jobStatus);
  set('graduationYear', normalized.graduationYear || '');
  set('skills', normalized.skills.join(', '));
  set('links.github', normalized.links?.github || '');
  set('links.linkedin', normalized.links?.linkedin || '');
  set('links.website', normalized.links?.website || '');
  set('selfIntro', normalized.selfIntro || '');

  Object.entries(LIST_CONFIG).forEach(([key, config]) => {
    renderCards(config.listId, normalized[key], config.createCard, config.label);
  });
}

async function loadProfiles() {
  profilesData = await getProfiles() || {};
  activeProfileId = await getActiveProfileId();
  profileSelect.innerHTML = Object.entries(profilesData)
    .map(([id, profile]) => `<option value="${id}"${id === activeProfileId ? ' selected' : ''}>${escapeHtml(profile.name)}</option>`)
    .join('');
  profileToForm(profilesData[activeProfileId]?.data || createEmptyProfile());
  await renderSiteOverridePanel();
  await renderTargetDraftStatus();
}

async function renderHistory() {
  const list = document.getElementById('historyList');
  const history = await getHistory();
  if (!history.length) {
    list.innerHTML = '<p class="history-empty">鏆傛棤璁板綍</p>';
    return;
  }

  list.innerHTML = history.map(item => {
    const ts = new Date(item.timestamp);
    const timeText = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
    return `
      <div class="history-item">
        <div class="history-item-url">${escapeHtml(item.url || '')}</div>
        <div class="history-item-meta">
          <span>${timeText}</span>
          <span class="history-stat ok">鉁?${item.successCount || 0}</span>
          ${item.failCount ? `<span class="history-stat err">脳 ${item.failCount}</span>` : ''}
          ${item.leanMappings?.length ? `<button class="btn-sm btn-replay-history" data-ts="${item.timestamp}" style="margin-left:auto">鍥炲～</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function formatSnapshotTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '鏈煡鏃堕棿';
  const pad = entry => String(entry).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSnapshotReason(reason) {
  return {
    active_profile_save: '保存资料前',
    profile_create: '新建资料前',
    profile_duplicate: '复制资料前',
    profile_delete: '删除资料前',
    profile_rename: '閲嶅懡鍚嶅墠',
    site_profile_override_save: '站点资料更新前',
    site_profile_override_delete: '站点资料删除前',
    target_profile_draft_save: '宀椾綅鐗堣祫鏂欐洿鏂板墠',
    target_profile_draft_delete: '宀椾綅鐗堣祫鏂欏垹闄ゅ墠',
    snapshot_restore_backup: '恢复前自动备份',
  }[reason] || reason || '资料变更前';
}

function countSnapshotSiteOverrides(siteOverrides = {}) {
  return Object.values(siteOverrides || {}).reduce((total, entries) => total + Object.keys(entries || {}).length, 0);
}

function countSnapshotTargetDrafts(targetDrafts = {}) {
  return Object.values(targetDrafts || {}).reduce((total, entries) => total + Object.keys(entries || {}).length, 0);
}

async function renderSnapshots() {
  if (!snapshotList) return;
  const snapshots = await getProfileSnapshots();
  if (!snapshots.length) {
    snapshotList.innerHTML = '<p class="history-empty">鏆傛棤璧勬枡蹇収</p>';
    return;
  }

  snapshotList.innerHTML = snapshots.map(snapshot => {
    const profileCount = Object.keys(snapshot.profiles || {}).length;
    const siteOverrideCount = countSnapshotSiteOverrides(snapshot.siteOverrides);
    const targetDraftCount = countSnapshotTargetDrafts(snapshot.targetDrafts);
    const activeProfileName = snapshot.profiles?.[snapshot.activeProfileId]?.name || snapshot.activeProfileId || 'default';

    return `
      <div class="snapshot-item">
        <div class="snapshot-item-header">
          <div class="snapshot-item-title">${escapeHtml(formatSnapshotTime(snapshot.createdAt))}</div>
          <button class="btn-sm btn-restore-snapshot" data-snapshot-id="${escapeAttr(snapshot.id)}">鎭㈠</button>
        </div>
        <div class="snapshot-item-meta">
          <span>${escapeHtml(formatSnapshotReason(snapshot.reason))}</span>
          <span>妯℃澘 ${escapeHtml(activeProfileName)}</span>
          <span>${profileCount} 浠借祫鏂?/span>
          ${siteOverrideCount ? `<span>${siteOverrideCount} 涓珯鐐硅鐩?/span>` : ''}
          ${targetDraftCount ? `<span>${targetDraftCount} 涓矖浣嶇増</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function closePdfModal() {
  document.getElementById('pdfOverlay').style.display = 'none';
}

function showPdfStep(step) {
  ['mode', 'loading', 'preview'].forEach(name => {
    document.getElementById(`pdfStep${name[0].toUpperCase()}${name.slice(1)}`).style.display = name === step ? 'block' : 'none';
  });
}

function renderPdfPreview(profile) {
  pdfCandidateProfile = normalizeProfile(profile);
  const current = normalizeProfile(profilesData[activeProfileId]?.data || {});
  const list = document.getElementById('pdfPreviewList');
  list.innerHTML = '';

  for (const [label, path] of PDF_PREVIEW_FIELDS) {
    const nextValue = getFieldValue(pdfCandidateProfile, path);
    if (!nextValue) continue;
    const currentValue = getFieldValue(current, path);
    const row = document.createElement('div');
    row.className = 'pdf-field-row has-value';
    row.dataset.path = path;
    row.innerHTML = `
      <input type="checkbox" checked>
      <div class="pdf-field-info">
        <div class="pdf-field-label">${escapeHtml(label)}</div>
        <div class="pdf-field-values">
          ${currentValue ? `<span class="pdf-current-val">${escapeHtml(String(currentValue))}</span><span class="pdf-arrow">鈫?/span>` : ''}
          <span class="pdf-new-val">${escapeHtml(String(nextValue))}</span>
        </div>
      </div>`;
    list.appendChild(row);
  }

  if (!list.children.length) {
    list.innerHTML = '<p class="history-empty">鏈粠 PDF 涓彁鍙栧埌鍙鍏ュ瓧娈?/p>';
  }
  showPdfStep('preview');
}

async function handlePdfParse(mode) {
  if (!currentPdfFile) return;
  showPdfStep('loading');

  try {
    if (mode === 'local') {
      document.getElementById('pdfLoadingText').textContent = '姝ｅ湪瑙ｆ瀽 PDF 鏂囨湰...';
      const pdfjs = await loadPdfJs();
      const content = await extractPdfContent(currentPdfFile, pdfjs);
      renderPdfPreview(parseLocalRegex(content.text, { links: content.links }));
      return;
    }

    const settings = await getSettings();
    const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    if (!settings.aiEnabled || (!provider.noApiKey && !settings.apiKey)) {
      throw new Error('璇峰厛閰嶇疆鍙敤鐨?AI 妯″瀷');
    }
    document.getElementById('pdfLoadingText').textContent = '姝ｅ湪鐢?AI 瑙ｆ瀽绠�鍘?..';
    const pdfjs = await loadPdfJs();
    const text = await extractPdfText(currentPdfFile, pdfjs);
    const ai = new AIProvider(settings);
    const { json } = await ai.completeJSON(buildAiParsePrompt(text), { timeout: 60000 });
    renderPdfPreview(json);
  } catch (error) {
    showPdfStep('mode');
    const hint = document.getElementById('pdfAiFallbackHint');
    hint.textContent = error.message;
    hint.style.display = 'block';
  }
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(`tab-${button.dataset.tab}`).classList.add('active');
      if (button.dataset.tab === 'profile') renderSiteOverridePanel();
      if (button.dataset.tab === 'settings') {
        renderHistory();
        renderSnapshots();
      }
    });
  });

  document.getElementById('btnDetect').addEventListener('click', detectForms);
  btnExportDebug.addEventListener('click', exportDebugSnapshot);
  btnFillMain.addEventListener('click', runFill);
  btnGenerateTargetDraft?.addEventListener('click', async () => {
    try {
      await generateTargetDraft();
    } catch (error) {
      showToast(error.message, 'error');
      await renderTargetDraftStatus();
    }
  });
  btnClearTargetDraft?.addEventListener('click', async () => {
    try {
      await clearTargetDraft();
      showToast('宀椾綅鐗堣祫鏂欏凡娓呯┖', 'success');
    } catch (error) {
      showToast(error.message, 'error');
      await renderTargetDraftStatus();
    }
  });
  [targetCompanyInput, targetRoleInput, targetNotesInput].forEach(input => {
    input?.addEventListener('input', () => {
      renderTargetDraftStatus().catch(() => {});
    });
    input?.addEventListener('change', async () => {
      await renderTargetDraftStatus();
      if (detectedData) await showFillPreview();
    });
  });
  document.getElementById('btnRefill').addEventListener('click', async () => {
    fillResults.style.display = 'none';
    await showFillPreview();
  });

  profileSelect.addEventListener('change', async () => {
    await setActiveProfile(profileSelect.value);
    activeProfileId = profileSelect.value;
    profileToForm(profilesData[activeProfileId]?.data || createEmptyProfile());
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
    if (detectedData) await showFillPreview();
  });

  document.getElementById('btnNewProfile').addEventListener('click', async () => {
    const name = prompt('新模板名称', '新建资料');
    if (!name?.trim()) return;
    activeProfileId = await createProfile(name.trim());
    await loadProfiles();
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
  });

  document.getElementById('btnDuplicateProfile').addEventListener('click', async () => {
    const currentName = profilesData[activeProfileId]?.name || '褰撳墠璧勬枡';
    await saveActiveProfileData(formToProfile());
    activeProfileId = await duplicateProfile(activeProfileId, `${currentName} 鍓湰`);
    await loadProfiles();
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
  });

  document.getElementById('btnDeleteProfile').addEventListener('click', async () => {
    if (!confirm('确认删除当前资料模板？')) return;
    await deleteProfile(activeProfileId);
    await loadProfiles();
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
  });

  bindCardList(LIST_CONFIG.education.listId, LIST_CONFIG.education.label);
  bindCardList(LIST_CONFIG.experience.listId, LIST_CONFIG.experience.label);
  bindCardList(LIST_CONFIG.projects.listId, LIST_CONFIG.projects.label);
  bindCardList(LIST_CONFIG.awards.listId, LIST_CONFIG.awards.label);
  bindCardList(LIST_CONFIG.competitions.listId, LIST_CONFIG.competitions.label);
  bindCardList(LIST_CONFIG.languages.listId, LIST_CONFIG.languages.label);
  bindCardList(LIST_CONFIG.languageExams.listId, LIST_CONFIG.languageExams.label);
  bindCardList(LIST_CONFIG.developerLanguages.listId, LIST_CONFIG.developerLanguages.label);
  bindCardList(LIST_CONFIG.familyMembers.listId, LIST_CONFIG.familyMembers.label);

  document.getElementById('btnAddEducation').addEventListener('click', () => renderCards('educationList', [...readCards('educationList', LIST_CONFIG.education.fields), {}], createEducationCard, '鏁欒偛缁忓巻'));
  document.getElementById('btnAddExperience').addEventListener('click', () => renderCards('experienceList', [...readCards('experienceList', LIST_CONFIG.experience.fields), {}], createExperienceCard, '宸ヤ綔缁忓巻'));
  document.getElementById('btnAddProject').addEventListener('click', () => renderCards('projectList', [...readCards('projectList', LIST_CONFIG.projects.fields), {}], createProjectCard, '椤圭洰缁忓巻'));
  document.getElementById('btnAddAward').addEventListener('click', () => renderCards('awardList', [...readCards('awardList', LIST_CONFIG.awards.fields), {}], createAwardCard, '濂栭」'));
  document.getElementById('btnAddCompetition').addEventListener('click', () => renderCards('competitionList', [...readCards('competitionList', LIST_CONFIG.competitions.fields), {}], createCompetitionCard, '绔炶禌'));
  document.getElementById('btnAddLanguage').addEventListener('click', () => renderCards('languageList', [...readCards('languageList', LIST_CONFIG.languages.fields), {}], LIST_CONFIG.languages.createCard, '璇█'));
  document.getElementById('btnAddLanguageExam').addEventListener('click', () => renderCards('languageExamList', [...readCards('languageExamList', LIST_CONFIG.languageExams.fields), {}], LIST_CONFIG.languageExams.createCard, '璇█鑰冭瘯'));
  document.getElementById('btnAddDeveloperLanguage').addEventListener('click', () => renderCards('developerLanguageList', [...readCards('developerLanguageList', LIST_CONFIG.developerLanguages.fields), {}], createDeveloperLanguageCard, '寮�鍙戣瑷�'));
  document.getElementById('btnAddFamily').addEventListener('click', () => renderCards('familyList', [...readCards('familyList', LIST_CONFIG.familyMembers.fields), {}], createFamilyCard, '瀹跺涵鎴愬憳'));

  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const profile = formToProfile();
    profilesData[activeProfileId].data = profile;
    await saveActiveProfileData(profile);
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
    showToast('资料已保存', 'success');
    if (detectedData) await showFillPreview();
  });

  document.getElementById('btnImportProfile').addEventListener('click', () => document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const profile = normalizeProfile(JSON.parse(await file.text()));
    profileToForm(profile);
    profilesData[activeProfileId].data = profile;
    await saveActiveProfileData(profile);
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
    event.target.value = '';
  });

  document.getElementById('btnImportSemanticDebug').addEventListener('click', () => {
    document.getElementById('semanticDebugInput').click();
  });
  document.getElementById('semanticDebugInput').addEventListener('change', async event => {
    const files = Array.from(event.target.files || []);
    try {
      await importSemanticDebugFiles(files);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('btnExportProfile').addEventListener('click', async () => {
    const profile = normalizeProfile(formToProfile());
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const anchor = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `jobpilot-${profilesData[activeProfileId]?.name || 'profile'}.json`,
    });
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  });

  document.getElementById('resumeFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    await saveResumeFile(file);
    document.getElementById('resumeCurrent').textContent = `宸蹭笂浼狅細${file.name}`;
    event.target.value = '';
  });

  document.getElementById('btnPdfImport').addEventListener('click', () => document.getElementById('pdfFileInput').click());
  document.getElementById('pdfFileInput').addEventListener('change', event => {
    currentPdfFile = event.target.files[0];
    if (!currentPdfFile) return;
    document.getElementById('pdfFilename').textContent = `${currentPdfFile.name} 路 ${(currentPdfFile.size / 1024).toFixed(1)} KB`;
    document.getElementById('pdfAiFallbackHint').style.display = 'none';
    showPdfStep('mode');
    document.getElementById('pdfOverlay').style.display = 'flex';
    event.target.value = '';
  });

  document.getElementById('btnLocalParse').addEventListener('click', () => handlePdfParse('local'));
  document.getElementById('btnAIParse').addEventListener('click', () => handlePdfParse('ai'));
  document.getElementById('pdfModalClose').addEventListener('click', closePdfModal);
  document.getElementById('pdfOverlay').addEventListener('click', event => {
    if (event.target.id === 'pdfOverlay') closePdfModal();
  });
  document.getElementById('btnSelectAll').addEventListener('click', () => document.querySelectorAll('#pdfPreviewList input').forEach(input => { input.checked = true; }));
  document.getElementById('btnDeselectAll').addEventListener('click', () => document.querySelectorAll('#pdfPreviewList input').forEach(input => { input.checked = false; }));
  document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const profile = normalizeProfile(profilesData[activeProfileId]?.data || {});
    document.querySelectorAll('#pdfPreviewList .pdf-field-row').forEach(row => {
      if (row.querySelector('input')?.checked) {
        setFieldValue(profile, row.dataset.path, getFieldValue(pdfCandidateProfile, row.dataset.path));
      }
    });
    profilesData[activeProfileId].data = normalizeProfile(profile);
    await saveActiveProfileData(profilesData[activeProfileId].data);
    await renderSnapshots();
    await renderSiteOverridePanel();
    await renderTargetDraftStatus();
    profileToForm(profilesData[activeProfileId].data);
    closePdfModal();
  });

  const providerSelect = document.getElementById('providerSelect');
  const modelSelect = document.getElementById('modelSelect');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyRow = document.getElementById('apiKeyRow');
  const ollamaHint = document.getElementById('ollamaHint');
  const confidenceSlider = document.getElementById('confidenceThreshold');
  const thresholdValue = document.getElementById('thresholdValue');

  function updateProviderUI(providerName) {
    const preset = PROVIDER_PRESETS[providerName];
    apiKeyRow.style.display = preset.noApiKey ? 'none' : '';
    ollamaHint.style.display = preset.noApiKey ? 'block' : 'none';
    modelSelect.innerHTML = preset.models.map(model => `<option value="${model}">${model}</option>`).join('');
  }

  providerSelect.addEventListener('change', () => updateProviderUI(providerSelect.value));
  confidenceSlider.addEventListener('input', () => { thresholdValue.textContent = Number(confidenceSlider.value).toFixed(2); });
  document.getElementById('btnToggleKey').addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('btnTestConn').addEventListener('click', async () => {
    const resultEl = document.getElementById('testResult');
    try {
      if (providerSelect.value === 'ollama' && !(await checkOllamaRunning())) {
        throw new Error('Ollama 未运行');
      }
      const ai = new AIProvider({
        provider: providerSelect.value,
        apiKey: apiKeyInput.value.trim(),
        model: modelSelect.value,
        temperature: 0.1,
      });
      const { content } = await ai.complete([{ role: 'user', content: '璇蜂粎鍥炲 OK' }]);
      resultEl.className = 'test-result ok';
      resultEl.textContent = content.slice(0, 40);
    } catch (error) {
      resultEl.className = 'test-result err';
      resultEl.textContent = error.message;
    }
  });

  document.getElementById('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    await saveSettings({
      provider: providerSelect.value,
      model: modelSelect.value,
      apiKey: apiKeyInput.value.trim(),
      aiEnabled: document.getElementById('aiEnabled').checked,
      confidenceThreshold: Number(confidenceSlider.value),
    });
    showToast('设置已保存', 'success');
    if (detectedData) await showFillPreview();
  });

  siteOverrideEditor?.addEventListener('input', () => {
    renderSiteOverrideDraftPreview();
  });

  document.getElementById('btnReloadSiteOverride')?.addEventListener('click', async () => {
    await renderSiteOverridePanel();
  });


  document.getElementById('btnSaveSiteOverride')?.addEventListener('click', async () => {
    const { hostname } = await getCurrentSiteContext();
    if (!hostname) {
      showToast('No active site detected', 'error');
      return;
    }

    try {
      const raw = siteOverrideEditor.value.trim();
      const patch = raw ? JSON.parse(raw) : undefined;
      await saveSiteProfileOverride(activeProfileId, hostname, patch, { merge: false });
      await renderSnapshots();
      await renderSiteOverridePanel();
      if (detectedData) await showFillPreview();
      showToast(raw ? 'Site override saved' : 'Site override cleared', 'success');
    } catch (error) {
      showToast(error.message || 'Invalid site override JSON', 'error');
    }
  });

  document.getElementById('btnClearSiteOverride')?.addEventListener('click', async () => {
    const { hostname } = await getCurrentSiteContext();
    if (!hostname) {
      showToast('No active site detected', 'error');
      return;
    }
    if (!confirm('Clear this site override and fall back to the base profile?')) return;

    try {
      await saveSiteProfileOverride(activeProfileId, hostname, undefined, { merge: false });
      await renderSnapshots();
      await renderSiteOverridePanel();
      await renderTargetDraftStatus();
      if (detectedData) await showFillPreview();
      showToast('Site override cleared', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  document.getElementById('btnClearHistory').addEventListener('click', async () => {
    await clearHistory();
    await renderHistory();
  });

  document.getElementById('btnClearSemanticMemory').addEventListener('click', async () => {
    if (!confirm('清空语义记忆后，系统将失去基于历史站点样本的学习结果。继续吗？')) return;
    await saveSemanticFieldMemory([]);
    await renderSemanticMemoryStatus('已清空');
    showToast('语义记忆已清空', 'success');
  });

  document.getElementById('btnRefreshSnapshots').addEventListener('click', async () => {
    await renderSnapshots();
  });

  document.getElementById('historyList').addEventListener('click', async event => {
    const button = event.target.closest('.btn-replay-history');
    if (!button) return;
    const history = await getHistory();
    const entry = history.find(item => String(item.timestamp) === button.dataset.ts);
    if (!entry?.leanMappings?.length) return;
    const tab = await getActiveTab();
    const response = await chrome.runtime.sendMessage({
      action: 'fillAllFrames',
      payload: { tabId: tab.id, allMappings: entry.leanMappings },
    });
    if (response?.success) showToast('鍘嗗彶鍥炲～瀹屾垚', 'success');
  });

  snapshotList?.addEventListener('click', async event => {
    const button = event.target.closest('.btn-restore-snapshot');
    if (!button) return;
    if (!confirm('恢复这个快照会覆盖当前资料，但会先自动备份当前状态。继续吗？')) return;

    try {
      await restoreProfileSnapshot(button.dataset.snapshotId);
      await loadProfiles();
      await renderSnapshots();
      await renderSiteOverridePanel();
      await renderTargetDraftStatus();
      if (detectedData) await showFillPreview();
      showToast('已恢复资料快照', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  resultsList.addEventListener('click', async event => {
    const item = event.target.closest('.result-item');
    if (!item) return;
    const mapping = allMappings.find(entry => entry.field.id === item.dataset.fieldId);
    if (!mapping?.field) return;
    const tab = await getActiveTab();
    chrome.tabs.sendMessage(tab.id, { action: 'highlightField', field: mapping.field }, { frameId: mapping.field.frameId ?? 0 }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'formsUpdated' && !fillInProgress && !detectInProgress) detectForms();
  });
}

async function init() {
  await migrateToMultiProfile();
  await migrateEducationToArray();
  bindEvents();
  await loadProfiles();
  await renderSnapshots();
  await renderSemanticMemoryStatus();
  await renderSiteOverridePanel();

  const resumeFile = await getResumeFile();
  if (resumeFile) document.getElementById('resumeCurrent').textContent = `宸蹭笂浼狅細${resumeFile.name}`;

  const settings = await getSettings();
  const preset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
  document.getElementById('providerSelect').value = settings.provider;
  document.getElementById('apiKeyInput').value = settings.apiKey || '';
  document.getElementById('aiEnabled').checked = settings.aiEnabled;
  document.getElementById('confidenceThreshold').value = settings.confidenceThreshold;
  document.getElementById('thresholdValue').textContent = Number(settings.confidenceThreshold).toFixed(2);
  document.getElementById('apiKeyRow').style.display = preset.noApiKey ? 'none' : '';
  document.getElementById('ollamaHint').style.display = preset.noApiKey ? 'block' : 'none';
  document.getElementById('modelSelect').innerHTML = preset.models.map(model => `<option value="${model}">${model}</option>`).join('');
  if (preset.models.includes(settings.model)) document.getElementById('modelSelect').value = settings.model;

  await detectForms();
}

init();
