import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  buildAiParsePrompt,
  getFieldValue,
  parseLocalRegex,
  setFieldValue,
} from '../lib/pdf-parser.js';

import {
  buildFieldMappingPrompt,
  sanitizeProfile,
  validateFieldMappings,
} from '../lib/prompt-templates.js';
import { createFillReport, mergeDiagnosticsIntoReport, mergeFillReports, summarizeFillReport, upsertRepeatSection } from '../lib/fill-report.js';
import { mapEnumValue } from '../lib/enum-mappings.js';
import {
  mergeProfileWithOverride,
  normalizeProfile,
  normalizeSiteKey,
  sanitizeProfileOverridePatch,
} from '../lib/profile-schema.js';

const tests = [];

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createChromeStorageMock(initialState = {}) {
  const store = deepClone(initialState);

  function pick(keys) {
    if (typeof keys === 'string') {
      return { [keys]: deepClone(store[keys]) };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map(key => [key, deepClone(store[key])]));
    }
    if (keys && typeof keys === 'object') {
      return Object.fromEntries(
        Object.entries(keys).map(([key, defaultValue]) => [key, key in store ? deepClone(store[key]) : defaultValue])
      );
    }
    return deepClone(store);
  }

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return pick(keys);
        },
        async set(items) {
          Object.assign(store, deepClone(items));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete store[key];
          }
        },
        async clear() {
          for (const key of Object.keys(store)) delete store[key];
        },
      },
    },
  };

  return store;
}

async function importStorageModuleWithMock(initialState = {}) {
  const store = createChromeStorageMock(initialState);
  const moduleUrl = new URL(`../lib/storage.js?test=${Date.now()}_${Math.random()}`, import.meta.url);
  const mod = await import(moduleUrl.href);
  return { mod, store };
}

