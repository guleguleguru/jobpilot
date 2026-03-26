/**
 * sidepanel.js — Phase 4（多 API / 多模板 / PDF 解析）
 */

import {
  getSettings, saveSettings,
  getResumeFile, saveResumeFile,
  getHistory, clearHistory,
  // Module C: 多模板
  getProfiles, getActiveProfileId, getActiveProfileData,
  setActiveProfile, saveActiveProfileData,
  createProfile, duplicateProfile, deleteProfile, renameProfile,
  migrateToMultiProfile, migrateEducationToArray,
} from '../lib/storage.js';

import { AIProvider, PROVIDER_PRESETS, checkOllamaRunning } from '../lib/ai-provider.js';
import { loadPdfJs } from '../lib/pdfjs-loader.js';
import {
  extractPdfText, extractPdfContent, parseLocalRegex, buildAiParsePrompt,
  PROFILE_DISPLAY_FIELDS, getFieldValue, setFieldValue,
} from '../lib/pdf-parser.js';

// ── 全局状态 ─────────────────────────────────────────────────

let detectedData    = null;
let allMappings     = [];
let profilesData    = {};      // { id: { name, data, createdAt } }
let activeProfileId = '';
let fillInProgress   = false;  // 填写流程中，阻止并发检测和 formsUpdated 打断
let detectInProgress = false;  // 检测流程中，阻止并发触发

// ── 工具函数 ──────────────────────────────────────────────────

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2800);
}

async function sendToContent(action, data = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('获取标签页失败');
  return chrome.tabs.sendMessage(tab.id, { action, ...data });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Tab 切换 ──────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${id}`).classList.add('active');
    if (id === 'settings') renderHistory();
  });
});

// ════════════════════════════════════════════════════════════
// TAB 1: 填写
// ════════════════════════════════════════════════════════════

const detectInfo   = document.getElementById('detectInfo');
const fillPreview  = document.getElementById('fillPreview');
const btnFillMain  = document.getElementById('btnFillMain');
const fillResults  = document.getElementById('fillResults');
const resultsSummary = document.getElementById('resultsSummary');
const resultsList  = document.getElementById('resultsList');
const btnRefill    = document.getElementById('btnRefill');
const emptyHint    = document.getElementById('emptyHint');

function setDetectInfo(html, loading = false) {
  detectInfo.innerHTML = loading ? `<span class="spinner-sm"></span> ${html}` : html;
}

async function detectForms() {
  if (detectInProgress) return;
  detectInProgress = true;

  setDetectInfo('正在检测表单...', true);
  btnFillMain.disabled = true;
  detectedData = null;
  fillPreview.style.display = 'none';
  fillResults.style.display = 'none';
  emptyHint.style.display   = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前标签页');
    const resp = await chrome.runtime.sendMessage({ action: 'detectAllFrames', tabId: tab.id });
    if (!resp?.success || resp.data.totalFields === 0) {
      setDetectInfo('当前页面未检测到表单字段');
      emptyHint.style.display = 'block';
      return;
    }
    detectedData = resp.data;
    setDetectInfo(`检测到 <strong style="color:#2563eb">${resp.data.totalFields}</strong> 个表单字段`);
    btnFillMain.disabled = false;
    await showFillPreview();
  } catch {
    setDetectInfo('无法连接到页面（请刷新后重试）');
    emptyHint.style.display = 'block';
  } finally {
    detectInProgress = false;
  }
}

async function showFillPreview() {
  if (!detectedData) return;
  try {
    const profile = await getActiveProfileData();
    if (!profile) return;
    const settings = await getSettings();
    const providerPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
    const resp = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!resp?.success) return;

    const { matched, unmatched } = resp.data;
    const aiCount   = unmatched.filter(u => u.field.type !== 'file').length;
    const fileCount = detectedData.forms.reduce((n, f) =>
      n + f.fields.filter(fld => fld.type === 'file').length, 0);

    const profileName = profilesData[activeProfileId]?.name || '默认简历';
    let text = `📋 <strong>${escapeHtml(profileName)}</strong> · 正则 <strong>${matched.length}</strong> 个`;
    if (aiCount > 0) {
      text += settings.aiEnabled && (providerPreset.noApiKey || settings.apiKey)
        ? `，AI <strong>${aiCount}</strong> 个`
        : `，<span style="color:var(--gray-400)">${aiCount} 个未匹配（未配置 AI）</span>`;
    }
    if (fileCount > 0) text += `，${fileCount} 个文件`;

    fillPreview.innerHTML = text;
    fillPreview.style.display = 'block';
  } catch (_) {}
}

// 一键填写
btnFillMain.addEventListener('click', async () => {
  if (!detectedData) return;
  fillInProgress = true;
  btnFillMain.disabled = true;
  btnFillMain.textContent = '填写中...';
  fillResults.style.display = 'none';

  try {
    const profile = await getActiveProfileData();
    if (!profile) {
      showToast('请先保存个人资料', 'error');
      document.querySelector('[data-tab="profile"]').click();
      return;
    }

    const settings = await getSettings();
    const providerPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;

    // 阶段 1: 正则匹配
    setDetectInfo('正则匹配中...', true);
    const matchResp = await sendToContent('matchFields', { detectResult: detectedData, profile });
    if (!matchResp?.success) throw new Error(matchResp?.error || '匹配失败');

    const { matched, unmatched } = matchResp.data;
    const resumeFile = await getResumeFile();

    allMappings = matched.map(m => ({
      ...m, source: 'regex',
      ...(m.isFile && resumeFile ? { fileData: resumeFile } : {}),
    }));

    let aiMeta = null;

    // 阶段 2: AI 匹配
    const aiCandidates = unmatched.filter(u => u.field.type !== 'file');
    if (aiCandidates.length > 0 && settings.aiEnabled && (providerPreset.noApiKey || settings.apiKey)) {
      setDetectInfo(`AI 匹配剩余 ${aiCandidates.length} 个字段...`, true);
      const port = chrome.runtime.connect({ name: 'keepalive' });
      try {
        const aiResp = await chrome.runtime.sendMessage({
          action: 'aiFieldMapping',
          payload: { unmatchedFields: aiCandidates.map(u => u.field), profile },
        });
        if (aiResp?.success && aiResp.data?.fieldMappings?.length > 0) {
          aiMeta = { model: aiResp.data.model, usage: aiResp.data.usage };
          for (const mapping of aiResp.data.fieldMappings) {
            if (!mapping.suggestedValue) continue;
            const u = aiCandidates.find(x => x.field.id === mapping.fieldId);
            if (u) allMappings.push({
              field: u.field, formId: u.formId,
              value: mapping.suggestedValue, isFile: false,
              source: 'ai', confidence: mapping.confidence ?? 1,
            });
          }
        } else if (aiResp?.aiError) {
          showToast(`AI：${aiResp.aiError}`, '');
        }
      } finally {
        port.disconnect();
      }
    }

    // 阶段 3: 填写（按帧路由，支持跨域 iframe）
    setDetectInfo('填写表单...', true);
    const [fillTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fillResp = await chrome.runtime.sendMessage({
      action: 'fillAllFrames',
      payload: { tabId: fillTab.id, allMappings },
    });
    if (!fillResp?.success) throw new Error(fillResp?.error || '填写失败');

    const { results, summary } = fillResp.data;
    const enriched = results.map(r => {
      const m = allMappings.find(x => x.field.id === r.fieldId);
      return { ...r, label: m?.field?.label || r.fieldId, value: m?.value || '',
               source: m?.source || 'unknown', confidence: m?.confidence };
    });

    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData.totalFields}</strong> 个表单字段`);
    await renderResults(enriched, summary, aiMeta, settings.confidenceThreshold);
    showToast(`填写完成：${summary.filled} 个成功`, 'success');

    // 保存历史（含 leanMappings 以便回填）
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({
      action: 'saveHistory',
      payload: {
        url: tab?.url || '', title: tab?.title || '',
        fieldsCount: summary.total, successCount: summary.filled,
        failCount: summary.errors,
        aiCount: enriched.filter(r => r.source === 'ai' && r.status === 'filled').length,
        leanMappings: allMappings
          .filter(m => m.value && !m.isFile)
          .map(({ field, value, source, confidence }) => ({ field, value, source, confidence })),
      },
    });
  } catch (e) {
    setDetectInfo(`检测到 <strong style="color:#2563eb">${detectedData?.totalFields ?? 0}</strong> 个表单字段`);
    showToast(`填写出错：${e.message}`, 'error');
  } finally {
    fillInProgress = false;
    btnFillMain.disabled = false;
    btnFillMain.textContent = '一键填写';
  }
});

