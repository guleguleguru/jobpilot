/**
 * storage.js — chrome.storage 封装（Phase 4：支持多资料模板）
 */

const KEYS = {
  PROFILE:        'userProfile',    // 旧版单一资料（向后兼容，迁移后废弃）
  SETTINGS:       'settings',
  RESUME_FILE:    'resumeFile',
  HISTORY:        'fillHistory',
  PROFILES:       'profiles',       // 新版多模板：{ id: { name, data, createdAt } }
  ACTIVE_PROFILE: 'activeProfile',  // 当前激活的模板 ID
};

const DEFAULT_SETTINGS = {
  aiEnabled:           true,
  provider:            'deepseek',
  apiKey:              '',
  model:               'deepseek-chat',
  temperature:         0.1,
  confidenceThreshold: 0.7,
};

// ════════════════════════════════════════════════════════════
// 旧版兼容接口（内部委托到多模板函数）
// ════════════════════════════════════════════════════════════

/**
 * 读取当前激活资料（向后兼容）
 */
async function getProfile() {
  return getActiveProfileData();
}

/**
 * 保存到当前激活资料（向后兼容）
 */
async function saveProfile(data) {
  return saveActiveProfileData(data);
}

// ════════════════════════════════════════════════════════════
// 多模板：读取 / 写入
// ════════════════════════════════════════════════════════════

/**
 * 读取所有资料模板
 * @returns {Promise<Record<string, { name: string, data: object, createdAt: string }>>}
 */
async function getProfiles() {
  const r = await chrome.storage.local.get(KEYS.PROFILES);
  return r[KEYS.PROFILES] || null;
}

/**
 * 读取当前激活的模板 ID
 */
async function getActiveProfileId() {
  const r = await chrome.storage.local.get(KEYS.ACTIVE_PROFILE);
  return r[KEYS.ACTIVE_PROFILE] || 'default';
}

/**
 * 读取当前激活模板的资料数据
 */
async function getActiveProfileData() {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles) return null;
  return profiles[activeId]?.data ?? null;
}

/**
 * 覆盖当前激活模板的资料数据
 */
async function saveActiveProfileData(data) {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles || !activeId || !profiles[activeId]) return;
  profiles[activeId].data      = data;
  profiles[activeId].updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [KEYS.PROFILES]: profiles });
}

/**
 * 设置当前激活的模板
 */
async function setActiveProfile(id) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[id]) throw new Error(`模板 ${id} 不存在`);
  await chrome.storage.local.set({ [KEYS.ACTIVE_PROFILE]: id });
}

// ════════════════════════════════════════════════════════════
// 多模板：CRUD
// ════════════════════════════════════════════════════════════

/**
 * 新建模板
 * @param {string} name  模板名称
 * @param {object} [data] 初始资料，默认空对象
 * @returns {string} 新模板 ID
 */
async function createProfile(name, data = {}) {
  const profiles = (await getProfiles()) || {};
  const id = `profile_${Date.now()}`;
  profiles[id] = { name, data, createdAt: new Date().toISOString() };
  await chrome.storage.local.set({
    [KEYS.PROFILES]:       profiles,
    [KEYS.ACTIVE_PROFILE]: id,
  });
  return id;
}

/**
 * 复制现有模板
 * @param {string} sourceId 要复制的模板 ID
 * @param {string} newName  新模板名称
 * @returns {string} 新模板 ID
 */
async function duplicateProfile(sourceId, newName) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[sourceId]) throw new Error(`模板 ${sourceId} 不存在`);
  const id = `profile_${Date.now()}`;
  profiles[id] = {
    name:      newName,
    data:      JSON.parse(JSON.stringify(profiles[sourceId].data)), // 深拷贝
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({
    [KEYS.PROFILES]:       profiles,
    [KEYS.ACTIVE_PROFILE]: id,
  });
  return id;
}

/**
 * 删除模板（不允许删除最后一个）
 * @param {string} id
 */
async function deleteProfile(id) {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  if (!profiles || !profiles[id]) throw new Error(`模板 ${id} 不存在`);
  const remaining = Object.keys(profiles).filter(k => k !== id);
  if (!remaining.length) throw new Error('至少保留一个资料模板，无法删除');

  delete profiles[id];

  // 如果删除的是当前激活的，切换到第一个剩余模板
  const newActive = activeId === id ? remaining[0] : activeId;
  await chrome.storage.local.set({
    [KEYS.PROFILES]:       profiles,
    [KEYS.ACTIVE_PROFILE]: newActive,
  });
  return newActive;
}

