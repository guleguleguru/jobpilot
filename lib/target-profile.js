import { normalizeTargetKey } from './profile-schema.js';

function trimText(value) {
  return String(value || '').trim();
}

function normalizeTargetProfileContext(jobContext = {}) {
  const company = trimText(jobContext.company);
  const role = trimText(jobContext.role);
  const notes = trimText(jobContext.notes);
  const label = [company, role].filter(Boolean).join(' / ');

  return {
    company,
    role,
    notes,
    label,
    targetKey: normalizeTargetKey(label),
  };
}

function hasTargetProfileContext(jobContext = {}) {
  const context = normalizeTargetProfileContext(jobContext);
  return Boolean(context.company || context.role);
}

function getTargetDraftDisplayLabel(jobContext = {}) {
  const context = normalizeTargetProfileContext(jobContext);
  return context.label || context.notes || '';
}

export {
  getTargetDraftDisplayLabel,
  hasTargetProfileContext,
  normalizeTargetProfileContext,
};