async function renderResults(results, summary, aiMeta, confidenceThreshold = 0.7) {
  fillResults.style.display = 'block';
  fillPreview.style.display = 'none';
  emptyHint.style.display   = 'none';

  const aiCount = results.filter(r => r.source === 'ai' && r.status === 'filled').length;
  let txt = `已填写 <strong>${summary.filled}</strong> 个 · 跳过 ${summary.skipped} 个`;
  if (summary.errors > 0) txt += ` · <span style="color:var(--red)">${summary.errors} 失败</span>`;
  if (aiCount > 0)        txt += ` · 🤖 AI ${aiCount} 个`;
  if (aiMeta?.usage) {
    const t = (aiMeta.usage.promptTokens ?? 0) + (aiMeta.usage.completionTokens ?? 0);
    txt += ` <span style="color:var(--gray-400);font-size:11px">(${aiMeta.model}, ${t}t)</span>`;
  }
  resultsSummary.innerHTML = txt;
  resultsList.innerHTML    = '';

  for (const r of results) {
    const isLow = r.source === 'ai' && r.status === 'filled' && (r.confidence ?? 1) < confidenceThreshold;
    let css = r.status, icon = '', badge = '';

    if (r.status === 'filled') {
      const pct = Math.round((r.confidence ?? 1) * 100);
      if (r.source === 'ai') {
        css = isLow ? 'ai-low' : 'ai';
        icon  = isLow ? '⚠️' : '🤖';
        badge = `<span class="badge badge-${isLow ? 'yellow' : 'blue'}">AI ${pct}%</span>`;
      } else {
        css = 'filled'; icon = '✅';
        badge = '<span class="badge badge-green">正则</span>';
      }
    } else if (r.status === 'skipped') {
      icon = '⏭️'; badge = '<span class="badge badge-gray">跳过</span>';
    } else {
      icon = '❌'; badge = '<span class="badge badge-red">失败</span>';
    }

    const editBtn = isLow
      ? `<button class="btn-edit" data-field-id="${r.fieldId}">编辑</button>`
      : '';

    const li = document.createElement('li');
    li.className = `result-item ${css}`;
    li.dataset.fieldId = r.fieldId;
    li.innerHTML = `
      <span class="result-icon">${icon}</span>
      <div class="result-body">
        <div class="result-top">
          <span class="result-label">${escapeHtml(r.label || r.fieldId)}</span>
          ${badge}${editBtn}
        </div>
        <span class="result-value">${escapeHtml(r.value || r.message || '—')}</span>
      </div>`;
    resultsList.appendChild(li);
  }
}

