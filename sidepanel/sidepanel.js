import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfileData,
  getActiveProfileId,
  getHistory,
  getProfiles,
  getResumeFile,
  getSettings,
  migrateEducationToArray,
  migrateToMultiProfile,
  saveActiveProfileData,
  saveHistoryEntry,
  saveResumeFile,
  saveSettings,
  setActiveProfile,
  clearHistory,
} from '../lib/storage.js';
import { AIProvider, PROVIDER_PRESETS, checkOllamaRunning } from '../lib/ai-provider.js';
import { loadPdfJs } from '../lib/pdfjs-loader.js';
import { summarizeFillReport } from '../lib/fill-report.js';
import { buildAiParsePrompt, extractPdfContent, extractPdfText, getFieldValue, parseLocalRegex, setFieldValue } from '../lib/pdf-parser.js';
import { createEmptyProfile, normalizeProfile, setByPath } from '../lib/profile-schema.js';

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
const btnExportDebug = ensureDebugExportButton();
const profileForm = document.getElementById('profileForm');
const profileSelect = document.getElementById('profileSelect');

const LIST_CONFIG = {
  education: {
    listId: 'educationList',
    label: '教育经历',
    fields: ['school', 'major', 'degree', 'startDate', 'endDate', 'studyMode', 'gpa'],
  },
  experience: {
    listId: 'experienceList',
    label: '工作经历',
    fields: ['company', 'department', 'title', 'location', 'startDate', 'endDate', 'description', 'achievements'],
  },
  projects: {
    listId: 'projectList',
    label: '项目经历',
    fields: ['name', 'role', 'startDate', 'endDate', 'description', 'techStack'],
  },
  awards: {
    listId: 'awardList',
    label: '奖项',
    fields: ['name', 'issuer', 'year', 'description'],
  },
  languages: {
    listId: 'languageList',
    label: '语言',
    fields: ['language', 'proficiency', 'listeningSpeaking', 'readingWriting'],
  },
  familyMembers: {
    listId: 'familyList',
    label: '家庭成员',
    fields: ['relation', 'name', 'birthDate', 'politicalStatus', 'employer', 'jobTitle', 'status', 'location'],
  },
};

const PDF_PREVIEW_FIELDS = [
  ['姓名', 'personal.fullName'],
  ['手机', 'contact.phone'],
  ['邮箱', 'contact.email'],
  ['身高', 'personal.heightCm'],
  ['体重', 'personal.weightKg'],
  ['现居城市', 'residency.currentCity'],
  ['期望城市', 'jobPreferences.expectedLocations'],
  ['期望岗位', 'jobPreferences.expectedPositions'],
  ['教育 1 学校', 'education[0].school'],
  ['教育 1 专业', 'education[0].major'],
  ['经历 1 公司', 'experience[0].company'],
  ['经历 1 职位', 'experience[0].title'],
  ['项目 1 名称', 'projects[0].name'],
  ['语言 1', 'languages[0].language'],
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
  button.textContent = '导出当前页调试 JSON';
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
  if (!tab) throw new Error('无法获取当前标签页');
  return chrome.tabs.sendMessage(tab.id, { action, ...data }, options);
}

function setDetectInfo(message, loading = false) {
  detectInfo.innerHTML = loading ? `<span class="spinner-sm"></span> ${message}` : message;
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
  if (report?.adapterUsed) parts.push(`适配器 <strong>${escapeHtml(report.adapterUsed)}</strong>`);
  if (missing) parts.push(`<strong>${missing}</strong> 个必填字段缺资料`);
  if (sensitive) parts.push(`<strong>${sensitive}</strong> 个敏感字段已跳过`);
  if (unmapped) parts.push(`<strong>${unmapped}</strong> 个字段暂未覆盖`);
  if (unmappedValues) parts.push(`<strong>${unmappedValues}</strong> 个值未映射`);
  if (warnings) parts.push(`<strong>${warnings}</strong> 个站点告警`);
  fillDiagnostics.innerHTML = parts.join(' 路 ');
  fillDiagnostics.style.display = 'block';
  return;
  if (missing) parts.push(`<strong>${missing}</strong> 个必填字段资料缺失`);
  if (sensitive) parts.push(`<strong>${sensitive}</strong> 个敏感字段已跳过`);
  if (unmapped) parts.push(`<strong>${unmapped}</strong> 个字段暂未覆盖`);
  fillDiagnostics.innerHTML = parts.join(' · ');
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
  setDetectInfo('正在检测表单...', true);

  try {
    const tab = await getActiveTab();
    const response = await chrome.runtime.sendMessage({ action: 'detectAllFrames', tabId: tab.id });
    if (!response?.success || !response.data?.totalFields) {
      setDetectInfo('当前页面未检测到可填表单');
      emptyHint.style.display = 'block';
      return;
    }
    detectedData = response.data;
    btnFillMain.disabled = false;
    btnExportDebug.style.display = '';
    setDetectInfo(`检测到 <strong style="color:#2563eb">${response.data.totalFields}</strong> 个字段`);
    await showFillPreview();
  } catch {
    setDetectInfo('无法连接到页面，请刷新后重试');
    emptyHint.style.display = 'block';
  } finally {
    detectInProgress = false;
  }
}