/**
 * 重命名模板
 */
async function renameProfile(id, newName) {
  const profiles = await getProfiles();
  if (!profiles || !profiles[id]) throw new Error(`模板 ${id} 不存在`);
  profiles[id].name = newName;
  await chrome.storage.local.set({ [KEYS.PROFILES]: profiles });
}

// ════════════════════════════════════════════════════════════
// 版本迁移：education 对象 → 数组
// ════════════════════════════════════════════════════════════

/**
 * 将所有模板中 education: {} 格式迁移为 education: [{}] 数组格式
 * 幂等：已经是数组则跳过
 */
async function migrateEducationToArray() {
  const profiles = await getProfiles();
  if (!profiles) return;
  let changed = false;
  for (const id of Object.keys(profiles)) {
    const data = profiles[id]?.data;
    if (data && data.education && !Array.isArray(data.education)) {
      profiles[id].data.education = [data.education];
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ [KEYS.PROFILES]: profiles });
  }
}

// ════════════════════════════════════════════════════════════
// 版本迁移：单一资料 → 多模板
// ════════════════════════════════════════════════════════════

/**
 * 从旧版单一 profile（KEYS.PROFILE）迁移到多模板结构
 * 调用时机：sidepanel 初始化时
 */
async function migrateToMultiProfile() {
  const data = await chrome.storage.local.get([KEYS.PROFILE, KEYS.PROFILES]);

  // 已经是新格式，跳过
  if (data[KEYS.PROFILES]) return;

  const oldProfile = data[KEYS.PROFILE] || {};
  const defaultId  = 'default';
  await chrome.storage.local.set({
    [KEYS.PROFILES]: {
      [defaultId]: {
        name:      '默认简历',
        data:      oldProfile,
        createdAt: new Date().toISOString(),
      },
    },
    [KEYS.ACTIVE_PROFILE]: defaultId,
  });

  // 迁移成功后删除旧 key
  if (data[KEYS.PROFILE]) await chrome.storage.local.remove(KEYS.PROFILE);
}

// ════════════════════════════════════════════════════════════
// 设置
// ════════════════════════════════════════════════════════════

async function getSettings() {
  const r = await chrome.storage.local.get(KEYS.SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, r[KEYS.SETTINGS] || {});
}

async function saveSettings(settings) {
  const current = await getSettings();
  await chrome.storage.local.set({ [KEYS.SETTINGS]: Object.assign(current, settings) });
}

// ════════════════════════════════════════════════════════════
// 简历文件
// ════════════════════════════════════════════════════════════

async function getResumeFile() {
  const r = await chrome.storage.local.get(KEYS.RESUME_FILE);
  return r[KEYS.RESUME_FILE] || null;
}

async function saveResumeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const fileData = { name: file.name, type: file.type, size: file.size, data: e.target.result };
      await chrome.storage.local.set({ [KEYS.RESUME_FILE]: fileData });
      resolve(fileData);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════
// 填写历史
// ════════════════════════════════════════════════════════════

async function saveHistoryEntry(entry) {
  const r = await chrome.storage.local.get(KEYS.HISTORY);
  const history = r[KEYS.HISTORY] || [];
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > 20) history.length = 20;
  await chrome.storage.local.set({ [KEYS.HISTORY]: history });
}

async function getHistory() {
  const r = await chrome.storage.local.get(KEYS.HISTORY);
  return r[KEYS.HISTORY] || [];
}

async function clearHistory() {
  await chrome.storage.local.remove(KEYS.HISTORY);
}

// ════════════════════════════════════════════════════════════
// 全量重置
// ════════════════════════════════════════════════════════════

async function clearAll() {
  await chrome.storage.local.clear();
}

export {
  // 向后兼容
  getProfile, saveProfile,
  // 多模板
  getProfiles, getActiveProfileId, getActiveProfileData,
  setActiveProfile, saveActiveProfileData,
  createProfile, duplicateProfile, deleteProfile, renameProfile,
  migrateToMultiProfile, migrateEducationToArray,
  // 设置
  getSettings, saveSettings,
  // 简历文件
  getResumeFile, saveResumeFile,
  // 历史
  saveHistoryEntry, getHistory, clearHistory,
  // 全局
  clearAll, KEYS,
};