// 点击结果列表：高亮 or 编辑
resultsList.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.btn-edit');
  if (editBtn) { e.stopPropagation(); openInlineEdit(editBtn.dataset.fieldId); return; }

  const li = e.target.closest('.result-item[data-field-id]');
  if (li) {
    const m = allMappings.find(x => x.field.id === li.dataset.fieldId);
    if (m?.field) {
      const fid = m.field.frameId ?? 0;
      chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
        if (t) chrome.tabs.sendMessage(t.id, { action: 'highlightField', field: m.field }, { frameId: fid }).catch(() => {});
      });
    }
  }
});

function openInlineEdit(fieldId) {
  document.querySelectorAll('.edit-inline').forEach(el => el.remove());
  document.querySelectorAll('.btn-edit').forEach(b => b.style.display = '');

  const li = resultsList.querySelector(`[data-field-id="${fieldId}"]`);
  if (!li) return;
  const entry = allMappings.find(m => m.field.id === fieldId);
  const editBtn = li.querySelector('.btn-edit');
  if (editBtn) editBtn.style.display = 'none';

  const box = document.createElement('div');
  box.className = 'edit-inline';
  box.innerHTML = `<textarea>${escapeHtml(entry?.value || '')}</textarea>
    <div class="edit-inline-actions">
      <button class="btn-apply">填入</button>
      <button class="btn-cancel-edit">取消</button>
    </div>`;

  li.querySelector('.result-body').appendChild(box);
  box.querySelector('textarea').focus();

  box.querySelector('.btn-cancel-edit').addEventListener('click', () => {
    box.remove(); if (editBtn) editBtn.style.display = '';
  });

  box.querySelector('.btn-apply').addEventListener('click', async () => {
    const val = box.querySelector('textarea').value.trim();
    if (!val) return;
    if (entry) { entry.value = val; entry.confidence = 1; }
    try {
      const resp = await sendToContent('refillField', { field: entry.field, value: val });
      if (resp?.success && resp.data?.status === 'filled') {
        li.querySelector('.result-value').textContent = val;
        const badgeEl = li.querySelector('.badge');
        if (badgeEl) { badgeEl.className = 'badge badge-green'; badgeEl.textContent = '已修改'; }
        li.className = 'result-item filled';
        li.querySelector('.result-icon').textContent = '✅';
        showToast('已重新填入', 'success');
      } else {
        showToast('填入失败', 'error');
      }
    } catch (err) { showToast(err.message, 'error'); }
    box.remove(); if (editBtn) editBtn.style.display = '';
  });
}

btnRefill.addEventListener('click', async () => {
  fillResults.style.display = 'none';
  allMappings = [];
  await showFillPreview();
});

document.getElementById('btnDetect').addEventListener('click', detectForms);

// ════════════════════════════════════════════════════════════
// TAB 2: 资料（Module C 多模板 + Module B PDF 导入）
// ════════════════════════════════════════════════════════════

const profileSelect = document.getElementById('profileSelect');
const profileForm   = document.getElementById('profileForm');

// ── Module C: 模板管理 ──────────────────────────────────────