async function showFillPreview() {
  if (!detectedData) return;
  const profile = await getActiveProfileData();
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
    const previewParts = [`资料 <strong>${escapeHtml(previewProfileName)}</strong>`, `规则命中 <strong>${matched.length}</strong> 项`];
    if (aiCandidates.length) {
      previewParts.push(
        (settings.aiEnabled && (provider.noApiKey || settings.apiKey))
          ? `AI 候选 <strong>${aiCandidates.length}</strong> 项`
          : `未匹配 <strong>${aiCandidates.length}</strong> 项`
      );
    }
    if (diagnostics?.unmappedValues?.length) {
      previewParts.push(`值未映射 <strong>${diagnostics.unmappedValues.length}</strong> 项`);
    }
    fillPreview.innerHTML = previewParts.join(' 路 ');
    fillPreview.style.display = 'block';
    renderDiagnostics(diagnostics);
    return;
    const profileName = profilesData[activeProfileId]?.name || '默认资料';
    let summary = `资料 <strong>${escapeHtml(profileName)}</strong> · 正则命中 <strong>${matched.length}</strong> 项`;
    if (aiCandidates.length) {
      summary += (settings.aiEnabled && (provider.noApiKey || settings.apiKey))
        ? ` · AI 兜底 <strong>${aiCandidates.length}</strong> 项`
        : ` · 未匹配 <strong>${aiCandidates.length}</strong> 项`;
    }
    fillPreview.innerHTML = summary;
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
      throw new Error('请先在当前页面检测到表单后再导出');
    }

    setDetectInfo('正在导出当前页面调试信息...', true);
    const profile = await getActiveProfileData();
    if (!profile) {
      throw new Error('请先保存个人资料');
    }

    const matchResponse = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResponse?.success) {
      throw new Error(matchResponse?.error || '字段匹配失败');
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
    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 个字段`);
    showToast(`调试结果已导出：${filename}`, 'success');
  } catch (error) {
    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData?.totalFields || 0}</strong> 个字段`);
    showToast(error.message, 'error');
  }
}

