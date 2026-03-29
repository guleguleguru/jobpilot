const enumMappingsModulePromise = import(chrome.runtime.getURL('lib/enum-mappings.js'));
const fillReportModulePromise = import(chrome.runtime.getURL('lib/fill-report.js'));

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set;

const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value'
)?.set;

function triggerEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function setInputValue(el, value) {
  el.focus();
  const setter = el.tagName === 'TEXTAREA' ? nativeTextareaSetter : nativeInputValueSetter;
  if (setter) setter.call(el, value);
  else el.value = value;
  triggerEvents(el);
}

function setNativeSelectValue(el, value) {
  for (const option of el.options) {
    if (option.value === value || option.text.trim() === value) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }

  const valueLower = String(value).toLowerCase();
  for (const option of el.options) {
    const optText = option.text.trim().toLowerCase();
    const optVal = option.value.toLowerCase();
    if (
      optText.includes(valueLower) ||
      valueLower.includes(optText) ||
      optVal.includes(valueLower) ||
      valueLower.includes(optVal)
    ) {
      el.value = option.value;
      triggerEvents(el);
      return true;
    }
  }
  return false;
}

function setNativeRadioValue(el, value, doc) {
  const radios = doc.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
  const valueLower = String(value).toLowerCase();
  for (const radio of radios) {
    const radioLabel = radio.value.toLowerCase();
    const labelText = (radio.labels?.[0]?.textContent || '').trim().toLowerCase();
    if (
      radio.value === value ||
      radioLabel.includes(valueLower) ||
      valueLower.includes(radioLabel) ||
      labelText.includes(valueLower) ||
      valueLower.includes(labelText)
    ) {
      radio.click();
      triggerEvents(radio);
      return true;
    }
  }
  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr.replace(/\//g, '-');
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`;
  if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  return dateStr;
}

function normalizeLocatorText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()（）\-_/\\,.;:：，。'"`~!@#$%^&*+=?|[\]{}<>]/g, ' ')
    .trim();
}

function buildLocatorNgrams(value = '') {
  const normalized = normalizeLocatorText(value).replace(/\s+/g, '');
  if (!normalized) return [];
  const result = [];
  for (let size = 2; size <= 3; size += 1) {
    if (normalized.length < size) continue;
    for (let i = 0; i <= normalized.length - size; i += 1) {
      result.push(normalized.slice(i, i + size));
    }
  }
  return [...new Set(result)];
}

function overlapRatio(left = [], right = []) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let hits = 0;
  for (const item of left) {
    if (rightSet.has(item)) hits += 1;
  }
  return hits / Math.max(left.length, 1);
}