function loadChinaTaipingAdapter() {
  const source = readFileSync(new URL('../content/site-adapters/china-taiping.js', import.meta.url), 'utf8');
  const registered = [];

  class MockBaseSiteAdapter {
    constructor({ id, name }) {
      this.id = id;
      this.name = name || id;
      this.repeatableLimits = {
        education: 6,
        experience: 6,
        projects: 6,
        languages: 6,
        familyMembers: 6,
      };
    }
  }

  const sandbox = {
    console,
    document: {
      body: {},
      querySelectorAll() {
        return [];
      },
    },
    window: {
      __jobpilotRegisterSiteAdapter(adapter) {
        registered.push(adapter);
      },
      __jobpilotSiteAdapterBase: {
        BaseSiteAdapter: MockBaseSiteAdapter,
        findElementByText() {
          return null;
        },
        getClickableElements() {
          return [];
        },
        getElementText(element) {
          return String(element?.textContent || '');
        },
        getSectionRoot() {
          return null;
        },
        isVisible() {
          return true;
        },
        normalizeComparableText(value) {
          return String(value || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[()（）\-_/\\,.;:：，。?"'`~!@#$%^&*+=?|[\]{}<>]/g, '');
        },
        normalizeText(value) {
          return String(value || '').replace(/\s+/g, ' ').trim();
        },
        sleep() {
          return Promise.resolve();
        },
        waitForDomChange() {
          return Promise.resolve(false);
        },
      },
    },
    Element: class {},
    Document: class {},
    HTMLInputElement: class {},
    HTMLElement: class {},
    KeyboardEvent: class {},
    Event: class {},
  };

  vm.runInNewContext(source, sandbox, { filename: 'china-taiping.js' });
  assert.equal(registered.length, 1, 'china-taiping adapter should register exactly once');
  return registered[0];
}

function test(name, fn) {
  tests.push({ name, fn });
}

test('setFieldValue creates nested objects and arrays', () => {
  const profile = {};

  setFieldValue(profile, 'education[0].school', '上海交通大学');
  setFieldValue(profile, 'experience[1].title', '后端开发实习生');
  setFieldValue(profile, 'skills', 'Python, JavaScript Docker');

  assert.equal(profile.education[0].school, '上海交通大学');
  assert.equal(profile.experience[1].title, '后端开发实习生');
  assert.deepEqual(profile.skills, ['Python', 'JavaScript', 'Docker']);
});

test('getFieldValue reads nested values and stringifies arrays', () => {
  const profile = {
    education: [{ school: '复旦大学' }],
    skills: ['Python', 'Go'],
  };

  assert.equal(getFieldValue(profile, 'education[0].school'), '复旦大学');
  assert.equal(getFieldValue(profile, 'skills'), 'Python, Go');
  assert.equal(getFieldValue(profile, 'education[1].school'), '');
});

test('parseLocalRegex extracts core resume fields from Chinese text', () => {
  const text = `
张三
13800138000 | zhangsan@example.com | https://github.com/zhangsan
期望城市：上海
到岗时间：两周内
期望薪资：面议
可实习多久：每周4天，持续6个月
证件类型：身份证

教育背景
上海交通大学
专业：计算机科学与技术
本科
2017年09月 - 2021年06月
GPA：3.8/4.0

工作经历
字节跳动科技
2020年07月 - 2020年12月

项目经历
JobPilot 智投助手
2025年12月 - 2026年03月
负责招聘表单检测与自动填写功能开发

奖项荣誉
2020 国家奖学金

语言能力
英语：CET-6

技能：Python, JavaScript, Docker

自我评价：具有扎实的工程基础和良好的团队协作能力。
`.trim();

  const parsed = parseLocalRegex(text);

  assert.equal(parsed.name, '张三');
  assert.equal(parsed.phone, '13800138000');
  assert.equal(parsed.email, 'zhangsan@example.com');
  assert.equal(parsed.links.github, 'https://github.com/zhangsan');
  assert.equal(parsed.jobPreferences.expectedCity, '上海');
  assert.equal(parsed.jobPreferences.availableFrom, '两周内');
  assert.equal(parsed.jobPreferences.expectedSalary, '面议');
  assert.equal(parsed.jobPreferences.internshipDuration, '每周4天，持续6个月');
  assert.equal(parsed.documentType, '居民身份证');
  assert.equal(parsed.education[0].school, '上海交通大学');
  assert.equal(parsed.education[0].major, '计算机科学与技术');
  assert.equal(parsed.education[0].degree, '本科');
  assert.equal(parsed.education[0].startDate, '2017-09');
  assert.equal(parsed.education[0].endDate, '2021-06');
  assert.equal(parsed.graduationYear, '2021');
  assert.equal(parsed.education[0].gpa, '3.8/4.0');
  assert.equal(parsed.projects[0].name, 'JobPilot 智投助手');
  assert.match(parsed.projects[0].description, /招聘表单检测/);
  assert.equal(parsed.awards[0].year, '2020');
  assert.match(parsed.awards[0].name, /国家奖学金/);
  assert.equal(parsed.languages[0].name, '英语');
  assert.equal(parsed.languages[0].level, 'CET-6');
  assert.deepEqual(parsed.skills, ['Python', 'JavaScript', 'Docker']);
  assert.match(parsed.selfIntro, /工程基础/);
});

test('buildAiParsePrompt truncates long resume text', () => {
  const longText = 'A'.repeat(4500);
  const messages = buildAiParsePrompt(longText);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('A'.repeat(4000)));
  assert.ok(!messages[1].content.includes('A'.repeat(4001)));
});

test('sanitizeProfile removes sensitive fields and keeps up to two entries', () => {
  const sanitized = sanitizeProfile({
    name: '张三',
    idNumber: '310101199901011234',
    phone: '13800138000',
    education: [
      { school: '上海交通大学', major: '计算机', degree: '本科' },
      { school: '清华大学', major: '软件工程', degree: '硕士' },
      { school: '不会保留', degree: '博士' },
    ],
    experience: [
      { company: '字节跳动', title: '实习生' },
      { company: '腾讯', title: '工程师' },
      { company: '不会保留', title: '顾问' },
    ],
    links: { github: 'https://github.com/zhangsan' },
    resumeFilePath: '/tmp/resume.pdf',
  });

  assert.equal(sanitized.name, '张三');
  assert.equal(sanitized.phone, '13800138000');
  assert.equal(sanitized.idNumber, undefined);
  assert.equal(sanitized.resumeFilePath, undefined);
  assert.equal(sanitized.jobPreferences?.expectedCity, undefined);
  assert.equal(sanitized.education.length, 2);
  assert.equal(sanitized.experience.length, 2);
});

test('sanitizeProfile keeps structured job preferences and extra arrays', () => {
  const sanitized = sanitizeProfile({
    jobPreferences: {
      expectedCity: '上海',
      availableFrom: '两周内',
      expectedSalary: '面议',
      internshipDuration: '6个月',
    },
    projects: [
      { name: 'JobPilot', role: '独立开发', description: '表单自动填写扩展' },
    ],
    awards: [
      { name: '国家奖学金', year: '2020', issuer: '教育部' },
    ],
    languages: [
      { name: '英语', level: 'CET-6' },
    ],
  });

  assert.equal(sanitized.jobPreferences.expectedCity, '上海');
  assert.equal(sanitized.projects[0].name, 'JobPilot');
  assert.equal(sanitized.awards[0].year, '2020');
  assert.equal(sanitized.languages[0].level, 'CET-6');
});

test('normalizeProfile preserves name pinyin for site-specific fields', () => {
  const normalized = normalizeProfile({
    personal: {
      fullName: '宋培豪',
      fullNamePinyin: 'Song Peihao',
    },
  });

  assert.equal(normalized.personal.fullName, '宋培豪');
  assert.equal(normalized.personal.fullNamePinyin, 'Song Peihao');
});

test('buildFieldMappingPrompt includes sanitized profile and summarized fields', () => {
  const messages = buildFieldMappingPrompt(
    [
      {
        id: 'field_1',
        label: '为什么想加入我们',
        type: 'textarea',
        placeholder: '请简要说明',
        name: 'motivation',
      },
    ],
    {
      name: '张三',
      idNumber: 'hidden',
      education: [{ school: '上海交通大学' }],
    }
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('"name": "张三"'));
  assert.ok(messages[1].content.includes('"school": "上海交通大学"'));
  assert.ok(!messages[1].content.includes('idNumber'));
  assert.ok(messages[1].content.includes('"fieldName": "motivation"'));
});

test('buildFieldMappingPrompt preserves candidate hints for AI fallback', () => {
  const messages = buildFieldMappingPrompt(
    [
      {
        id: 'field_2',
        label: '学校所在国家',
        type: 'select',
        normalizedKey: 'education[0].schoolCountry',
        candidateHints: [
          { key: 'education[0].schoolCountry', score: 8.4, exactAliasHit: true },
        ],
      },
    ],
    { education: [{ school: 'Cornell University' }] }
  );

  assert.ok(messages[1].content.includes('"candidateHints"'));
  assert.ok(messages[1].content.includes('"education[0].schoolCountry"'));
});

test('validateFieldMappings converts option text back to option value', () => {
  const fixed = validateFieldMappings(
    [
      { fieldId: 'f1', suggestedValue: '男', confidence: 0.8 },
      { fieldId: 'f2', suggestedValue: '未知值', confidence: 0.9 },
    ],
    [
      {
        id: 'f1',
        type: 'select',
        options: [
          { value: 'male', text: '男' },
          { value: 'female', text: '女' },
        ],
      },
      {
        id: 'f2',
        type: 'radio',
        options: [
          { value: 'yes', text: '是' },
          { value: 'no', text: '否' },
        ],
      },
    ]
  );

  assert.equal(fixed[0].suggestedValue, 'male');
  assert.equal(fixed[1].confidence, 0.3);
});

test('mapEnumValue maps Chinese enum labels to option values', () => {
  const yesNo = mapEnumValue({
    fieldKey: 'personal.hasOverseasStudy',
    value: '有',
    options: [
      { value: '1', text: '是' },
      { value: '0', text: '否' },
    ],
  });

  const political = mapEnumValue({
    fieldKey: 'personal.politicalStatus',
    value: '共青团员',
    options: [
      { value: 'party', text: '中共党员' },
      { value: 'league', text: '共青团员' },
      { value: 'mass', text: '群众' },
    ],
  });

  assert.equal(yesNo.mappedValue, '1');
  assert.equal(political.mappedValue, 'league');
});

test('fill report merges diagnostics and repeat sections', () => {
  const report = createFillReport({ hostname: 'example.com', adapterUsed: 'china-taiping' });
  mergeDiagnosticsIntoReport(report, {
    missingRequiredFields: [{ fieldId: 'a' }],
    unmappedFields: [{ fieldId: 'b' }],
    sensitiveFieldsSkipped: [{ fieldId: 'c' }],
    unmappedValues: [{ fieldId: 'd' }],
  });
  upsertRepeatSection(report, {
    section: 'languages',
    expected: 2,
    existing: 1,
    created: 1,
    filled: 2,
    warnings: ['languages:add_button_missing_after_limit'],
  });

  const merged = mergeFillReports([
    report,
    createFillReport({
      hostname: 'example.com',
      adapterUsed: 'china-taiping',
      detectedCount: 10,
      warnings: ['familyMembers:dom_not_changed'],
    }),
  ]);
  const summary = summarizeFillReport(merged);

  assert.equal(merged.adapterUsed, 'china-taiping');
  assert.equal(merged.unmappedValues.length, 1);
  assert.equal(merged.repeatSections[0].created, 1);
  assert.equal(summary.warningCount, 1);
});

test('china-taiping adapter maps direct labeled fields again after regression fix', () => {
  const adapter = loadChinaTaipingAdapter();
  const result = adapter.matchField({
    field: {
      id: 'field_education_school',
      type: 'text',
      label: '学校名称',
      labelCandidates: ['学校名称'],
      placeholder: '请输入',
      helperText: '',
      sectionLabel: '教育经历',
      contextText: '',
      containerText: '',
      name: '',
      selector: '#root > div > div:nth-of-type(2) > div:nth-of-type(1)',
    },
    profile: {
      education: [{ school: '康奈尔大学' }],
    },
    helpers: {
      claimGroupedKey(group, subkey) {
        return `${group}[0].${subkey}`;
      },
      getProfileValue(profile, key) {
        return key === 'education[0].school' ? profile.education[0].school : '';
      },
      isSensitiveField() {
        return false;
      },
    },
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.key, 'education[0].school');
  assert.equal(result?.value, '康奈尔大学');
});

test('china-taiping adapter keeps photo upload manual-only', () => {
  const adapter = loadChinaTaipingAdapter();
  const result = adapter.matchField({
    field: {
      id: 'field_photo',
      type: 'button',
      label: '点击上传',
      labelCandidates: ['证件照', '点击上传'],
      placeholder: '',
      helperText: '',
      sectionLabel: '个人信息',
      contextText: '',
      containerText: '证件照 上传文件',
      name: '',
      selector: '#root > div > div:nth-of-type(3) > div:nth-of-type(2)',
    },
    profile: {},
    helpers: {
      claimGroupedKey(group, subkey) {
        return `${group}[0].${subkey}`;
      },
      getProfileValue() {
        return '';
      },
      isSensitiveField() {
        return true;
      },
    },
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.key, 'personal.photo');
  assert.equal(result?.manualOnly, true);
});

test('china-taiping adapter does not fall back explicit fields to photo template', () => {
  const adapter = loadChinaTaipingAdapter();
  const result = adapter.matchField({
    field: {
      id: 'field_name_like_photo_slot',
      type: 'text',
      label: '姓名',
      labelCandidates: ['姓名'],
      placeholder: '请输入',
      helperText: '',
      sectionLabel: '个人信息',
      contextText: '',
      containerText: '',
      name: '',
      selector: '#root > div > div:nth-of-type(3) > div:nth-of-type(2)',
    },
    profile: {
      personal: { fullName: '宋培豪' },
    },
    helpers: {
      claimGroupedKey(group, subkey) {
        return `${group}[0].${subkey}`;
      },
      getProfileValue() {
        return '宋培豪';
      },
      isSensitiveField() {
        return false;
      },
    },
  });

  assert.equal(result, null);
});

test('china-taiping adapter ignores photo hints leaking from noisy label candidates', () => {
  const adapter = loadChinaTaipingAdapter();
  const result = adapter.matchField({
    field: {
      id: 'field_name_with_noisy_candidates',
      type: 'text',
      label: '姓名',
      labelCandidates: ['姓名', '证件照上传文件'],
      placeholder: '请输入',
      helperText: '',
      sectionLabel: '个人信息',
      contextText: '',
      containerText: '',
      name: '',
      selector: '#root > div > div:nth-of-type(1) > div:nth-of-type(1)',
    },
    profile: {
      personal: { fullName: '宋培豪' },
    },
    helpers: {
      claimGroupedKey(group, subkey) {
        return `${group}[0].${subkey}`;
      },
      getProfileValue(profile, key) {
        return key === 'personal.fullName' ? profile.personal.fullName : '';
      },
      isSensitiveField() {
        return false;
      },
    },
  });

  assert.equal(result, null);
});

test('site override helpers normalize hostnames and preserve sparse patch data', () => {
  const patch = sanitizeProfileOverridePatch({
    personal: { englishName: '  Peter Song  ', fullName: '' },
    languages: [{ customFields: { examType: ' TEM-8 ' } }, {}],
    familyMembers: [{ identityType: '配偶', customFields: { relationCode: 'spouse' } }],
  });

  assert.equal(normalizeSiteKey('https://cntp.zhiye.com/form?job=1'), 'cntp.zhiye.com');
  assert.equal(patch.personal.englishName, 'Peter Song');
  assert.equal(patch.personal.fullName, undefined);
  assert.equal(patch.languages[0].customFields.examType, 'TEM-8');
  assert.equal(patch.languages.length, 1);
  assert.equal(patch.familyMembers[0].customFields.relationCode, 'spouse');
});

test('mergeProfileWithOverride keeps base profile fields while applying site-specific values', () => {
  const merged = mergeProfileWithOverride(
    normalizeProfile({
      personal: { fullName: '宋培豪' },
      languages: [{ language: '英语', proficiency: 'CET-6' }],
      familyMembers: [{ relation: '父亲', name: '宋某' }],
    }),
    {
      personal: { englishName: 'Peter Song' },
      languages: [{ customFields: { certType: 'TEM-8' } }],
      familyMembers: [{ identityType: '配偶', customFields: { relationCode: 'spouse' } }],
    }
  );

  assert.equal(merged.personal.fullName, '宋培豪');
  assert.equal(merged.personal.englishName, 'Peter Song');
  assert.equal(merged.languages[0].language, '英语');
  assert.equal(merged.languages[0].proficiency, 'CET-6');
  assert.equal(merged.languages[0].customFields.certType, 'TEM-8');
  assert.equal(merged.familyMembers[0].relation, '父亲');
  assert.equal(merged.familyMembers[0].identityType, '配偶');
  assert.equal(merged.familyMembers[0].customFields.relationCode, 'spouse');
});

test('storage keeps only seven snapshots and merges site-specific profile overrides by hostname', async () => {
  const { mod } = await importStorageModuleWithMock({
    profiles: {
      default: {
        name: '默认资料',
        data: normalizeProfile({
          personal: { fullName: '初始版本' },
          languages: [{ language: '英语', proficiency: 'CET-6' }],
          familyMembers: [{ relation: '父亲', name: '宋某' }],
        }),
        createdAt: '2026-03-31T00:00:00.000Z',
      },
    },
    activeProfile: 'default',
  });

  for (let index = 1; index <= 8; index++) {
    await mod.saveActiveProfileData({
      personal: { fullName: `版本 ${index}` },
      languages: [{ language: '英语', proficiency: 'CET-6' }],
      familyMembers: [{ relation: '父亲', name: '宋某' }],
    });
  }

  const snapshots = await mod.getProfileSnapshots();
  assert.equal(snapshots.length, 7);
  assert.equal(snapshots[0].reason, 'active_profile_save');
  assert.equal(snapshots[0].profiles.default.data.personal.fullName, '版本 7');
  assert.equal(snapshots[6].profiles.default.data.personal.fullName, '版本 1');

  await mod.saveSiteProfileOverride('default', 'https://cntp.zhiye.com/form?job=1', {
    languages: [{ customFields: { certType: 'TEM-8' } }],
    familyMembers: [{ identityType: '配偶', customFields: { relationCode: 'spouse' } }],
  });
  await mod.saveSiteProfileOverride('default', 'cntp.zhiye.com', {
    personal: { englishName: 'Peter Song' },
  });

  const siteProfile = await mod.getProfile('cntp.zhiye.com');
  const baseProfile = await mod.getProfile();
  assert.equal(baseProfile.languages[0].customFields?.certType, undefined);
  assert.equal(baseProfile.personal.englishName, '');
  assert.equal(siteProfile.personal.englishName, 'Peter Song');
  assert.equal(siteProfile.languages[0].customFields.certType, 'TEM-8');
  assert.equal(siteProfile.familyMembers[0].relation, '父亲');
  assert.equal(siteProfile.familyMembers[0].identityType, '配偶');
});

test('storage can restore a snapshot and keeps a backup of the pre-restore state', async () => {
  const { mod } = await importStorageModuleWithMock({
    profiles: {
      default: {
        name: '默认资料',
        data: normalizeProfile({ personal: { fullName: '初始版本' } }),
        createdAt: '2026-03-31T00:00:00.000Z',
      },
    },
    activeProfile: 'default',
  });

  await mod.saveActiveProfileData({ personal: { fullName: '版本 A' } });
  await mod.saveActiveProfileData({ personal: { fullName: '版本 B' } });

  const snapshotsBeforeRestore = await mod.getProfileSnapshots();
  const targetSnapshot = snapshotsBeforeRestore.find(snapshot => snapshot.profiles.default.data.personal.fullName === '版本 A');
  assert.ok(targetSnapshot, 'expected to find snapshot for 版本 A');

  await mod.restoreProfileSnapshot(targetSnapshot.id);

  const restoredProfile = await mod.getProfile();
  const snapshotsAfterRestore = await mod.getProfileSnapshots();
  assert.equal(restoredProfile.personal.fullName, '版本 A');
  assert.equal(snapshotsAfterRestore[0].reason, 'snapshot_restore_backup');
  assert.equal(snapshotsAfterRestore[0].profiles.default.data.personal.fullName, '版本 B');
});

test('storage supports replacing a site override patch from editor-style saves', async () => {
  const { mod } = await importStorageModuleWithMock({
    profiles: {
      default: {
        name: '默认资料',
        data: normalizeProfile({
          personal: { fullName: '宋培豪' },
          languages: [{ language: '英语', proficiency: 'CET-6' }],
        }),
        createdAt: '2026-03-31T00:00:00.000Z',
      },
    },
    activeProfile: 'default',
  });

  await mod.saveSiteProfileOverride('default', 'cntp.zhiye.com', {
    languages: [{ customFields: { certType: 'TEM-8' } }],
  });
  await mod.saveSiteProfileOverride('default', 'cntp.zhiye.com', {
    personal: { englishName: 'Peter Song' },
  }, { merge: false });

  const siteProfile = await mod.getProfile('cntp.zhiye.com');
  assert.equal(siteProfile.personal.englishName, 'Peter Song');
  assert.equal(siteProfile.languages[0].customFields?.certType, undefined);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log(`\n${passed}/${tests.length} tests passed`);
}