async function runFill() {
  if (!detectedData) return;
  fillInProgress = true;
  btnFillMain.disabled = true;
  btnFillMain.textContent = '填表中...';

  try {
    const profile = await getActiveProfileData();
    if (!profile) throw new Error('请先保存个人资料');
    const settings = await getSettings();
    const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    const matchResponse = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResponse?.success) throw new Error(matchResponse?.error || '字段匹配失败');

    const { matched, unmatched, diagnostics } = matchResponse.data;
    renderDiagnostics(diagnostics);
    const resumeFile = await getResumeFile();
    allMappings = matched.map(item => ({ ...item, source: 'regex', ...(item.isFile && resumeFile ? { fileData: resumeFile } : {}) }));

    const aiCandidates = unmatched.filter(item => item.field.type !== 'file');
    let aiMeta = null;
    if (aiCandidates.length && settings.aiEnabled && (provider.noApiKey || settings.apiKey)) {
      setDetectInfo(`AI 正在补充 ${aiCandidates.length} 个字段...`, true);
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

    setDetectInfo('正在写入页面字段...', true);
    const tab = await getActiveTab();
    const fillResponse = await chrome.runtime.sendMessage({
      action: 'fillAllFrames',
      payload: { tabId: tab.id, allMappings, profile, diagnostics },
    });
    if (!fillResponse?.success) throw new Error(fillResponse?.error || '填表失败');
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

    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 个字段`);
    showToast(`填表完成：${fillResponse.data.summary.filled} 项成功`, 'success');
  } catch (error) {
    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData?.totalFields || 0}</strong> 个字段`);
    showToast(error.message, 'error');
  } finally {
    fillInProgress = false;
    btnFillMain.disabled = false;
    btnFillMain.textContent = '一键填表';
  }
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

  let summaryHtml = `成功 <strong>${summary.filled}</strong> 项 · 跳过 ${summary.skipped} 项`;
  if (summary.errors) summaryHtml += ` · <span style="color:var(--red)">失败 ${summary.errors} 项</span>`;
  if (aiMeta?.usage) {
    const tokens = (aiMeta.usage.promptTokens || 0) + (aiMeta.usage.completionTokens || 0);
    summaryHtml += ` · AI ${escapeHtml(aiMeta.model || '')} (${tokens} tokens)`;
  }
  resultsSummary.innerHTML = summaryHtml;
  const reportSummary = summarizeFillReport(report || {});
  const reportBits = [`成功 <strong>${summary.filled}</strong> 项`, `跳过 ${summary.skipped} 项`];
  if (summary.errors) reportBits.push(`<span style="color:var(--red)">失败 ${summary.errors} 项</span>`);
  if (reportSummary.unmappedValueCount) reportBits.push(`值未映射 ${reportSummary.unmappedValueCount}`);
  if (reportSummary.warningCount) reportBits.push(`告警 ${reportSummary.warningCount}`);
  if (aiMeta?.usage) {
    const tokens = (aiMeta.usage.promptTokens || 0) + (aiMeta.usage.completionTokens || 0);
    reportBits.push(`AI ${escapeHtml(aiMeta.model || '')} (${tokens} tokens)`);
  }
  resultsSummary.innerHTML = reportBits.join(' 路 ');
  resultsList.innerHTML = '';

  for (const item of enriched) {
    const low = item.source === 'ai' && item.status === 'filled' && item.confidence < confidenceThreshold;
    const li = document.createElement('li');
    li.className = `result-item ${item.status === 'filled' ? (low ? 'ai-low' : item.source === 'ai' ? 'ai' : 'filled') : item.status}`;
    li.dataset.fieldId = item.fieldId;
    li.innerHTML = `
      <span class="result-icon">${item.status === 'filled' ? '✓' : item.status === 'skipped' ? '○' : '×'}</span>
      <div class="result-body">
        <div class="result-top">
          <span class="result-label">${escapeHtml(item.label)}</span>
          ${item.source === 'regex' && item.status === 'filled' ? '<span class="badge badge-green">规则</span>' : ''}
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
        result[field] = card.querySelector(`[data-field="${field}"]`)?.value?.trim?.() || '';
      });
      return result;
    })
    .filter(item => Object.values(item).some(Boolean));
}

function createCardShell(innerHtml) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">×</button>
      </div>
    </div>
    ${innerHtml}`;
  return card;
}

function createEducationCard(entry = {}) {
  return createCardShell(`
    <div class="form-row"><label>学校</label><input type="text" data-field="school" value="${escapeAttr(entry.school)}"></div>
    <div class="form-row two-col">
      <div><label>专业</label><input type="text" data-field="major" value="${escapeAttr(entry.major)}"></div>
      <div><label>学历</label><input type="text" data-field="degree" value="${escapeAttr(entry.degree)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>入学时间</label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>毕业时间</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>学习形式</label><input type="text" data-field="studyMode" value="${escapeAttr(entry.studyMode)}"></div>
      <div><label>GPA / 排名</label><input type="text" data-field="gpa" value="${escapeAttr(entry.gpa)}"></div>
    </div>`);
}

function createExperienceCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>公司</label><input type="text" data-field="company" value="${escapeAttr(entry.company)}"></div>
      <div><label>部门</label><input type="text" data-field="department" value="${escapeAttr(entry.department)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>职位</label><input type="text" data-field="title" value="${escapeAttr(entry.title)}"></div>
      <div><label>地点</label><input type="text" data-field="location" value="${escapeAttr(entry.location)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>开始时间</label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>结束时间</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>工作描述</label><textarea data-field="description" rows="3">${escapeHtml(entry.description)}</textarea></div>
    <div class="form-row"><label>主要业绩</label><textarea data-field="achievements" rows="2">${escapeHtml(entry.achievements)}</textarea></div>`);
}

function createProjectCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>项目名称</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
      <div><label>项目角色</label><input type="text" data-field="role" value="${escapeAttr(entry.role)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>开始时间</label><input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>结束时间</label><input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>项目描述</label><textarea data-field="description" rows="3">${escapeHtml(entry.description)}</textarea></div>
    <div class="form-row"><label>技术栈</label><input type="text" data-field="techStack" value="${escapeAttr(entry.techStack)}"></div>`);
}

function createAwardCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>奖项名称</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
      <div><label>获奖年份</label><input type="text" data-field="year" value="${escapeAttr(entry.year)}"></div>
    </div>
    <div class="form-row"><label>颁发单位</label><input type="text" data-field="issuer" value="${escapeAttr(entry.issuer)}"></div>
    <div class="form-row"><label>备注</label><input type="text" data-field="description" value="${escapeAttr(entry.description)}"></div>`);
}

function createLanguageCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>语言</label><input type="text" data-field="language" value="${escapeAttr(entry.language || entry.name)}"></div>
      <div><label>掌握程度</label><input type="text" data-field="proficiency" value="${escapeAttr(entry.proficiency || entry.level)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>听说</label><input type="text" data-field="listeningSpeaking" value="${escapeAttr(entry.listeningSpeaking)}"></div>
      <div><label>读写</label><input type="text" data-field="readingWriting" value="${escapeAttr(entry.readingWriting)}"></div>
    </div>`);
}

function createFamilyCard(entry = {}) {
  return createCardShell(`
    <div class="form-row two-col">
      <div><label>关系</label><input type="text" data-field="relation" value="${escapeAttr(entry.relation)}"></div>
      <div><label>姓名</label><input type="text" data-field="name" value="${escapeAttr(entry.name)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>出生日期</label><input type="text" data-field="birthDate" value="${escapeAttr(entry.birthDate)}"></div>
      <div><label>政治面貌</label><input type="text" data-field="politicalStatus" value="${escapeAttr(entry.politicalStatus)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>工作单位</label><input type="text" data-field="employer" value="${escapeAttr(entry.employer)}"></div>
      <div><label>职务</label><input type="text" data-field="jobTitle" value="${escapeAttr(entry.jobTitle)}"></div>
    </div>
    <div class="form-row two-col">
      <div><label>状态</label><input type="text" data-field="status" value="${escapeAttr(entry.status)}"></div>
      <div><label>所在地</label><input type="text" data-field="location" value="${escapeAttr(entry.location)}"></div>
    </div>`);
}

LIST_CONFIG.education.createCard = createEducationCard;
LIST_CONFIG.experience.createCard = createExperienceCard;
LIST_CONFIG.projects.createCard = createProjectCard;
LIST_CONFIG.awards.createCard = createAwardCard;
LIST_CONFIG.languages.createCard = createLanguageCard;
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
  setByPath(profile, 'jobPreferences.expectedLocations', get('jobPreferences.expectedCity').split(/[,，、]/).map(item => item.trim()).filter(Boolean));
  setByPath(profile, 'jobPreferences.expectedPositions', get('jobPreferences.expectedPositions').split(/[,，、]/).map(item => item.trim()).filter(Boolean));
  setByPath(profile, 'jobPreferences.availableFrom', get('jobPreferences.availableFrom'));
  setByPath(profile, 'jobPreferences.expectedSalary', get('jobPreferences.expectedSalary'));
  setByPath(profile, 'jobPreferences.internshipDuration', get('jobPreferences.internshipDuration'));
  setByPath(profile, 'jobPreferences.jobStatus', get('jobPreferences.jobStatus'));
  Object.entries(LIST_CONFIG).forEach(([key, config]) => setByPath(profile, key, readCards(config.listId, config.fields)));
  setByPath(profile, 'skills', get('skills').split(/[,，、]/).map(item => item.trim()).filter(Boolean));
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
}

