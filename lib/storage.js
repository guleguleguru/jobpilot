import {
  createEmptyProfile,
  mergeProfileWithOverride,
  normalizeProfile,
  normalizeSiteKey,
  sanitizeProfileOverridePatch,
} from './profile-schema.js';

const KEYS = {
  PROFILE: 'userProfile',
  SETTINGS: 'settings',
  RESUME_FILE: 'resumeFile',
  HISTORY: 'fillHistory',
  LAST_FILL_REPORT: 'lastFillReport',
  PROFILES: 'profiles',
  ACTIVE_PROFILE: 'activeProfile',
  PROFILE_SNAPSHOTS: 'profileSnapshots',
  PROFILE_SITE_OVERRIDES: 'profileSiteOverrides',
};

const DEFAULT_SETTINGS = {
  aiEnabled: true,
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.1,
  confidenceThreshold: 0.7,
};

const PROFILE_SNAPSHOT_LIMIT = 7;

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

function normalizeSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .filter(snapshot => snapshot && typeof snapshot === 'object' && snapshot.profiles)
    .map(snapshot => ({
      id: snapshot.id || `snapshot_${Date.now()}`,
      createdAt: snapshot.createdAt || new Date().toISOString(),
      reason: snapshot.reason || 'profile_update',
      activeProfileId: snapshot.activeProfileId || 'default',
      profiles: normalizeProfilesMap(snapshot.profiles) || {},
      siteOverrides: normalizeProfileSiteOverrides(snapshot.siteOverrides),
    }))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function buildProfileSnapshot({ profiles, activeProfileId, reason, siteOverrides }) {
  return {
    id: `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    reason: reason || 'profile_update',
    activeProfileId: activeProfileId || 'default',
    profiles: normalizeProfilesMap(profiles) || {},
    siteOverrides: normalizeProfileSiteOverrides(siteOverrides),
  };
}

function appendProfileSnapshot(snapshots, snapshot, limit = PROFILE_SNAPSHOT_LIMIT) {
  const next = [snapshot, ...normalizeSnapshots(snapshots)];
  return next.slice(0, limit);
}

function normalizeSiteOverrideEntries(entries) {
  if (!entries || typeof entries !== 'object') return {};
  const next = {};

  for (const [siteKey, entry] of Object.entries(entries)) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const rawPatch = entry?.patch ?? entry;
    const patch = sanitizeProfileOverridePatch(rawPatch);
    if (!normalizedSiteKey || patch === undefined) continue;
    next[normalizedSiteKey] = {
      updatedAt: entry?.updatedAt || new Date().toISOString(),
      patch,
    };
  }

  return next;
}

function normalizeProfileSiteOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return {};
  const next = {};

  for (const [profileId, entries] of Object.entries(overrides)) {
    const normalizedEntries = normalizeSiteOverrideEntries(entries);
    if (Object.keys(normalizedEntries).length) next[profileId] = normalizedEntries;
  }

  return next;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeSiteOverridePatch(basePatch, nextPatch) {
  if (nextPatch === undefined) return cloneValue(basePatch);

  if (Array.isArray(basePatch) || Array.isArray(nextPatch)) {
    const baseArray = Array.isArray(basePatch) ? basePatch : [];
    const nextArray = Array.isArray(nextPatch) ? nextPatch : [];
    const merged = new Array(Math.max(baseArray.length, nextArray.length));

    for (let index = 0; index < merged.length; index++) {
      if (nextArray[index] === undefined) {
        merged[index] = cloneValue(baseArray[index]);
        continue;
      }
      merged[index] = mergeSiteOverridePatch(baseArray[index], nextArray[index]);
    }

    return merged;
  }

  if (
    (basePatch && typeof basePatch === 'object' && !Array.isArray(basePatch)) ||
    (nextPatch && typeof nextPatch === 'object' && !Array.isArray(nextPatch))
  ) {
    const baseObject = basePatch && typeof basePatch === 'object' && !Array.isArray(basePatch) ? basePatch : {};
    const nextObject = nextPatch && typeof nextPatch === 'object' && !Array.isArray(nextPatch) ? nextPatch : {};
    const merged = cloneValue(baseObject) || {};

    for (const [key, value] of Object.entries(nextObject)) {
      merged[key] = mergeSiteOverridePatch(baseObject[key], value);
    }

    return merged;
  }

  return cloneValue(nextPatch);
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

async function getProfileSnapshots() {
  const result = await chrome.storage.local.get(KEYS.PROFILE_SNAPSHOTS);
  return normalizeSnapshots(result[KEYS.PROFILE_SNAPSHOTS]);
}

async function getProfileSiteOverrides() {
  const result = await chrome.storage.local.get(KEYS.PROFILE_SITE_OVERRIDES);
  return normalizeProfileSiteOverrides(result[KEYS.PROFILE_SITE_OVERRIDES]);
}

async function getSiteProfileOverride(profileId, siteKey) {
  const normalizedSiteKey = normalizeSiteKey(siteKey);
  if (!profileId || !normalizedSiteKey) return null;
  const overrides = await getProfileSiteOverrides();
  return overrides[profileId]?.[normalizedSiteKey]?.patch ?? null;
}

async function saveProfileSnapshots(snapshots) {
  await chrome.storage.local.set({ [KEYS.PROFILE_SNAPSHOTS]: normalizeSnapshots(snapshots) });
}

function profilesEqual(left, right) {
  return JSON.stringify(normalizeProfilesMap(left) || {}) === JSON.stringify(normalizeProfilesMap(right) || {});
}

function siteOverridesEqual(left, right) {
  return JSON.stringify(normalizeProfileSiteOverrides(left) || {}) === JSON.stringify(normalizeProfileSiteOverrides(right) || {});
}

async function saveProfileState({ profiles, activeProfileId, siteOverrides, snapshotReason } = {}) {
  const current = await chrome.storage.local.get([
    KEYS.PROFILES,
    KEYS.ACTIVE_PROFILE,
    KEYS.PROFILE_SNAPSHOTS,
    KEYS.PROFILE_SITE_OVERRIDES,
  ]);
  const currentProfiles = normalizeProfilesMap(current[KEYS.PROFILES]) || {};
  const currentSiteOverrides = normalizeProfileSiteOverrides(current[KEYS.PROFILE_SITE_OVERRIDES]);
  const nextProfiles = profiles === undefined ? currentProfiles : (normalizeProfilesMap(profiles) || {});
  const nextSiteOverrides = siteOverrides === undefined
    ? currentSiteOverrides
    : normalizeProfileSiteOverrides(siteOverrides);
  const profilesChanged = !profilesEqual(currentProfiles, nextProfiles);
  const siteOverridesChanged = !siteOverridesEqual(currentSiteOverrides, nextSiteOverrides);

  if ((profilesChanged || siteOverridesChanged) && Object.keys(currentProfiles).length) {
    const nextSnapshots = appendProfileSnapshot(
      current[KEYS.PROFILE_SNAPSHOTS],
      buildProfileSnapshot({
        profiles: currentProfiles,
        activeProfileId: current[KEYS.ACTIVE_PROFILE] || activeProfileId || 'default',
        reason: snapshotReason || 'profile_update',
        siteOverrides: currentSiteOverrides,
      })
    );
    await saveProfileSnapshots(nextSnapshots);
  }

  const payload = {};
  if (profiles !== undefined) payload[KEYS.PROFILES] = nextProfiles;
  if (siteOverrides !== undefined) payload[KEYS.PROFILE_SITE_OVERRIDES] = nextSiteOverrides;
  if (activeProfileId !== undefined) payload[KEYS.ACTIVE_PROFILE] = activeProfileId;

  if (Object.keys(payload).length) {
    await chrome.storage.local.set(payload);
  }
}

async function saveProfiles(profiles, options = {}) {
  await saveProfileState({
    profiles,
    activeProfileId: options.activeProfileId,
    snapshotReason: options.snapshotReason,
  });
}

async function saveProfileSiteOverrides(overrides, options = {}) {
  await saveProfileState({
    siteOverrides: overrides,
    activeProfileId: options.activeProfileId,
    snapshotReason: options.snapshotReason || 'site_profile_override_update',
  });
}

async function saveActiveProfileData(data, options = {}) {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles || !profiles[activeId]) return;
  profiles[activeId].data = normalizeProfile(data);
  profiles[activeId].updatedAt = new Date().toISOString();
  await saveProfiles(profiles, {
    activeProfileId: activeId,
    snapshotReason: options.snapshotReason || 'active_profile_save',
  });
}

async function getProfile(siteKey = '') {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles) return null;
  const baseProfile = profiles[activeId]?.data ?? null;
  if (!baseProfile) return null;

  const normalizedSiteKey = normalizeSiteKey(siteKey);
  if (!normalizedSiteKey) return baseProfile;

  const overridePatch = await getSiteProfileOverride(activeId, normalizedSiteKey);
  return overridePatch ? mergeProfileWithOverride(baseProfile, overridePatch) : baseProfile;
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
  await saveProfiles(profiles, {
    activeProfileId: id,
    snapshotReason: 'profile_create',
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
  await saveProfiles(profiles, {
    activeProfileId: id,
    snapshotReason: 'profile_duplicate',
  });
  return id;
}

async function deleteProfile(id) {
  const [profiles, activeId, siteOverrides] = await Promise.all([
    getProfiles(),
    getActiveProfileId(),
    getProfileSiteOverrides(),
  ]);
  if (!profiles || !profiles[id]) throw new Error(`Profile ${id} does not exist`);
  const remaining = Object.keys(profiles).filter(key => key !== id);
  if (!remaining.length) throw new Error('At least one profile must remain');

  delete profiles[id];
  if (siteOverrides[id]) delete siteOverrides[id];

  const nextActiveProfileId = activeId === id ? remaining[0] : activeId;
  await saveProfileState({
    profiles,
    siteOverrides,
    activeProfileId: nextActiveProfileId,
    snapshotReason: 'profile_delete',
  });
}

async function renameProfile(id, newName) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[id]) throw new Error(`Profile ${id} does not exist`);
  profiles[id].name = newName;
  await saveProfiles(profiles, { snapshotReason: 'profile_rename' });
}

async function saveSiteProfileOverride(profileId, siteKey, patch, options = {}) {
  const normalizedSiteKey = normalizeSiteKey(siteKey);
  const normalizedPatch = sanitizeProfileOverridePatch(patch);
  if (!profileId) throw new Error('Profile id is required');
  if (!normalizedSiteKey) throw new Error('Site key is required');

  const overrides = await getProfileSiteOverrides();
  if (normalizedPatch === undefined) {
    if (overrides[profileId]?.[normalizedSiteKey]) {
      delete overrides[profileId][normalizedSiteKey];
      if (!Object.keys(overrides[profileId]).length) delete overrides[profileId];
      await saveProfileSiteOverrides(overrides, { snapshotReason: 'site_profile_override_delete' });
    }
    return;
  }

  overrides[profileId] = overrides[profileId] || {};
  const existingPatch = overrides[profileId][normalizedSiteKey]?.patch;
  overrides[profileId][normalizedSiteKey] = {
    updatedAt: new Date().toISOString(),
    patch: options.merge === false ? normalizedPatch : mergeSiteOverridePatch(existingPatch, normalizedPatch),
  };
  await saveProfileSiteOverrides(overrides, { snapshotReason: 'site_profile_override_save' });
}

async function restoreProfileSnapshot(snapshotId) {
  if (!snapshotId) throw new Error('Snapshot id is required');

  const current = await chrome.storage.local.get([
    KEYS.PROFILES,
    KEYS.ACTIVE_PROFILE,
    KEYS.PROFILE_SNAPSHOTS,
    KEYS.PROFILE_SITE_OVERRIDES,
  ]);
  const snapshots = normalizeSnapshots(current[KEYS.PROFILE_SNAPSHOTS]);
  const snapshot = snapshots.find(entry => entry.id === snapshotId);
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} does not exist`);

  const currentProfiles = normalizeProfilesMap(current[KEYS.PROFILES]) || {};
  const currentSiteOverrides = normalizeProfileSiteOverrides(current[KEYS.PROFILE_SITE_OVERRIDES]);
  const nextSnapshots = appendProfileSnapshot(
    snapshots.filter(entry => entry.id !== snapshotId),
    buildProfileSnapshot({
      profiles: currentProfiles,
      activeProfileId: current[KEYS.ACTIVE_PROFILE] || 'default',
      reason: 'snapshot_restore_backup',
      siteOverrides: currentSiteOverrides,
    })
  );

  await chrome.storage.local.set({
    [KEYS.PROFILES]: normalizeProfilesMap(snapshot.profiles) || {},
    [KEYS.ACTIVE_PROFILE]: snapshot.activeProfileId || 'default',
    [KEYS.PROFILE_SITE_OVERRIDES]: normalizeProfileSiteOverrides(snapshot.siteOverrides),
    [KEYS.PROFILE_SNAPSHOTS]: nextSnapshots,
  });
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
  PROFILE_SNAPSHOT_LIMIT,
  KEYS,
  appendProfileSnapshot,
  buildProfileSnapshot,
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
  getProfileSiteOverrides,
  getProfileSnapshots,
  getProfiles,
  getResumeFile,
  getSettings,
  getSiteProfileOverride,
  migrateEducationToArray,
  migrateToMultiProfile,
  renameProfile,
  restoreProfileSnapshot,
  saveActiveProfileData,
  saveHistoryEntry,
  saveLastFillReport,
  saveProfile,
  saveProfileSiteOverrides,
  saveResumeFile,
  saveSettings,
  saveSiteProfileOverride,
  setActiveProfile,
};