async function loadProfiles() {
  profilesData    = await getProfiles() || {};
  activeProfileId = await getActiveProfileId();

  // 渲染下拉选项
  profileSelect.innerHTML = Object.entries(profilesData)
    .map(([id, p]) => `<option value="${id}"${id === activeProfileId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  // 填入当前激活资料
  const profile = profilesData[activeProfileId]?.data;
  if (profile) profileToForm(profile);
}

profileSelect.addEventListener('change', async () => {
  const newId = profileSelect.value;
  if (newId === activeProfileId) return;
  await setActiveProfile(newId);
  activeProfileId = newId;
  profileToForm(profilesData[newId]?.data || {});
  showToast(`已切换到「${profilesData[newId]?.name}」`, 'success');
  if (detectedData) showFillPreview();
});

document.getElementById('btnNewProfile').addEventListener('click', async () => {
  const name = prompt('请输入新模板名称：', '新简历');
  if (!name?.trim()) return;
  const id = await createProfile(name.trim());
  profilesData = await getProfiles();
  activeProfileId = id;
  await loadProfiles();
  showToast(`已创建「${name.trim()}」`, 'success');
});

document.getElementById('btnDuplicateProfile').addEventListener('click', async () => {
  const src  = profilesData[activeProfileId];
  const name = prompt('新模板名称：', `${src?.name || '简历'} 副本`);
  if (!name?.trim()) return;
  // 先保存当前表单到当前模板
  profilesData[activeProfileId].data = formToProfile();
  await saveActiveProfileData(profilesData[activeProfileId].data);
  const id = await duplicateProfile(activeProfileId, name.trim());
  profilesData = await getProfiles();
  activeProfileId = id;
  await loadProfiles();
  showToast(`已复制为「${name.trim()}」`, 'success');
});

document.getElementById('btnDeleteProfile').addEventListener('click', async () => {
  const name = profilesData[activeProfileId]?.name || '此模板';
  if (!confirm(`确认删除「${name}」？此操作不可撤销。`)) return;
  try {
    const newActive = await deleteProfile(activeProfileId);
    profilesData    = await getProfiles();
    activeProfileId = newActive;
    await loadProfiles();
    showToast('已删除', 'success');
  } catch (e) { showToast(e.message, 'error'); }
});

// ── 多条记录卡片 UI ───────────────────────────────────────────

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createEducationCard(entry = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  const degreeOptions = ['', '大专', '本科', '硕士', '博士']
    .map(v => `<option value="${v}"${entry.degree === v ? ' selected' : ''}>${v || '请选择'}</option>`)
    .join('');
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">✕</button>
      </div>
    </div>
    <div class="form-row"><label>学校</label>
      <input type="text" data-field="school" value="${escapeAttr(entry.school)}" placeholder="上海交通大学"></div>
    <div class="form-row two-col">
      <div><label>专业</label>
        <input type="text" data-field="major" value="${escapeAttr(entry.major)}" placeholder="计算机科学与技术"></div>
      <div><label>学历</label>
        <select data-field="degree">${degreeOptions}</select></div>
    </div>
    <div class="form-row two-col">
      <div><label>入学时间</label>
        <input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>毕业时间</label>
        <input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>GPA</label>
      <input type="text" data-field="gpa" value="${escapeAttr(entry.gpa)}" placeholder="3.8/4.0"></div>`;
  return card;
}

function createExperienceCard(entry = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">✕</button>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>公司名称</label>
        <input type="text" data-field="company" value="${escapeAttr(entry.company)}" placeholder="字节跳动"></div>
      <div><label>职位</label>
        <input type="text" data-field="title" value="${escapeAttr(entry.title)}" placeholder="后端开发实习生"></div>
    </div>
    <div class="form-row two-col">
      <div><label>开始时间</label>
        <input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>结束时间</label>
        <input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>工作描述</label>
      <textarea data-field="description" rows="3" placeholder="简要描述工作内容和成果...">${escapeHtml(entry.description || '')}</textarea></div>`;
  return card;
}

function createProjectCard(entry = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">✕</button>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>项目名称</label>
        <input type="text" data-field="name" value="${escapeAttr(entry.name)}" placeholder="智能投递助手"></div>
      <div><label>项目角色</label>
        <input type="text" data-field="role" value="${escapeAttr(entry.role)}" placeholder="负责人 / 后端开发"></div>
    </div>
    <div class="form-row two-col">
      <div><label>开始时间</label>
        <input type="month" data-field="startDate" value="${escapeAttr(entry.startDate)}"></div>
      <div><label>结束时间</label>
        <input type="month" data-field="endDate" value="${escapeAttr(entry.endDate)}"></div>
    </div>
    <div class="form-row"><label>项目描述</label>
      <textarea data-field="description" rows="3" placeholder="简要说明项目背景、职责和结果...">${escapeHtml(entry.description || '')}</textarea></div>`;
  return card;
}

function createAwardCard(entry = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">✕</button>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>奖项名称</label>
        <input type="text" data-field="name" value="${escapeAttr(entry.name)}" placeholder="国家奖学金"></div>
      <div><label>获奖年份</label>
        <input type="text" data-field="year" value="${escapeAttr(entry.year)}" placeholder="2024"></div>
    </div>
    <div class="form-row"><label>颁发单位</label>
      <input type="text" data-field="issuer" value="${escapeAttr(entry.issuer)}" placeholder="教育部 / 学校"></div>`;
  return card;
}

function createLanguageCard(entry = {}) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.innerHTML = `
    <div class="entry-card-header">
      <span class="entry-card-label"></span>
      <div class="entry-card-btns">
        <button type="button" class="btn-icon btn-card-up" title="上移">↑</button>
        <button type="button" class="btn-icon btn-card-down" title="下移">↓</button>
        <button type="button" class="btn-icon btn-icon-danger btn-card-del" title="删除">✕</button>
      </div>
    </div>
    <div class="form-row two-col">
      <div><label>语言</label>
        <input type="text" data-field="name" value="${escapeAttr(entry.name)}" placeholder="英语"></div>
      <div><label>水平</label>
        <input type="text" data-field="level" value="${escapeAttr(entry.level)}" placeholder="CET-6 / 流利"></div>
    </div>`;
  return card;
}

function renderCards(listId, entries, createFn, label) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  const items = (entries && entries.length > 0) ? entries : [{}];
  items.forEach(e => list.appendChild(createFn(e)));
  refreshCardHeaders(listId, label);
}

function refreshCardHeaders(listId, label) {
  const cards = [...document.getElementById(listId).querySelectorAll('.entry-card')];
  cards.forEach((card, i) => {
    card.querySelector('.entry-card-label').textContent = `${label} ${i + 1}`;
    card.querySelector('.btn-card-up').disabled   = i === 0;
    card.querySelector('.btn-card-down').disabled = i === cards.length - 1;
  });
}

function readCards(listId, fields) {
  return [...document.getElementById(listId).querySelectorAll('.entry-card')]
    .map(card => {
      const obj = {};
      for (const f of fields) {
        const el = card.querySelector(`[data-field="${f}"]`);
        obj[f] = el ? el.value.trim() : '';
      }
      return obj;
    })
    .filter(obj => Object.values(obj).some(v => v)); // 过滤全空条目
}

// 卡片操作事件委托
const CARD_LIST_LABELS = {
  educationList: '教育经历',
  experienceList: '工作经历',
  projectList: '项目经历',
  awardList: '奖项',
  languageList: '语言',
};

['educationList', 'experienceList', 'projectList', 'awardList', 'languageList'].forEach(listId => {
  const label = CARD_LIST_LABELS[listId];
  document.getElementById(listId).addEventListener('click', e => {
    const card  = e.target.closest('.entry-card');
    if (!card) return;
    const list  = document.getElementById(listId);
    const cards = [...list.querySelectorAll('.entry-card')];
    const idx   = cards.indexOf(card);

    if (e.target.closest('.btn-card-del')) {
      if (cards.length <= 1) { showToast('至少保留一条记录', 'error'); return; }
      card.remove();
      refreshCardHeaders(listId, label);
    } else if (e.target.closest('.btn-card-up') && idx > 0) {
      list.insertBefore(card, cards[idx - 1]);
      refreshCardHeaders(listId, label);
    } else if (e.target.closest('.btn-card-down') && idx < cards.length - 1) {
      list.insertBefore(cards[idx + 1], card);
      refreshCardHeaders(listId, label);
    }
  });
});

document.getElementById('btnAddEducation').addEventListener('click', () => {
  document.getElementById('educationList').appendChild(createEducationCard());
  refreshCardHeaders('educationList', '教育经历');
});

document.getElementById('btnAddExperience').addEventListener('click', () => {
  document.getElementById('experienceList').appendChild(createExperienceCard());
  refreshCardHeaders('experienceList', '工作经历');
});

document.getElementById('btnAddProject').addEventListener('click', () => {
  document.getElementById('projectList').appendChild(createProjectCard());
  refreshCardHeaders('projectList', '项目经历');
});

document.getElementById('btnAddAward').addEventListener('click', () => {
  document.getElementById('awardList').appendChild(createAwardCard());
  refreshCardHeaders('awardList', '奖项');
});

document.getElementById('btnAddLanguage').addEventListener('click', () => {
  document.getElementById('languageList').appendChild(createLanguageCard());
  refreshCardHeaders('languageList', '语言');
});

// ── 资料表单读写 ─────────────────────────────────────────────

function profileToForm(profile) {
  if (!profile) return;
  function set(name, value) {
    const el = profileForm.querySelector(`[name="${name}"]`);
    if (el && value != null) el.value = value;
  }
  set('name', profile.name);     set('firstName', profile.firstName); set('lastName', profile.lastName);
  set('gender', profile.gender); set('birthday', profile.birthday);
  set('ethnicity', profile.ethnicity); set('hometown', profile.hometown);
  set('politicalStatus', profile.politicalStatus); set('idNumber', profile.idNumber);
  set('graduationYear', profile.graduationYear); set('documentType', profile.documentType);
  set('phone', profile.phone); set('email', profile.email);
  set('address', profile.address); set('wechat', profile.wechat);
  if (profile.jobPreferences) {
    set('jobPreferences.expectedCity', profile.jobPreferences.expectedCity);
    set('jobPreferences.availableFrom', profile.jobPreferences.availableFrom);
    set('jobPreferences.expectedSalary', profile.jobPreferences.expectedSalary);
    set('jobPreferences.internshipDuration', profile.jobPreferences.internshipDuration);
  }

  // 教育背景：兼容旧版对象格式，统一转为数组
  const eduArr = Array.isArray(profile.education)
    ? profile.education
    : (profile.education ? [profile.education] : [{}]);
  renderCards('educationList', eduArr, createEducationCard, '教育经历');

  // 工作经历
  const expArr = Array.isArray(profile.experience) && profile.experience.length
    ? profile.experience : [{}];
  renderCards('experienceList', expArr, createExperienceCard, '工作经历');

  const projectArr = Array.isArray(profile.projects) && profile.projects.length
    ? profile.projects : [{}];
  renderCards('projectList', projectArr, createProjectCard, '项目经历');

  const awardArr = Array.isArray(profile.awards) && profile.awards.length
    ? profile.awards : [{}];
  renderCards('awardList', awardArr, createAwardCard, '奖项');

  const languageArr = Array.isArray(profile.languages) && profile.languages.length
    ? profile.languages : [{}];
  renderCards('languageList', languageArr, createLanguageCard, '语言');

  set('skills', Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || ''));
  if (profile.links) {
    set('links.github', profile.links.github);
    set('links.linkedin', profile.links.linkedin);
    set('links.website', profile.links.website);
  }
  set('selfIntro', profile.selfIntro);
}

function formToProfile() {
  function get(name) {
    const el = profileForm.querySelector(`[name="${name}"]`);
    return el ? el.value.trim() : '';
  }
  const skillsRaw = get('skills');
  const eduFields = ['school', 'major', 'degree', 'startDate', 'endDate', 'gpa'];
  const expFields = ['company', 'title', 'startDate', 'endDate', 'description'];
  const projectFields = ['name', 'role', 'startDate', 'endDate', 'description'];
  const awardFields = ['name', 'issuer', 'year'];
  const languageFields = ['name', 'level'];
  return {
    name: get('name'), firstName: get('firstName'), lastName: get('lastName'),
    gender: get('gender'), birthday: get('birthday'),
    graduationYear: get('graduationYear'),
    ethnicity: get('ethnicity'), hometown: get('hometown'),
    politicalStatus: get('politicalStatus'), idNumber: get('idNumber'),
    documentType: get('documentType'),
    phone: get('phone'), email: get('email'),
    address: get('address'), wechat: get('wechat'),
    jobPreferences: {
      expectedCity: get('jobPreferences.expectedCity'),
      availableFrom: get('jobPreferences.availableFrom'),
      expectedSalary: get('jobPreferences.expectedSalary'),
      internshipDuration: get('jobPreferences.internshipDuration'),
    },
    education:  readCards('educationList', eduFields),
    experience: readCards('experienceList', expFields),
    projects: readCards('projectList', projectFields),
    awards: readCards('awardList', awardFields),
    languages: readCards('languageList', languageFields),
    skills: skillsRaw ? skillsRaw.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [],
    links: {
      github: get('links.github'),
      linkedin: get('links.linkedin'),
      website: get('links.website'),
    },
    selfIntro: get('selfIntro'),
  };
}

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = formToProfile();
  profilesData[activeProfileId].data = data;
  await saveActiveProfileData(data);
  showToast('资料已保存', 'success');
  if (detectedData) showFillPreview();
});

document.getElementById('btnImportProfile').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const profile = JSON.parse(await file.text());
    profileToForm(profile);
    profilesData[activeProfileId].data = profile;
    await saveActiveProfileData(profile);
    showToast('导入成功', 'success');
  } catch (_) { showToast('导入失败：JSON 格式错误', 'error'); }
  e.target.value = '';
});

document.getElementById('btnExportProfile').addEventListener('click', async () => {
  const profile = profilesData[activeProfileId]?.data;
  if (!profile) { showToast('没有可导出的资料', 'error'); return; }
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `jobpilot-${profilesData[activeProfileId]?.name || 'profile'}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('resumeFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await saveResumeFile(file);
    document.getElementById('resumeCurrent').textContent = `已上传：${file.name}`;
    showToast('简历上传成功', 'success');
  } catch (_) { showToast('简历上传失败', 'error'); }
  e.target.value = '';
});

