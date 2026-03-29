import { createEmptyProfile, normalizeProfile } from './profile-schema.js';

const KEYS = {
  PROFILE: 'userProfile',
  SETTINGS: 'settings',
  RESUME_FILE: 'resumeFile',
  HISTORY: 'fillHistory',
  LAST_FILL_REPORT: 'lastFillReport',
  PROFILES: 'profiles',
  ACTIVE_PROFILE: 'activeProfile',
};

const DEFAULT_SETTINGS = {
  aiEnabled: true,
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.1,
  confidenceThreshold: 0.7,
};

function normalizeProfilesMap(profiles) {
  if (!profiles || typeof profiles !== 'object') return null;
  const next = {};
  for (const [id, profile] of Object.entries(profiles)) {
    next[id] = {
      ...profile,
      data: normalizeProfile(profile?.data || {}),
    };
  }
  return next;
}

async function getProfiles() {
  const result = await chrome.storage.local.get(KEYS.PROFILES);
  const profiles = normalizeProfilesMap(result[KEYS.PROFILES]);
  return profiles;
}

async function getActiveProfileId() {
  const result = await chrome.storage.local.get(KEYS.ACTIVE_PROFILE);
  return result[KEYS.ACTIVE_PROFILE] || 'default';
}

async function getActiveProfileData() {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles) return null;
  return profiles[activeId]?.data ?? null;
}

async function saveProfiles(profiles) {
  await chrome.storage.local.set({ [KEYS.PROFILES]: normalizeProfilesMap(profiles) });
}

async function saveActiveProfileData(data) {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles || !profiles[activeId]) return;
  profiles[activeId].data = normalizeProfile(data);
  profiles[activeId].updatedAt = new Date().toISOString();
  await saveProfiles(profiles);
}

async function getProfile() {
  return getActiveProfileData();
}

async function saveProfile(data) {
  return saveActiveProfileData(data);
}

async function setActiveProfile(id) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[id]) throw new Error(`Profile ${id} does not exist`);
  await chrome.storage.local.set({ [KEYS.ACTIVE_PROFILE]: id });
}

async function createProfile(name, data = null) {
  const profiles = (await getProfiles()) || {};
  const id = `profile_${Date.now()}`;
  profiles[id] = {
    name,
    data: normalizeProfile(data || createEmptyProfile()),
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({
    [KEYS.PROFILES]: profiles,
    [KEYS.ACTIVE_PROFILE]: id,
  });
  return id;
}

async function duplicateProfile(sourceId, newName) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[sourceId]) throw new Error(`Profile ${sourceId} does not exist`);
  const id = `profile_${Date.now()}`;
  profiles[id] = {
    name: newName,
    data: normalizeProfile(JSON.parse(JSON.stringify(profiles[sourceId].data))),
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({
    [KEYS.PROFILES]: profiles,
    [KEYS.ACTIVE_PROFILE]: id,
  });
  return id;
}

async function deleteProfile(id) {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles || !profiles[id]) throw new Error(`Profile ${id} does not exist`);
  const remaining = Object.keys(profiles).filter(key => key !== id);
  if (!remaining.length) throw new Error('At least one profile must remain');

  delete profiles[id];

  await chrome.storage.local.set({
    [KEYS.PROFILES]: profiles,
    [KEYS.ACTIVE_PROFILE]: activeId === id ? remaining[0] : activeId,
  });
}

async function renameProfile(id, newName) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[id]) throw new Error(`Profile ${id} does not exist`);
  profiles[id].name = newName;
  await saveProfiles(profiles);
}

async function migrateEducationToArray() {
  const profiles = await getProfiles();
  if (!profiles) return;
  let changed = false;
  for (const profile of Object.values(profiles)) {
    if (profile?.data?.education && !Array.isArray(profile.data.education)) {
      profile.data = normalizeProfile(profile.data);
      changed = true;
    }
  }
  if (changed) await saveProfiles(profiles);
}

async function migrateToMultiProfile() {
  const data = await chrome.storage.local.get([KEYS.PROFILE, KEYS.PROFILES]);
  if (data[KEYS.PROFILES]) {
    await saveProfiles(data[KEYS.PROFILES]);
    return;
  }

  const defaultId = 'default';
  const oldProfile = data[KEYS.PROFILE] || createEmptyProfile();
  await chrome.storage.local.set({
    [KEYS.PROFILES]: {
      [defaultId]: {
        name: '默认资料',
        data: normalizeProfile(oldProfile),
        createdAt: new Date().toISOString(),
      },
    },
    [KEYS.ACTIVE_PROFILE]: defaultId,
  });

  if (data[KEYS.PROFILE]) {
    await chrome.storage.local.remove(KEYS.PROFILE);
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[KEYS.SETTINGS] || {}) };
}

async function saveSettings(settings) {
  const current = await getSettings();
  await chrome.storage.local.set({ [KEYS.SETTINGS]: { ...current, ...settings } });
}

async function getResumeFile() {
  const result = await chrome.storage.local.get(KEYS.RESUME_FILE);
  return result[KEYS.RESUME_FILE] || null;
}

async function saveResumeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async event => {
      const fileData = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: event.target.result,
      };
      await chrome.storage.local.set({ [KEYS.RESUME_FILE]: fileData });
      resolve(fileData);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveHistoryEntry(entry) {
  const result = await chrome.storage.local.get(KEYS.HISTORY);
  const history = result[KEYS.HISTORY] || [];
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > 20) history.length = 20;
  await chrome.storage.local.set({ [KEYS.HISTORY]: history });
}

async function getHistory() {
  const result = await chrome.storage.local.get(KEYS.HISTORY);
  return result[KEYS.HISTORY] || [];
}

async function getLastFillReport() {
  const result = await chrome.storage.local.get(KEYS.LAST_FILL_REPORT);
  return result[KEYS.LAST_FILL_REPORT] || null;
}

async function saveLastFillReport(report) {
  await chrome.storage.local.set({ [KEYS.LAST_FILL_REPORT]: report || null });
}

async function clearHistory() {
  await chrome.storage.local.remove(KEYS.HISTORY);
}

async function clearAll() {
  await chrome.storage.local.clear();
}

export {
  KEYS,
  clearAll,
  clearHistory,
  createProfile,
  deleteProfile,
  duplicateProfile,
  getActiveProfileData,
  getActiveProfileId,
  getHistory,
  getLastFillReport,
  getProfile,
  getProfiles,
  getResumeFile,
  getSettings,
  migrateEducationToArray,
  migrateToMultiProfile,
  renameProfile,
  saveActiveProfileData,
  saveHistoryEntry,
  saveLastFillReport,
  saveProfile,
  saveResumeFile,
  saveSettings,
  setActiveProfile,
};