async function renderHistory() {
  const list = document.getElementById('historyList');
  const history = await getHistory();
  if (!history.length) {
    list.innerHTML = '<p class="history-empty">暂无记录</p>';
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
          <span class="history-stat ok">✓ ${item.successCount || 0}</span>
          ${item.failCount ? `<span class="history-stat err">× ${item.failCount}</span>` : ''}
          ${item.leanMappings?.length ? `<button class="btn-sm btn-replay-history" data-ts="${item.timestamp}" style="margin-left:auto">回填</button>` : ''}
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
          ${currentValue ? `<span class="pdf-current-val">${escapeHtml(String(currentValue))}</span><span class="pdf-arrow">→</span>` : ''}
          <span class="pdf-new-val">${escapeHtml(String(nextValue))}</span>
        </div>
      </div>`;
    list.appendChild(row);
  }

  if (!list.children.length) {
    list.innerHTML = '<p class="history-empty">未从 PDF 中提取到可导入字段</p>';
  }
  showPdfStep('preview');
}

async function handlePdfParse(mode) {
  if (!currentPdfFile) return;
  showPdfStep('loading');

  try {
    if (mode === 'local') {
      document.getElementById('pdfLoadingText').textContent = '正在解析 PDF 文本...';
      const pdfjs = await loadPdfJs();
      const content = await extractPdfContent(currentPdfFile, pdfjs);
      renderPdfPreview(parseLocalRegex(content.text, { links: content.links }));
      return;
    }

    const settings = await getSettings();
    const provider = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    if (!settings.aiEnabled || (!provider.noApiKey && !settings.apiKey)) {
      throw new Error('请先配置可用的 AI 模型');
    }
    document.getElementById('pdfLoadingText').textContent = '正在用 AI 解析简历...';
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
      if (button.dataset.tab === 'settings') renderHistory();
    });
  });

  document.getElementById('btnDetect').addEventListener('click', detectForms);
  btnExportDebug.addEventListener('click', exportDebugSnapshot);
  btnFillMain.addEventListener('click', runFill);
  document.getElementById('btnRefill').addEventListener('click', async () => {
    fillResults.style.display = 'none';
    await showFillPreview();
  });

  profileSelect.addEventListener('change', async () => {
    await setActiveProfile(profileSelect.value);
    activeProfileId = profileSelect.value;
    profileToForm(profilesData[activeProfileId]?.data || createEmptyProfile());
    if (detectedData) await showFillPreview();
  });

  document.getElementById('btnNewProfile').addEventListener('click', async () => {
    const name = prompt('新模板名称', '新建资料');
    if (!name?.trim()) return;
    activeProfileId = await createProfile(name.trim());
    await loadProfiles();
  });

  document.getElementById('btnDuplicateProfile').addEventListener('click', async () => {
    const currentName = profilesData[activeProfileId]?.name || '当前资料';
    await saveActiveProfileData(formToProfile());
    activeProfileId = await duplicateProfile(activeProfileId, `${currentName} 副本`);
    await loadProfiles();
  });

  document.getElementById('btnDeleteProfile').addEventListener('click', async () => {
    if (!confirm('确认删除当前资料模板？')) return;
    await deleteProfile(activeProfileId);
    await loadProfiles();
  });

  bindCardList(LIST_CONFIG.education.listId, LIST_CONFIG.education.label);
  bindCardList(LIST_CONFIG.experience.listId, LIST_CONFIG.experience.label);
  bindCardList(LIST_CONFIG.projects.listId, LIST_CONFIG.projects.label);
  bindCardList(LIST_CONFIG.awards.listId, LIST_CONFIG.awards.label);
  bindCardList(LIST_CONFIG.languages.listId, LIST_CONFIG.languages.label);
  bindCardList(LIST_CONFIG.familyMembers.listId, LIST_CONFIG.familyMembers.label);

  document.getElementById('btnAddEducation').addEventListener('click', () => renderCards('educationList', [...readCards('educationList', LIST_CONFIG.education.fields), {}], createEducationCard, '教育经历'));
  document.getElementById('btnAddExperience').addEventListener('click', () => renderCards('experienceList', [...readCards('experienceList', LIST_CONFIG.experience.fields), {}], createExperienceCard, '工作经历'));
  document.getElementById('btnAddProject').addEventListener('click', () => renderCards('projectList', [...readCards('projectList', LIST_CONFIG.projects.fields), {}], createProjectCard, '项目经历'));
  document.getElementById('btnAddAward').addEventListener('click', () => renderCards('awardList', [...readCards('awardList', LIST_CONFIG.awards.fields), {}], createAwardCard, '奖项'));
  document.getElementById('btnAddLanguage').addEventListener('click', () => renderCards('languageList', [...readCards('languageList', LIST_CONFIG.languages.fields), {}], createLanguageCard, '语言'));
  document.getElementById('btnAddFamily').addEventListener('click', () => renderCards('familyList', [...readCards('familyList', LIST_CONFIG.familyMembers.fields), {}], createFamilyCard, '家庭成员'));

  profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const profile = formToProfile();
    profilesData[activeProfileId].data = profile;
    await saveActiveProfileData(profile);
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
    event.target.value = '';
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
    document.getElementById('resumeCurrent').textContent = `已上传：${file.name}`;
    event.target.value = '';
  });

  document.getElementById('btnPdfImport').addEventListener('click', () => document.getElementById('pdfFileInput').click());
  document.getElementById('pdfFileInput').addEventListener('change', event => {
    currentPdfFile = event.target.files[0];
    if (!currentPdfFile) return;
    document.getElementById('pdfFilename').textContent = `${currentPdfFile.name} · ${(currentPdfFile.size / 1024).toFixed(1)} KB`;
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
      const { content } = await ai.complete([{ role: 'user', content: '请仅回复 OK' }]);
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

  document.getElementById('btnClearHistory').addEventListener('click', async () => {
    await clearHistory();
    await renderHistory();
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
    if (response?.success) showToast('历史回填完成', 'success');
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

  const resumeFile = await getResumeFile();
  if (resumeFile) document.getElementById('resumeCurrent').textContent = `已上传：${resumeFile.name}`;

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