// ── Module B: PDF 导入 ───────────────────────────────────────

let _pdfFile = null; // 当前选中的 PDF 文件

document.getElementById('btnPdfImport').addEventListener('click', () => {
  document.getElementById('pdfFileInput').click();
});

document.getElementById('pdfFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  _pdfFile = file;
  document.getElementById('pdfFilename').textContent = `文件：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  document.getElementById('pdfAiFallbackHint').style.display = 'none';
  showPdfStep('mode');
  document.getElementById('pdfOverlay').style.display = 'flex';
  e.target.value = '';
});

document.getElementById('pdfModalClose').addEventListener('click', closePdfModal);
document.getElementById('pdfOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('pdfOverlay')) closePdfModal();
});

function closePdfModal() {
  document.getElementById('pdfOverlay').style.display = 'none';
}

function showPdfStep(step) {
  ['mode', 'loading', 'preview'].forEach(s => {
    document.getElementById(`pdfStep${s.charAt(0).toUpperCase() + s.slice(1)}`).style.display =
      s === step ? 'block' : 'none';
  });
}

// 本地解析
document.getElementById('btnLocalParse').addEventListener('click', async () => {
  if (!_pdfFile) return;
  showPdfStep('loading');
  document.getElementById('pdfLoadingText').textContent = '正在提取文本并解析...';

  try {
    const pdfjsLib = await loadPdfJs();
    const content  = await extractPdfContent(_pdfFile, pdfjsLib);
    const parsed   = parseLocalRegex(content.text, { links: content.links });
    showPdfPreview(parsed, '本地快速解析结果');
  } catch (e) {
    closePdfModal();
    showToast(`解析失败：${e.message}`, 'error');
  }
});

// AI 解析
document.getElementById('btnAIParse').addEventListener('click', async () => {
  if (!_pdfFile) return;

  const settings = await getSettings();
  const providerPreset = PROVIDER_PRESETS[settings.provider] || PROVIDER_PRESETS.deepseek;
  if ((!providerPreset.noApiKey && !settings.apiKey) || !settings.aiEnabled) {
    showToast('请先在「设置」中配置 AI API Key', 'error');
    return;
  }

  showPdfStep('loading');
  document.getElementById('pdfLoadingText').textContent = '正在提取 PDF 文本...';

  try {
    const pdfjsLib = await loadPdfJs();
    const text     = await extractPdfText(_pdfFile, pdfjsLib);

    document.getElementById('pdfLoadingText').textContent = '正在用 AI 解析简历，可能需要 30 秒...';
    const messages  = buildAiParsePrompt(text);
    const provider  = new AIProvider(settings);
    const { json }  = await provider.completeJSON(messages, { timeout: 60000 });

    // 规范化 skills 为数组
    if (typeof json.skills === 'string') {
      json.skills = json.skills.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    }
    showPdfPreview(json, 'AI 智能解析结果');
  } catch (e) {
    // 退回模式选择页，提示用户可改用本地解析
    showPdfStep('mode');
    const hint = document.getElementById('pdfAiFallbackHint');
    hint.textContent = e.message.includes('超时')
      ? 'AI 解析超时，可尝试「本地快速解析」'
      : `AI 解析失败：${e.message}。可尝试「本地快速解析」`;
    hint.style.display = 'block';
  }
});

// 渲染预览对比
function showPdfPreview(parsed, title) {
  document.getElementById('pdfModalTitle').textContent = title;
  const current = profilesData[activeProfileId]?.data || {};
  const list    = document.getElementById('pdfPreviewList');
  list.innerHTML = '';

  for (const field of PROFILE_DISPLAY_FIELDS) {
    const parsedVal  = getFieldValue(parsed,  field.path);
    const currentVal = getFieldValue(current, field.path);
    if (!parsedVal) continue; // 未解析出值的字段不显示

    const hasChange = parsedVal !== String(currentVal || '');
    const row       = document.createElement('div');
    row.className   = `pdf-field-row ${hasChange ? 'has-value' : 'no-value'}`;
    row.dataset.key = field.key;
    row.dataset.path = field.path;
    row.dataset.val  = parsedVal;

    row.innerHTML = `
      <input type="checkbox" ${hasChange ? 'checked' : ''} id="pdf_${field.key}">
      <div class="pdf-field-info">
        <div class="pdf-field-label">${escapeHtml(field.label)}</div>
        <div class="pdf-field-values">
          ${currentVal ? `<span class="pdf-current-val" title="${escapeHtml(String(currentVal))}">${escapeHtml(String(currentVal).slice(0, 20))}</span>
          <span class="pdf-arrow">→</span>` : ''}
          <span class="pdf-new-val" title="${escapeHtml(parsedVal)}">${escapeHtml(parsedVal.slice(0, 30))}</span>
        </div>
      </div>`;
    list.appendChild(row);
  }

  if (!list.children.length) {
    list.innerHTML = '<p style="color:var(--gray-400);font-size:13px;padding:16px 0">未能从该 PDF 中提取到有效信息</p>';
  }

  showPdfStep('preview');
}

document.getElementById('btnSelectAll').addEventListener('click', () => {
  document.querySelectorAll('#pdfPreviewList input[type="checkbox"]').forEach(c => c.checked = true);
});
document.getElementById('btnDeselectAll').addEventListener('click', () => {
  document.querySelectorAll('#pdfPreviewList input[type="checkbox"]').forEach(c => c.checked = false);
});

document.getElementById('btnConfirmImport').addEventListener('click', async () => {
  const rows    = document.querySelectorAll('#pdfPreviewList .pdf-field-row');
  const current = JSON.parse(JSON.stringify(profilesData[activeProfileId]?.data || {}));
  let count = 0;

  rows.forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb?.checked) return;
    setFieldValue(current, row.dataset.path, row.dataset.val);
    count++;
  });

  if (!count) { showToast('未选择任何字段', 'error'); return; }

  profilesData[activeProfileId].data = current;
  await saveActiveProfileData(current);
  profileToForm(current);
  closePdfModal();
  showToast(`已导入 ${count} 个字段`, 'success');
  if (detectedData) showFillPreview();
});

// ════════════════════════════════════════════════════════════
// TAB 3: 设置（Module A 多 API）
// ════════════════════════════════════════════════════════════

const settingsForm    = document.getElementById('settingsForm');
const providerSelect  = document.getElementById('providerSelect');
const modelSelect     = document.getElementById('modelSelect');
const apiKeyInput     = document.getElementById('apiKeyInput');
const btnToggleKey    = document.getElementById('btnToggleKey');
const confidenceSlider= document.getElementById('confidenceThreshold');
const thresholdValue  = document.getElementById('thresholdValue');
const apiKeyRow       = document.getElementById('apiKeyRow');
const ollamaHint      = document.getElementById('ollamaHint');
const testResultEl    = document.getElementById('testResult');

function updateProviderUI(provider) {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;

  // Ollama 不需要 API Key
  apiKeyRow.style.display  = preset.noApiKey ? 'none'  : '';
  ollamaHint.style.display = preset.noApiKey ? 'block' : 'none';

  // 更新模型列表
  const current = modelSelect.value;
  modelSelect.innerHTML = preset.models
    .map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${m}</option>`)
    .join('');
}