function getControlFamily(type = 'text') {
  switch (type) {
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'choice';
    case 'radio':
    case 'checkbox':
      return 'check';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

function collectElementLocatorText(el) {
  const parts = [
    el.getAttribute?.('aria-label') || '',
    el.getAttribute?.('placeholder') || '',
    el.getAttribute?.('title') || '',
    el.getAttribute?.('name') || '',
    el.id || '',
  ];

  if (el.labels?.length) {
    parts.push(...Array.from(el.labels).map(label => label.textContent || ''));
  }

  const parent = el.parentElement;
  if (parent) {
    parts.push(parent.textContent || '');
    const prev = parent.previousElementSibling;
    if (prev) parts.push(prev.textContent || '');
  }

  return normalizeLocatorText(parts.filter(Boolean).join(' '));
}

function getLocatorCandidates(doc, field) {
  const family = getControlFamily(field.type);
  if (family === 'textarea') return Array.from(doc.querySelectorAll('textarea'));
  if (family === 'check') return Array.from(doc.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
  if (family === 'choice') {
    return Array.from(doc.querySelectorAll('select, input, [role="combobox"]'))
      .filter(el => el.tagName === 'SELECT' || el.getAttribute?.('role') === 'combobox' || el.closest?.('li'));
  }
  return Array.from(doc.querySelectorAll('input, textarea, select')).filter(el => {
    if (family === 'date') {
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    }
    if (el.tagName === 'SELECT') return false;
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    return !['radio', 'checkbox', 'file', 'hidden'].includes(type);
  });
}

function scoreElementForField(el, field) {
  const targetText = normalizeLocatorText([
    field.label,
    ...(field.labelCandidates || []),
    field.placeholder,
    field.name,
    field.title,
    field.sectionLabel,
    field.contextText,
  ].filter(Boolean).join(' '));
  if (!targetText) return -Infinity;

  const elText = collectElementLocatorText(el);
  if (!elText) return -Infinity;

  const targetNgrams = buildLocatorNgrams(targetText);
  const elNgrams = buildLocatorNgrams(elText);
  let score = overlapRatio(targetNgrams, elNgrams) * 5;

  const targetPlaceholder = normalizeLocatorText(field.placeholder);
  const elPlaceholder = normalizeLocatorText(el.getAttribute?.('placeholder') || '');
  if (targetPlaceholder && elPlaceholder) {
    if (targetPlaceholder === elPlaceholder) score += 4;
    else if (elPlaceholder.includes(targetPlaceholder) || targetPlaceholder.includes(elPlaceholder)) score += 2;
  }

  const targetLabel = normalizeLocatorText(field.label);
  if (targetLabel && elText.includes(targetLabel)) score += 3;

  const targetName = normalizeLocatorText(field.name);
  const elName = normalizeLocatorText(el.getAttribute?.('name') || el.id || '');
  if (targetName && elName) {
    if (targetName === elName) score += 4;
    else if (elName.includes(targetName) || targetName.includes(elName)) score += 1.5;
  }

  const targetSection = normalizeLocatorText(field.sectionLabel);
  const parentText = normalizeLocatorText(el.parentElement?.textContent || '');
  if (targetSection && parentText.includes(targetSection)) score += 1.2;

  if (field.type === 'date') {
    const placeholder = normalizeLocatorText(el.getAttribute?.('placeholder') || '');
    if (/(日期|时间|date|time|选择)/.test(placeholder)) score += 1.5;
  }

  return score;
}

function locateElementByHeuristics(field, doc) {
  const candidates = getLocatorCandidates(doc, field)
    .map(el => ({ el, score: scoreElementForField(el, field) }))
    .filter(item => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || best.score < 4.8) return null;
  const runnerUp = candidates[1];
  if (runnerUp && best.score - runnerUp.score < 0.6) return null;
  return best.el;
}

function locateElement(field, doc) {
  if (field.selector) {
    try {
      const el = doc.querySelector(field.selector);
      if (el) return el;
    } catch (_) {}
  }
  if (field.xpath) {
    try {
      const r = doc.evaluate(field.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (r.singleNodeValue) return r.singleNodeValue;
    } catch (_) {}
  }
  if (field.name) {
    const el = doc.querySelector(`[name="${CSS.escape(field.name)}"]`);
    if (el) return el;
  }
  return locateElementByHeuristics(field, doc);
}

function parseRepeatPath(key = '') {
  const match = key.match(/^([a-zA-Z]+)\[(\d+)\]\./);
  if (!match) return null;
  return {
    section: match[1],
    index: Number(match[2]),
  };
}

function getFieldKey(entry) {
  return entry.key || entry.field?.normalizedKey || '';
}

function hasMeaningfulFields(entry = {}) {
  return Object.values(entry || {}).some(value => value !== '' && value != null);
}

function getRepeatTargets(profile = {}) {
  return ['languages', 'familyMembers']
    .map(section => ({
      section,
      items: Array.isArray(profile[section]) ? profile[section].filter(hasMeaningfulFields) : [],
    }))
    .filter(item => item.items.length);
}

function getResultDocument(field) {
  let doc = document;
  if (field?.source === 'iframe' && field?.iframePath) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src === field.iframePath) {
        try {
          doc = iframe.contentDocument || iframe.contentWindow?.document || document;
        } catch (_) {}
        break;
      }
    }
  }
  return doc;
}

async function rerunMatch(profile) {
  const detectResult = window.__jobpilotDetectForms?.();
  if (!detectResult) return null;
  const matchResult = await window.__jobpilotMatchForms?.(detectResult, profile);
  if (!matchResult) return null;
  return { detectResult, matchResult };
}

function extractRepeatKeys(matchResult, sectionKey) {
  const keys = [];
  for (const entry of matchResult?.matched || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  for (const entry of matchResult?.unmatched || []) {
    if (entry.normalizedKey?.startsWith(`${sectionKey}[`)) keys.push(entry.normalizedKey);
  }
  for (const entry of matchResult?.diagnostics?.missingRequiredFields || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  for (const entry of matchResult?.diagnostics?.sensitiveFieldsSkipped || []) {
    if (entry.key?.startsWith(`${sectionKey}[`)) keys.push(entry.key);
  }
  return [...new Set(keys)];
}

function getRepeatCount(matchResult, sectionKey) {
  const indices = new Set();
  for (const key of extractRepeatKeys(matchResult, sectionKey)) {
    const parsed = parseRepeatPath(key);
    if (parsed) indices.add(parsed.index);
  }
  return indices.size;
}

function mergeMappings(baseMappings, repeatMappings) {
  const sectionsToReplace = new Set(
    repeatMappings
      .map(entry => parseRepeatPath(getFieldKey(entry))?.section)
      .filter(Boolean)
  );

  const next = baseMappings.filter(entry => {
    const parsed = parseRepeatPath(getFieldKey(entry));
    return !parsed || !sectionsToReplace.has(parsed.section);
  });

  const seenFieldIds = new Set(next.map(entry => entry.field?.id).filter(Boolean));
  for (const entry of repeatMappings) {
    if (seenFieldIds.has(entry.field?.id)) continue;
    seenFieldIds.add(entry.field?.id);
    next.push({ ...entry, source: entry.source || 'regex' });
  }

  return next;
}

async function ensureRepeatableSections(profile, adapter, report, reportUtils) {
  if (!profile || !adapter) {
    return { latestMatch: null, repeatSupport: {} };
  }

  const repeatTargets = getRepeatTargets(profile);
  if (!repeatTargets.length) {
    return { latestMatch: null, repeatSupport: {} };
  }

  let latest = await rerunMatch(profile);
  const repeatSupport = {};

  for (const target of repeatTargets) {
    const sectionReport = {
      section: target.section,
      expected: target.items.length,
      existing: getRepeatCount(latest?.matchResult, target.section),
      created: 0,
      filled: 0,
      warnings: [],
    };

    let currentCount = sectionReport.existing;
    let guard = 0;
    while (currentCount < target.items.length && guard < target.items.length + 2) {
      const outcome = await adapter.ensureRepeatItem(target.section, currentCount, {
        profile,
        currentCount,
        desiredCount: target.items.length,
        detectResult: latest?.detectResult,
        matchResult: latest?.matchResult,
        document,
        location,
      });

      if (!outcome?.created) {
        sectionReport.warnings.push(
          outcome?.reason
            ? `${target.section}: ${outcome.reason}`
            : `${target.section}: unable_to_create_repeat_item`
        );
        break;
      }

      sectionReport.created += 1;
      latest = await rerunMatch(profile);
      const nextCount = getRepeatCount(latest?.matchResult, target.section);
      if (nextCount <= currentCount) {
        sectionReport.warnings.push(`${target.section}: repeat_item_created_but_not_detected`);
        break;
      }
      currentCount = nextCount;
      guard += 1;
    }

    repeatSupport[target.section] = currentCount >= target.items.length;
    reportUtils.upsertRepeatSection(report, sectionReport);
  }

  if (latest?.matchResult?.diagnostics) {
    reportUtils.mergeDiagnosticsIntoReport(report, latest.matchResult.diagnostics);
  }

  return { latestMatch: latest, repeatSupport };
}

async function normalizeRuntimeValue(fieldEntry, adapter) {
  const field = fieldEntry.field;
  const rawValue = fieldEntry.rawValue ?? fieldEntry.value;
  if (rawValue == null || rawValue === '') {
    return { ok: false, reason: 'empty_value' };
  }

  if (!['select', 'radio', 'checkbox'].includes(field.type) || !field.options?.length) {
    return { ok: true, value: String(fieldEntry.value ?? rawValue), rawValue: String(rawValue) };
  }

  const directOption = field.options.find(option => option.value === String(fieldEntry.value));
  if (directOption) {
    return {
      ok: true,
      value: String(directOption.value),
      rawValue: String(rawValue),
    };
  }

  const enumMappings = await enumMappingsModulePromise;
  const adapterOverride = adapter?.mapEnumValue?.(getFieldKey(fieldEntry), String(rawValue), {
    field,
    options: field.options,
    location,
    document,
  }) || null;

  const mapped = enumMappings.mapEnumValue({
    fieldKey: getFieldKey(fieldEntry),
    value: String(rawValue),
    options: field.options,
    adapterOverride,
  });

  if (!mapped.matched) {
    return { ok: false, reason: 'unmapped_value', rawValue: String(rawValue) };
  }

  return {
    ok: true,
    value: String(mapped.mappedValue),
    rawValue: String(rawValue),
  };
}

async function fillField(fieldEntry, doc, context) {
  const { field } = fieldEntry;
  const { adapter, report } = context;

  if (!fieldEntry.value && !fieldEntry.isFile) {
    return { fieldId: field.id, status: 'skipped', message: 'empty_value', key: getFieldKey(fieldEntry) };
  }

  const el = locateElement(field, doc);
  if (!el) {
    report.warnings.push(`element_not_found:${field.id}`);
    return { fieldId: field.id, status: 'error', message: 'element_not_found', key: getFieldKey(fieldEntry) };
  }

  const runtimeValue = await normalizeRuntimeValue(fieldEntry, adapter);
  if (!runtimeValue.ok && !fieldEntry.isFile) {
    report.unmappedValues.push({
      fieldId: field.id,
      label: field.label || field.name || field.id,
      key: getFieldKey(fieldEntry),
      value: runtimeValue.rawValue || String(fieldEntry.value || ''),
      options: (field.options || []).slice(0, 12),
      required: Boolean(field.required),
    });
    return { fieldId: field.id, status: 'skipped', message: runtimeValue.reason, key: getFieldKey(fieldEntry) };
  }

  const value = runtimeValue.value;
  const utils = {
    setInputValue,
    setNativeRadioValue,
    setNativeSelectValue,
    triggerEvents,
  };

  try {
    if (field.type === 'select') {
      const adapterHandled = adapter?.setSelectValue?.({ element: el, field, value, context, utils });
      const ok = adapterHandled == null ? setNativeSelectValue(el, value) : (adapterHandled || setNativeSelectValue(el, value));
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : 'no_matching_option', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'radio') {
      const adapterHandled = adapter?.setRadioValue?.({ element: el, field, value, context, utils });
      const ok = adapterHandled == null ? setNativeRadioValue(el, value, doc) : (adapterHandled || setNativeRadioValue(el, value, doc));
      return { fieldId: field.id, status: ok ? 'filled' : 'skipped', message: ok ? '' : 'no_matching_option', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'checkbox') {
      const shouldCheck = /true|yes|是|1/i.test(value);
      if (el.checked !== shouldCheck) el.click();
      triggerEvents(el);
      return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'date') {
      const adapterHandled = adapter?.setDateValue?.({ element: el, field, value: formatDate(value), context, utils });
      if (adapterHandled == null || adapterHandled === false) setInputValue(el, formatDate(value));
      return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
    }

    if (field.type === 'file') {
      if (typeof window.__jobpilotUploadFile === 'function' && fieldEntry.fileData) {
        const result = window.__jobpilotUploadFile(el, fieldEntry.fileData);
        return {
          fieldId: field.id,
          status: result.success ? 'filled' : 'skipped',
          message: result.success ? `uploaded:${result.method}` : 'manual_resume_upload_required',
          key: getFieldKey(fieldEntry),
        };
      }
      return { fieldId: field.id, status: 'skipped', message: 'manual_resume_upload_required', key: getFieldKey(fieldEntry) };
    }

    setInputValue(el, value);
    return { fieldId: field.id, status: 'filled', message: '', key: getFieldKey(fieldEntry) };
  } catch (error) {
    report.warnings.push(`fill_error:${field.id}:${error.message}`);
    return { fieldId: field.id, status: 'error', message: error.message, key: getFieldKey(fieldEntry) };
  }
}

function applyFieldOutcomesToRepeatSections(report, results) {
  for (const section of report.repeatSections || []) {
    const indices = new Set();
    for (const result of results) {
      if (result.status !== 'filled') continue;
      const parsed = parseRepeatPath(result.key);
      if (parsed?.section === section.section) indices.add(parsed.index);
    }
    section.filled = indices.size;
  }
}

async function fillForms(mappings, options = {}) {
  const reportUtils = await fillReportModulePromise;
  const adapter = window.__jobpilotGetSiteAdapter?.({ document, location }) || null;
  const initialDetect = window.__jobpilotDetectForms?.();
  const report = reportUtils.createFillReport({
    hostname: location.hostname,
    pageTitle: document.title,
    adapterUsed: adapter?.id || 'generic',
    detectedCount: initialDetect?.totalFields || mappings.length,
  });

  reportUtils.mergeDiagnosticsIntoReport(report, options.diagnostics || {});
  const beforeFillMeta = await adapter?.beforeFill?.({ document, location, mappings, profile: options.profile });
  if (beforeFillMeta?.warnings?.length) report.warnings.push(...beforeFillMeta.warnings);

  const repeatResolution = await ensureRepeatableSections(options.profile, adapter, report, reportUtils);
  const repeatMappings = repeatResolution.latestMatch?.matchResult?.matched
    ?.filter(entry => {
      const parsed = parseRepeatPath(entry.key);
      return parsed && ['languages', 'familyMembers'].includes(parsed.section);
    })
    .map(entry => ({ ...entry, source: 'regex' })) || [];

  if (repeatResolution.latestMatch?.matchResult?.diagnostics) {
    reportUtils.mergeDiagnosticsIntoReport(report, repeatResolution.latestMatch.matchResult.diagnostics);
  }

  let effectiveMappings = repeatMappings.length ? mergeMappings(mappings, repeatMappings) : mappings.slice();
  effectiveMappings = effectiveMappings.map(entry => ({
    ...entry,
    profile: options.profile || null,
    fillDiagnostics: options.diagnostics || null,
  }));

  const results = [];
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of effectiveMappings) {
    const doc = getResultDocument(entry.field);
    const result = await fillField(entry, doc, { adapter, report });
    results.push(result);
    reportUtils.recordFieldOutcome(report, result);
    if (result.status === 'filled') filled += 1;
    else if (result.status === 'skipped') skipped += 1;
    else errors += 1;
  }

  applyFieldOutcomesToRepeatSections(report, results);

  const adapterHints = adapter?.getDiagnosticsHints?.({
    document,
    location,
    profile: options.profile,
    repeatSupport: repeatResolution.repeatSupport,
  }) || [];
  report.warnings.push(...adapterHints);

  const afterFillMeta = await adapter?.afterFill?.({ document, location, results, report });
  if (afterFillMeta?.warnings?.length) report.warnings.push(...afterFillMeta.warnings);

  return {
    results,
    summary: { filled, skipped, errors, total: effectiveMappings.length },
    report: reportUtils.finalizeFillReport(report),
  };
}

function highlightFieldEl(field) {
  const doc = getResultDocument(field);
  const el = locateElement(field, doc);
  if (!el) return false;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = { outline: el.style.outline, boxShadow: el.style.boxShadow, transition: el.style.transition };
  el.style.transition = 'all 0.2s';
  el.style.outline = '3px solid #2563eb';
  el.style.boxShadow = '0 0 0 6px rgba(37,99,235,0.2)';
  el.focus?.();
  setTimeout(() => {
    el.style.outline = prev.outline;
    el.style.boxShadow = prev.boxShadow;
  }, 2000);
  return true;
}

async function handleQuickFill() {
  const profileResp = await chrome.runtime.sendMessage({ action: 'getProfile' });
  if (!profileResp?.success || !profileResp.data) {
    showInPageToast('JobPilot：请先在侧边栏填写个人资料', '#ef4444');
    return { success: false };
  }
  const profile = profileResp.data;

  const detectResult = window.__jobpilotDetectForms?.();
  if (!detectResult || detectResult.totalFields === 0) {
    showInPageToast('JobPilot：当前页面未检测到表单', '#6b7280');
    return { success: false };
  }

  const matchResult = await window.__jobpilotMatchForms?.(detectResult, profile);
  const fillResult = await fillForms(
    (matchResult?.matched || []).map(entry => ({ ...entry, source: 'regex' })),
    { profile, diagnostics: matchResult?.diagnostics || {} }
  );

  const { filled, skipped } = fillResult.summary;
  showInPageToast(`JobPilot 填写完成：${filled} 个成功，${skipped} 个跳过`, '#16a34a');
  return { success: true, data: fillResult };
}

function showInPageToast(msg, bg = '#1f2937') {
  const id = '__jobpilot_quick_toast';
  document.getElementById(id)?.remove();
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
    `background:${bg}`, 'color:#fff', 'padding:11px 16px',
    'border-radius:10px', 'font:13px/1.5 system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'max-width:320px',
  ].join(';');
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message.action;

  if (action === 'fillForms') {
    (async () => {
      try {
        const result = await fillForms(message.mappings, {
          profile: message.profile,
          diagnostics: message.diagnostics,
        });
        sendResponse({ success: true, data: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (action === 'highlightField') {
    const ok = highlightFieldEl(message.field);
    sendResponse({ success: ok });
    return true;
  }

  if (action === 'refillField') {
    (async () => {
      try {
        const result = await fillField({ field: message.field, value: message.value }, document, {
          adapter: window.__jobpilotGetSiteAdapter?.({ document, location }) || null,
          report: (await fillReportModulePromise).createFillReport({
            hostname: location.hostname,
            pageTitle: document.title,
            adapterUsed: window.__jobpilotGetSiteAdapter?.({ document, location })?.id || 'generic',
          }),
        });
        sendResponse({ success: true, data: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (action === 'quickFill') {
    (async () => {
      try {
        const result = await handleQuickFill();
        sendResponse(result);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  return true;
});

window.__jobpilotFillForms = fillForms;
window.__jobpilotFillField = fillField;