providerSelect.addEventListener('change', () => updateProviderUI(providerSelect.value));
confidenceSlider.addEventListener('input', () => {
  thresholdValue.textContent = parseFloat(confidenceSlider.value).toFixed(2);
});
btnToggleKey.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  btnToggleKey.textContent = apiKeyInput.type === 'password' ? '显示' : '隐藏';
});

// 测试连接
document.getElementById('btnTestConn').addEventListener('click', async () => {
  const provider = providerSelect.value;
  const apiKey   = apiKeyInput.value.trim();
  const model    = modelSelect.value;

  const btn = document.getElementById('btnTestConn');
  btn.disabled = true;
  testResultEl.className = 'test-result';
  testResultEl.textContent = '测试中...';

  try {
    const preset = PROVIDER_PRESETS[provider];

    if (provider === 'ollama') {
      const running = await checkOllamaRunning();
      if (!running) throw new Error('Ollama 未运行，请执行 ollama serve');
    } else if (!apiKey) {
      throw new Error('API Key 不能为空');
    }

    const ai = new AIProvider({ provider, apiKey, model, temperature: 0.1 });
    const { content } = await ai.complete([
      { role: 'user', content: '请只回复"OK"两个字。' }
    ]);
    testResultEl.className = 'test-result ok';
    testResultEl.textContent = `连接成功！回复：${content.slice(0, 40)}`;
  } catch (e) {
    testResultEl.className = 'test-result err';
    testResultEl.textContent = `失败：${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
    provider:            providerSelect.value,
    apiKey:              apiKeyInput.value.trim(),
    model:               modelSelect.value,
    aiEnabled:           document.getElementById('aiEnabled').checked,
    confidenceThreshold: parseFloat(confidenceSlider.value),
  });
  showToast('设置已保存', 'success');
  if (detectedData) showFillPreview();
});

async function renderHistory() {
  const list    = document.getElementById('historyList');
  const history = await getHistory();
  if (!history.length) { list.innerHTML = '<p class="history-empty">暂无记录</p>'; return; }

  list.innerHTML = history.map((h, i) => {
    const d  = new Date(h.timestamp);
    const ts = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    let urlShort = h.url || '';
    try { urlShort = new URL(h.url).hostname + new URL(h.url).pathname; } catch (_) {}
    const replayBtn = h.leanMappings?.length > 0
      ? `<button class="btn-sm btn-replay-history" data-ts="${h.timestamp}" style="margin-left:auto;flex-shrink:0">↺ 回填</button>`
      : '';
    return `<div class="history-item">
      <div class="history-item-url" title="${escapeHtml(h.url||'')}">${escapeHtml(urlShort)}</div>
      <div class="history-item-meta">
        <span style="color:var(--gray-400)">${ts}</span>
        <span class="history-stat ok">✅ ${h.successCount}</span>
        ${h.failCount > 0 ? `<span class="history-stat err">❌ ${h.failCount}</span>` : ''}
        ${h.aiCount  > 0 ? `<span class="history-stat">🤖 ${h.aiCount}</span>`       : ''}
        ${replayBtn}
      </div>
    </div>`;
  }).join('');
}

document.getElementById('btnClearHistory').addEventListener('click', async () => {
  await clearHistory();
  await renderHistory();
  showToast('历史已清除');
});

// ── 监听 content script 推送的表单更新（SPA 路由后自动重检） ────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'formsUpdated') return;
  if (fillInProgress || detectInProgress) return;
  detectForms();
});

// ── 历史记录回填 ──────────────────────────────────────────────
document.getElementById('historyList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-replay-history');
  if (!btn) return;

  const ts   = parseInt(btn.dataset.ts, 10);
  const hist = await getHistory();
  const entry = hist.find(h => h.timestamp === ts);
  if (!entry?.leanMappings?.length) { showToast('该记录无回填数据', ''); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // 跨域不阻止，但给出提示
  try {
    if (tab?.url && entry.url && new URL(tab.url).origin !== new URL(entry.url).origin) {
      showToast('当前域名与记录不符，回填可能失败', '');
    }
  } catch {}

  btn.disabled    = true;
  btn.textContent = '回填中...';
  try {
    const fillResp = await chrome.runtime.sendMessage({
      action:  'fillAllFrames',
      payload: { tabId: tab.id, allMappings: entry.leanMappings },
    });
    if (fillResp?.success) {
      const { filled, skipped } = fillResp.data.summary;
      showToast(`回填完成：${filled} 个成功，${skipped} 个跳过`, 'success');
      document.querySelector('[data-tab="fill"]').click();
    } else {
      showToast('回填失败', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '↺ 回填';
  }
});

// ════════════════════════════════════════════════════════════
// 初始化
// ════════════════════════════════════════════════════════════

(async () => {
  // 迁移旧版单一 profile → 多模板
  await migrateToMultiProfile();
  // 迁移旧版 education 对象 → 数组
  await migrateEducationToArray();

  // 加载多模板
  await loadProfiles();

  // 加载简历文件状态
  const rf = await getResumeFile();
  if (rf) document.getElementById('resumeCurrent').textContent = `已上传：${rf.name}`;

  // 如果第一次使用（空 profile），加载示例数据
  const profile = profilesData[activeProfileId]?.data;
  if (!profile || !Object.keys(profile).length) {
    try {
      const resp = await fetch(chrome.runtime.getURL('data/default-profile.json'));
      const defaultProfile = await resp.json();
      profileToForm(defaultProfile);
    } catch (_) {}
  }

  // 加载设置
  const s = await getSettings();
  providerSelect.value = s.provider || 'deepseek';
  updateProviderUI(s.provider || 'deepseek');
  // 设置保存的 model（updateProviderUI 后再设，确保 option 已生成）
  if (modelSelect.querySelector(`option[value="${s.model}"]`)) {
    modelSelect.value = s.model;
  }
  apiKeyInput.value = s.apiKey || '';
  document.getElementById('aiEnabled').checked = s.aiEnabled;
  confidenceSlider.value = s.confidenceThreshold;
  thresholdValue.textContent = s.confidenceThreshold.toFixed(2);

  // 检测当前页面表单
  detectForms();
})();
