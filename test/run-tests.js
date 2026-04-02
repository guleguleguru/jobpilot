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
  buildTargetProfilePrompt,
  buildFieldMappingPrompt,
  sanitizeProfile,
  validateFieldMappings,
} from '../lib/prompt-templates.js';
import {
  getTargetDraftDisplayLabel,
  hasTargetProfileContext,
  normalizeTargetProfileContext,
} from '../lib/target-profile.js';
import { createFillReport, mergeDiagnosticsIntoReport, mergeFillReports, summarizeFillReport, upsertRepeatSection } from '../lib/fill-report.js';
import { mapEnumValue } from '../lib/enum-mappings.js';
import {
  mergeProfileWithTargetDraft,
  mergeProfileWithOverride,
  normalizeProfile,
  normalizeSiteKey,
  normalizeTargetKey,
  sanitizeProfileOverridePatch,
} from '../lib/profile-schema.js';
import {
  buildSemanticFieldSample,
  extractSemanticSamplesFromDebugExport,
  learnSemanticFieldMemory,
  rankSemanticFieldCandidates,
  selectSemanticFieldCandidate,
} from '../lib/semantic-field-memory.js';

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
  return loadAdapterFromSource(source, 'china-taiping.js');
}

function loadAntGroupAdapter() {
  const source = readFileSync(new URL('../content/site-adapters/antgroup.js', import.meta.url), 'utf8');
  return loadAdapterFromSource(source, 'antgroup.js');
}

function loadSiteAdapterBase() {
  const source = readFileSync(new URL('../content/site-adapters/base-adapter.js', import.meta.url), 'utf8');
  class MockElement {
    constructor({ tagName = 'DIV', attrs = {}, textContent = '', parentElement = null, previousElementSibling = null } = {}) {
      this.tagName = tagName.toUpperCase();
      this.attrs = { ...attrs };
      this.textContent = textContent;
      this.parentElement = parentElement;
      this.previousElementSibling = previousElementSibling;
      this.className = attrs.class || '';
      this.id = attrs.id || '';
      this.value = attrs.value || '';
      this.onclick = attrs.onclick || null;
    }

    getAttribute(name) {
      return this.attrs[name] || '';
    }

    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    }

    querySelectorAll() {
      return [];
    }

    querySelector() {
      return null;
    }

    scrollIntoView() {}
    dispatchEvent() { return true; }
    click() {}
  }

  const sandbox = {
    console,
    document: {
      body: {},
      documentElement: {},
      querySelectorAll() {
        return [];
      },
    },
    window: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible' };
      },
    },
    Element: MockElement,
    Document: class {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
  };

  vm.runInNewContext(source, sandbox, { filename: 'base-adapter.js' });
  const base = sandbox.window.__jobpilotSiteAdapterBase;
  base.__sandbox = sandbox;
  return base;
}

function loadSiteAdapterRegistry() {
  const source = readFileSync(new URL('../content/site-adapters/index.js', import.meta.url), 'utf8');

  class MockBaseSiteAdapter {
    constructor({ id, name }) {
      this.id = id;
      this.name = name || id;
    }

    matches() {
      return false;
    }
  }

  const sandbox = {
    console,
    document: {},
    window: {
      location: { hostname: 'example.com' },
      __jobpilotSiteAdapterBase: { BaseSiteAdapter: MockBaseSiteAdapter },
    },
  };

  vm.runInNewContext(source, sandbox, { filename: 'index.js' });
  return sandbox.window;
}

async function loadLabelMatcher() {
  globalThis.window = globalThis.window || {};
  globalThis.document = globalThis.document || {};
  globalThis.location = globalThis.location || { href: 'https://example.com', hostname: 'example.com' };
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.runtime = {
    ...(globalThis.chrome.runtime || {}),
    getURL(relativePath) {
      return new URL(`../${relativePath}`, import.meta.url).href;
    },
    onMessage: {
      addListener() {},
    },
  };
  globalThis.chrome.storage = {
    ...(globalThis.chrome.storage || {}),
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
  };

  const moduleUrl = new URL(`../content/label-matcher.js?test=${Date.now()}_${Math.random()}`, import.meta.url);
  await import(moduleUrl.href);

  return {
    matchField: globalThis.window.__jobpilotMatchField,
    matchForms: globalThis.window.__jobpilotMatchForms,
  };
}

async function loadFormFillerDebug() {
  class MockElement {
    constructor({ tagName = 'DIV', attrs = {}, textContent = '', parentElement = null, previousElementSibling = null, labels = [] } = {}) {
      this.tagName = tagName.toUpperCase();
      this.attrs = { ...attrs };
      this.textContent = textContent;
      this.parentElement = parentElement;
      this.previousElementSibling = previousElementSibling;
      this.labels = labels;
      this.id = attrs.id || '';
      this.value = attrs.value || '';
      this.ownerDocument = null;
      this.style = {};
    }

    getAttribute(name) {
      return this.attrs[name] || '';
    }

    setAttribute(name, value) {
      this.attrs[name] = value;
    }

    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    }

    querySelectorAll() {
      return [];
    }

    closest() {
      return null;
    }

    dispatchEvent() {
      return true;
    }

    click() {}
    focus() {}
  }

  class MockInputElement extends MockElement {}
  class MockTextareaElement extends MockElement {}

  Object.defineProperty(MockInputElement.prototype, 'value', {
    get() {
      return this._value || '';
    },
    set(next) {
      this._value = next;
    },
    configurable: true,
  });

  Object.defineProperty(MockTextareaElement.prototype, 'value', {
    get() {
      return this._value || '';
    },
    set(next) {
      this._value = next;
    },
    configurable: true,
  });

  globalThis.window = {
    HTMLInputElement: MockInputElement,
    HTMLTextAreaElement: MockTextareaElement,
    getComputedStyle() {
      return { display: 'block', visibility: 'visible' };
    },
  };
  globalThis.Element = MockElement;
  globalThis.Document = class {};
  globalThis.HTMLInputElement = MockInputElement;
  globalThis.HTMLTextAreaElement = MockTextareaElement;
  globalThis.MouseEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  globalThis.KeyboardEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  globalThis.Event = class {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  globalThis.XPathResult = { FIRST_ORDERED_NODE_TYPE: 0 };
  globalThis.CSS = { escape(value) { return String(value); } };
  globalThis.document = {
    body: { appendChild() {} },
    documentElement: {},
    title: 'Test',
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getElementById() {
      return null;
    },
  };
  globalThis.location = { hostname: 'example.com', href: 'https://example.com' };
  globalThis.chrome = {
    runtime: {
      getURL(relativePath) {
        return new URL(`../${relativePath}`, import.meta.url).href;
      },
      onMessage: {
        addListener() {},
      },
      sendMessage: async () => ({ success: false }),
    },
  };

  const moduleUrl = new URL(`../content/form-filler.js?test=${Date.now()}_${Math.random()}`, import.meta.url);
  await import(moduleUrl.href);

  return {
    debug: globalThis.window.__jobpilotFormFillerDebug,
    MockElement,
    MockInputElement,
  };
}

function loadAdapterFromSource(source, filename) {
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

  vm.runInNewContext(source, sandbox, { filename });
  assert.equal(registered.length, 1, `${filename} should register exactly once`);
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
      adapterDiagnostics: {
        triggerAttempts: [
          { section: 'awards', outcome: 'trigger_not_found', score: 0 },
        ],
      },
      warnings: ['familyMembers:dom_not_changed'],
    }),
  ]);
  const summary = summarizeFillReport(merged);

  assert.equal(merged.adapterUsed, 'china-taiping');
  assert.equal(merged.unmappedValues.length, 1);
  assert.equal(merged.repeatSections[0].created, 1);
  assert.equal(merged.adapterDiagnostics.triggerAttempts.length, 1);
  assert.equal(summary.triggerAttemptCount, 1);
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

test('antgroup adapter matches site and maps direct field names', () => {
  const adapter = loadAntGroupAdapter();
  const profile = normalizeProfile({
    name: '张三',
    phone: '13800138000',
    email: 'zhangsan@example.com',
    education: [
      {
        school: '上海交通大学',
        major: '计算机科学',
        degree: '本科',
      },
    ],
  });

  assert.equal(
    adapter.matches(
      { hostname: 'talent.antgroup.com' },
      { title: '蚂蚁集团招聘官网', body: { innerText: '校园招聘' } }
    ),
    true
  );

  const helpers = {
    getProfileValue(target, key) {
      const normalized = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current = target;
      for (const part of normalized) current = current?.[part];
      return current ?? null;
    },
    isSensitiveField() {
      return false;
    },
  };

  const basicName = adapter.matchField({
    field: { name: 'basic_name' },
    profile,
    helpers,
  });
  assert.equal(basicName?.matched, true);
  assert.equal(basicName?.key, 'personal.fullName');
  assert.equal(basicName?.value, '张三');

  const educationSchool = adapter.matchField({
    field: { name: 'editForm_educations_0_school' },
    profile,
    helpers,
  });
  assert.equal(educationSchool?.matched, true);
  assert.equal(educationSchool?.key, 'education[0].school');
  assert.equal(educationSchool?.value, '上海交通大学');
});

test('generic label matcher handles weak labels, date ranges, and generic site fields', async () => {
  const { matchField } = await loadLabelMatcher();
  const profile = normalizeProfile({
    personal: {
      gender: '男',
      nationality: '中国',
    },
    identity: {
      documentNumber: '110101199001011234',
    },
    contact: {
      qq: '12345678',
    },
    residency: {
      currentCity: '上海',
    },
    education: [
      {
        startDate: '2022-09',
        endDate: '2026-06',
        customFields: {
          academy: '计算机学院',
        },
      },
    ],
    experience: [
      {
        startDate: '2025-06',
        endDate: '2025-08',
      },
    ],
    projects: [
      {
        role: '后端开发',
        startDate: '2024-03',
        endDate: '2024-12',
      },
    ],
    awards: [
      {
        name: '国家奖学金',
        year: '2024-11',
        description: '专业第一',
      },
    ],
    languages: [
      {
        language: '英语',
        proficiency: '熟练',
      },
    ],
    languageExams: [
      {
        examType: 'CET-6',
        score: '520',
      },
    ],
    competitions: [
      {
        name: '中国大学生服务外包创新创业大赛',
        level: '国家级',
        award: '二等奖',
        description: '负责后端服务与数据接口设计',
      },
    ],
    developerLanguages: [
      {
        name: 'Python',
        level: '熟练',
      },
    ],
    jobPreferences: {
      interviewLocations: ['深圳'],
    },
    links: {
      website: 'https://example.com/portfolio',
    },
    selfIntro: '擅长工程化和跨团队协作。',
  });

  const counters = {};

  const genderField = matchField({
    id: 'gender',
    type: 'radio',
    label: '男',
    labelCandidates: ['男', '性别*', '女'],
    sectionLabel: '基础信息',
  }, profile, counters);
  assert.equal(genderField?.matched, true);
  assert.equal(genderField?.key, 'personal.gender');
  assert.equal(genderField?.value, '男');

  const idNumberField = matchField({
    id: 'id_number',
    type: 'text',
    label: '中国-居民身份证护照',
    placeholder: '请填写您的证件号码',
    labelCandidates: ['个人证件*', '国家/地区*'],
    sectionLabel: '证件信息',
  }, profile, counters);
  assert.equal(idNumberField?.matched, true);
  assert.equal(idNumberField?.key, 'identity.documentNumber');
  assert.equal(idNumberField?.value, '110101199001011234');

  const qqField = matchField({
    id: 'qq',
    type: 'text',
    label: 'QQ号*',
    placeholder: '请输入QQ号',
    labelCandidates: ['QQ号*', '微信号*'],
    sectionLabel: '基础信息',
  }, profile, counters);
  assert.equal(qqField?.matched, true);
  assert.equal(qqField?.key, 'contact.qq');
  assert.equal(qqField?.value, '12345678');

  const educationStartField = matchField({
    id: 'edu_start',
    type: 'text',
    label: '起止时间*',
    placeholder: '选择日期',
    labelCandidates: ['起止时间*', '学校名称*'],
    sectionLabel: '当前教育经历',
    selector: '#app > div > div:nth-of-type(2) > div > div:nth-of-type(4) > div:nth-of-type(2) > div:nth-of-type(1) > input',
  }, profile, counters);
  assert.equal(educationStartField?.matched, true);
  assert.equal(educationStartField?.key, 'education[0].startDate');
  assert.equal(educationStartField?.value, '2022-09');
  assert.equal(educationStartField?.matchMethod, 'structural');

  const educationEndField = matchField({
    id: 'edu_end',
    type: 'text',
    label: '起止时间*',
    placeholder: '选择日期',
    labelCandidates: ['起止时间*', '学校名称*'],
    sectionLabel: '当前教育经历',
    selector: '#app > div > div:nth-of-type(2) > div > div:nth-of-type(4) > div:nth-of-type(2) > div:nth-of-type(2) > input',
  }, profile, counters);
  assert.equal(educationEndField?.matched, true);
  assert.equal(educationEndField?.key, 'education[0].endDate');
  assert.equal(educationEndField?.value, '2026-06');

  const projectRoleField = matchField({
    id: 'project_role',
    type: 'text',
    label: '在项目中担任的角色*',
    placeholder: '请输入在项目中担任的角色',
    labelCandidates: ['在项目中担任的角色*', '项目名称*'],
    sectionLabel: '项目经历-1',
  }, profile, counters);
  assert.equal(projectRoleField?.matched, true);
  assert.equal(projectRoleField?.key, 'projects[0].role');
  assert.equal(projectRoleField?.value, '后端开发');

  const bytedanceProjectNameField = matchField({
    id: 'project_name',
    type: 'text',
    label: '项目名称*',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-project_list > div > div > div > div > div:nth-of-type(1) > div > div:nth-of-type(1) > div:nth-of-type(2) > div > div > div > label > div > input',
  }, profile, counters);
  assert.equal(bytedanceProjectNameField?.matched, true);
  assert.equal(bytedanceProjectNameField?.key, 'projects[0].name');

  const bytedanceProjectRoleField = matchField({
    id: 'project_role_bytedance',
    type: 'text',
    label: '项目角色',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-role > div:nth-of-type(2) > div > div > div > label > div > input',
  }, profile, counters);
  assert.equal(bytedanceProjectRoleField?.matched, true);
  assert.equal(bytedanceProjectRoleField?.key, 'projects[0].role');

  const bytedanceLanguageField = matchField({
    id: 'language_name_bytedance',
    type: 'search',
    label: '语言*',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-language > div:nth-of-type(2) > div > div > div > div > div:nth-of-type(1) > div:nth-of-type(2) > input',
  }, profile, counters);
  assert.equal(bytedanceLanguageField?.matched, true);
  assert.equal(bytedanceLanguageField?.key, 'languages[0].language');

  const bytedanceLanguageLevelField = matchField({
    id: 'language_level_bytedance',
    type: 'search',
    label: '精通程度*',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-proficiency > div:nth-of-type(2) > div > div > div > div > div:nth-of-type(1) > div:nth-of-type(2) > input',
  }, profile, counters);
  assert.equal(bytedanceLanguageLevelField?.matched, true);
  assert.equal(bytedanceLanguageLevelField?.key, 'languages[0].proficiency');

  const bytedanceBasicNameField = matchField({
    id: 'bytedance_name',
    type: 'text',
    label: '姓名*',
    labelCandidates: ['姓名', '手机号码*+86', '手机号码*'],
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-name > div:nth-of-type(2) > div > div > div > label > div > input',
  }, profile, counters);
  assert.equal(bytedanceBasicNameField?.matched, true);
  assert.equal(bytedanceBasicNameField?.key, 'personal.fullName');

  const bytedanceBasicPhoneField = matchField({
    id: 'bytedance_mobile',
    type: 'text',
    label: '手机号码*',
    labelCandidates: ['手机号码', '姓名*', '邮箱*'],
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-mobile > div:nth-of-type(2) > div > div > span > div:nth-of-type(2) > label > div > input',
  }, profile, counters);
  assert.equal(bytedanceBasicPhoneField?.matched, true);
  assert.equal(bytedanceBasicPhoneField?.key, 'contact.phone');

  const bytedanceBasicEmailField = matchField({
    id: 'bytedance_email',
    type: 'text',
    label: '邮箱*',
    labelCandidates: ['邮箱', '手机号码*+86', '姓名*'],
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-email > div:nth-of-type(2) > div > div > div > label > div > input',
  }, profile, counters);
  assert.equal(bytedanceBasicEmailField?.matched, true);
  assert.equal(bytedanceBasicEmailField?.key, 'contact.email');

  const awardNameField = matchField({
    id: 'award_name',
    type: 'text',
    label: '奖项名称*',
    placeholder: '请输入奖项名称',
    labelCandidates: ['奖项名称*', '获奖类型*'],
    sectionLabel: '获奖信息-1',
  }, profile, counters);
  assert.equal(awardNameField?.matched, true);
  assert.equal(awardNameField?.key, 'awards[0].name');
  assert.equal(awardNameField?.value, '国家奖学金');

  const websiteField = matchField({
    id: 'website',
    type: 'text',
    label: '个人主页链接',
    placeholder: '请输入个人主页超链接',
    labelCandidates: ['个人主页链接', '作品或个人主页'],
    sectionLabel: '技能信息',
  }, profile, counters);
  assert.equal(websiteField?.matched, true);
  assert.equal(websiteField?.key, 'links.website');
  assert.equal(websiteField?.value, 'https://example.com/portfolio');

  const paperField = matchField({
    id: 'paper',
    type: 'textarea',
    label: '论文',
    placeholder: '请输入论文',
    labelCandidates: ['论文', '研究方向', '导师 *'],
    sectionLabel: '当前教育经历',
  }, profile, counters);
  assert.equal(paperField?.matched, true);
  assert.equal(paperField?.key, 'education[0].customFields.papers');

  const tutorField = matchField({
    id: 'tutor',
    type: 'text',
    label: '导师',
    placeholder: '请输入导师姓名',
    labelCandidates: ['导师', '领域方向', '实验室'],
    sectionLabel: '当前教育经历',
  }, profile, counters);
  assert.equal(tutorField?.matched, true);
  assert.equal(tutorField?.key, 'education[0].customFields.tutor');

  const languageField = matchField({
    id: 'language_exam',
    type: 'text',
    label: '外语考试/等级*',
    placeholder: '请填写分数',
    labelCandidates: ['外语考试/等级*', '技能信息'],
    sectionLabel: '技能信息',
  }, profile, counters);
  assert.equal(languageField?.matched, true);
  assert.equal(languageField?.key, 'languageExams[0].score');
  assert.equal(languageField?.value, '520');

  const interviewCityField = matchField({
    id: 'interview_city',
    type: 'text',
    label: '参加面试城市*',
    placeholder: '请选择或输入城市',
    labelCandidates: ['参加面试城市*', '面试城市'],
    sectionLabel: '求职偏好',
  }, profile, counters);
  assert.equal(interviewCityField?.matched, true);
  assert.equal(interviewCityField?.key, 'jobPreferences.interviewLocations');
  assert.equal(interviewCityField?.value, '深圳');

  const competitionField = matchField({
    id: 'competition_level',
    type: 'text',
    label: '大赛等级',
    placeholder: '请输入大赛等级',
    labelCandidates: ['大赛等级', '大赛经历'],
    sectionLabel: '大赛经历',
  }, profile, counters);
  assert.equal(competitionField?.matched, true);
  assert.equal(competitionField?.key, 'competitions[0].level');
  assert.equal(competitionField?.value, '国家级');

  const competitionNameField = matchField({
    id: 'competition_name_bytedance',
    type: 'search',
    label: '竞赛名称*',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-competition_list > div > div > div > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(1) > div:nth-of-type(2) > div > div > div > div > div:nth-of-type(1) > div:nth-of-type(2) > input',
  }, profile, counters);
  assert.equal(competitionNameField?.matched, true);
  assert.equal(competitionNameField?.key, 'competitions[0].name');
  assert.equal(competitionNameField?.value, profile.competitions[0].name);

  const competitionDescriptionField = matchField({
    id: 'competition_description_bytedance',
    type: 'textarea',
    label: '描述',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-contest_describe > div:nth-of-type(2) > div > div > div > textarea',
  }, profile, counters);
  assert.equal(competitionDescriptionField?.matched, true);
  assert.equal(competitionDescriptionField?.key, 'competitions[0].description');
  assert.equal(competitionDescriptionField?.value, profile.competitions[0].description);

  const developerLanguageField = matchField({
    id: 'developer_language',
    type: 'text',
    label: '开发语言*',
    placeholder: '请输入编程语言',
    labelCandidates: ['开发语言*', '编程语言'],
    sectionLabel: '技术能力',
  }, profile, counters);
  assert.equal(developerLanguageField?.matched, true);
  assert.equal(developerLanguageField?.key, 'developerLanguages[0].name');
  assert.equal(developerLanguageField?.value, 'Python');

  const selfIntroField = matchField({
    id: 'self_intro',
    type: 'textarea',
    label: '补充信息*',
    placeholder: '请输入其他相关信息',
    labelCandidates: ['补充信息*', '其他关键信息'],
    sectionLabel: '补充信息*',
  }, profile, counters);
  assert.equal(selfIntroField?.matched, true);
  assert.equal(selfIntroField?.key, 'selfIntro');
  assert.equal(selfIntroField?.value, '擅长工程化和跨团队协作。');
});

test('semantic field memory learns successful field shapes and recalls them by similarity', () => {
  const memory = learnSemanticFieldMemory([], [
    buildSemanticFieldSample({
      type: 'text',
      label: '牛客意向岗位',
      labelCandidates: ['牛客意向岗位', '目标岗位'],
      placeholder: '请输入岗位名称',
      sectionLabel: '求职偏好',
      contextText: '请填写意向岗位',
    }, 'jobPreferences.expectedPositions', {
      hostname: 'campus.nowcoder.com',
    }),
  ]);

  const candidates = rankSemanticFieldCandidates({
    type: 'text',
    label: '牛客意向岗位',
    labelCandidates: ['目标岗位'],
    placeholder: '请输入岗位名称',
    sectionLabel: '求职偏好',
  }, memory, {
    hostname: 'join.qq.com',
  });

  assert.equal(candidates[0]?.key, 'jobPreferences.expectedPositions');
  assert.ok(candidates[0]?.score > 5);
});

test('semantic field memory extracts learnable samples from debug exports', () => {
  const extracted = extractSemanticSamplesFromDebugExport({
    page: { hostname: 'join.qq.com' },
    matched: [
      {
        key: 'personal.fullName',
        isFile: false,
        field: {
          type: 'text',
          label: '姓名*',
          placeholder: '请输入姓名',
          sectionLabel: '基础信息',
        },
      },
      {
        key: '_resumeFile',
        isFile: true,
        field: {
          type: 'file',
          label: '上传简历',
        },
      },
    ],
    unmatched: [
      {
        normalizedKey: 'education[0].ranking',
        reason: 'missing_profile_value',
        field: {
          type: 'text',
          label: '成绩排名',
          placeholder: '请选择',
          sectionLabel: '当前教育经历',
        },
      },
      {
        normalizedKey: 'projects[0].role',
        reason: 'none',
        field: {
          type: 'text',
          label: '在项目中担任的角色*',
        },
      },
    ],
  });

  assert.equal(extracted.stats.hostname, 'join.qq.com');
  assert.equal(extracted.stats.matchedLearned, 1);
  assert.equal(extracted.stats.unmatchedLearned, 1);
  assert.equal(extracted.samples.length, 2);
  assert.equal(extracted.samples[0].key, 'personal.fullName');
  assert.equal(extracted.samples[1].key, 'education[].ranking');
});

test('generic label matcher can use learned semantic memory for unknown site labels', async () => {
  const { matchField } = await loadLabelMatcher();
  const profile = normalizeProfile({
    jobPreferences: {
      expectedPositions: ['后端开发工程师'],
    },
  });
  const semanticMemory = learnSemanticFieldMemory([], [
    buildSemanticFieldSample({
      type: 'text',
      label: '牛客意向岗位',
      labelCandidates: ['牛客意向岗位', '目标岗位'],
      placeholder: '请输入岗位名称',
      sectionLabel: '求职偏好',
    }, 'jobPreferences.expectedPositions', {
      hostname: 'campus.nowcoder.com',
    }),
  ]);

  const result = matchField({
    id: 'desired_position',
    type: 'text',
    label: '牛客意向岗位',
    labelCandidates: ['目标岗位'],
    placeholder: '请输入岗位名称',
    sectionLabel: '求职偏好',
  }, profile, {}, null, {
    semanticMemory,
    hostname: 'join.qq.com',
    semanticFieldMemoryModule: {
      rankSemanticFieldCandidates,
      selectSemanticFieldCandidate,
    },
  });

  assert.equal(result?.matched, true);
  assert.equal(result?.key, 'jobPreferences.expectedPositions');
  assert.equal(result?.matchMethod, 'semantic_memory');
  assert.equal(result?.value, '后端开发工程师');
});

test('generic label matcher maps choice-like identification controls to document type', async () => {
  const { matchField } = await loadLabelMatcher();
  const profile = normalizeProfile({
    identity: {
      documentType: 'Passport',
      documentNumber: '110101199001011234',
    },
  });

  const result = matchField({
    id: 'identification_type',
    type: 'text',
    label: 'Identification',
    labelCandidates: ['Document type'],
    selector: '#formily-item-identification_type [role="combobox"]',
    options: [{ value: 'Passport', text: 'Passport' }],
  }, profile, {});

  assert.equal(result?.matched, true);
  assert.equal(result?.key, 'identity.documentType');
  assert.equal(result?.value, 'Passport');
});

test('generic label matcher assigns date ranges sequentially for repeated time_period controls', async () => {
  const { matchField } = await loadLabelMatcher();
  const profile = normalizeProfile({
    experience: [
      {
        company: 'ByteDance',
        title: 'Software Engineer Intern',
        startDate: '2024-06',
        endDate: '2024-09',
      },
    ],
  });
  const counters = {};

  const startField = {
    id: 'career_time_period_start',
    type: 'text',
    label: 'Start & end date',
    labelCandidates: ['Time period'],
    selector: '#formily-item-career_list [name="time_period"] input',
    repeatGroupKey: 'career-0',
  };
  const endField = {
    id: 'career_time_period_end',
    type: 'text',
    label: 'Start & end date',
    labelCandidates: ['Time period'],
    selector: '#formily-item-career_list [name="time_period"] input',
    repeatGroupKey: 'career-0',
  };

  const first = matchField(startField, profile, counters);
  const second = matchField(endField, profile, counters);

  assert.equal(first?.matched, true);
  assert.equal(first?.key, 'experience[0].startDate');
  assert.equal(first?.value, '2024-06');
  assert.equal(second?.matched, true);
  assert.equal(second?.key, 'experience[0].endDate');
  assert.equal(second?.value, '2024-09');
});

test('generic label matcher derives repeat indices from Bytedance list selectors when repeatGroupKey is shared', async () => {
  const { matchField } = await loadLabelMatcher();
  const profile = normalizeProfile({
    education: [
      {
        school: 'Tsinghua University',
        degree: 'Bachelor',
      },
      {
        school: 'Peking University',
        degree: 'Master',
      },
    ],
    projects: [
      {
        name: 'JobPilot',
        role: 'Backend Developer',
      },
      {
        name: 'Resume Agent',
        role: 'Automation Engineer',
      },
    ],
  });
  const counters = {};
  const sharedRepeatGroupKey = 'bytedance-form-root';

  const firstEducationSchool = matchField({
    id: 'edu_school_0',
    type: 'text',
    label: 'School Name*',
    sectionLabel: 'Basic Information',
    selector: '#formily-item-education_list > div > div > div > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(3) > div:nth-of-type(2) > div > div > div > div > div > label > div > input',
    repeatGroupKey: sharedRepeatGroupKey,
  }, profile, counters);
  const secondEducationSchool = matchField({
    id: 'edu_school_1',
    type: 'text',
    label: 'School Name*',
    sectionLabel: 'Basic Information',
    selector: '#formily-item-education_list > div > div > div > div:nth-of-type(2) > div:nth-of-type(1) > div > div:nth-of-type(3) > div:nth-of-type(2) > div > div > div > div > div > label > div > input',
    repeatGroupKey: sharedRepeatGroupKey,
  }, profile, counters);
  const firstProjectName = matchField({
    id: 'project_name_0',
    type: 'text',
    label: 'Project Name*',
    sectionLabel: 'Basic Information',
    selector: '#formily-item-project_list > div > div > div > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(1) > div:nth-of-type(2) > div > div > div > label > div > input',
    repeatGroupKey: sharedRepeatGroupKey,
  }, profile, counters);
  const secondProjectName = matchField({
    id: 'project_name_1',
    type: 'text',
    label: 'Project Name*',
    sectionLabel: 'Basic Information',
    selector: '#formily-item-project_list > div > div > div > div:nth-of-type(2) > div:nth-of-type(1) > div > div:nth-of-type(1) > div:nth-of-type(2) > div > div > div > label > div > input',
    repeatGroupKey: sharedRepeatGroupKey,
  }, profile, counters);

  assert.equal(firstEducationSchool?.key, 'education[0].school');
  assert.equal(firstEducationSchool?.value, 'Tsinghua University');
  assert.equal(secondEducationSchool?.key, 'education[1].school');
  assert.equal(secondEducationSchool?.value, 'Peking University');
  assert.equal(firstProjectName?.key, 'projects[0].name');
  assert.equal(firstProjectName?.value, 'JobPilot');
  assert.equal(secondProjectName?.key, 'projects[1].name');
  assert.equal(secondProjectName?.value, 'Resume Agent');
});

test('generic label matcher suppresses phone search helpers when a text input sibling carries the actual number', async () => {
  const { matchForms } = await loadLabelMatcher();
  const profile = normalizeProfile({
    contact: {
      phone: '13800138000',
    },
  });

  const result = await matchForms({
    forms: [
      {
        id: 'form_0',
        fields: [
          {
            id: 'mobile_search',
            type: 'search',
            label: '手机号码*',
            labelCandidates: ['手机号码', '姓名*', '邮箱*'],
            sectionLabel: '基本信息请填写基本信息',
            selector: '#formily-item-mobile > div:nth-of-type(2) > div > div > span > div:nth-of-type(1) > div > div:nth-of-type(1) > div:nth-of-type(2) > input',
            repeatGroupKey: 'basic-form',
          },
          {
            id: 'mobile_text',
            type: 'text',
            label: '手机号码*',
            labelCandidates: ['手机号码', '姓名*', '邮箱*'],
            sectionLabel: '基本信息请填写基本信息',
            selector: '#formily-item-mobile > div:nth-of-type(2) > div > div > span > div:nth-of-type(2) > label > div > input',
            repeatGroupKey: 'basic-form',
          },
        ],
      },
    ],
  }, profile);

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0]?.key, 'contact.phone');
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.diagnostics.unmappedFields.length, 0);
});

test('generic label matcher skips absence toggles when the profile already has data for that section', async () => {
  const { matchForms } = await loadLabelMatcher();
  const profile = normalizeProfile({
    experience: [
      {
        company: 'ByteDance',
        title: 'Software Engineer Intern',
      },
    ],
  });

  const result = await matchForms({
    forms: [
      {
        id: 'form_0',
        fields: [
          {
            id: 'no_internship',
            type: 'checkbox',
            label: '没有实习经历',
            labelCandidates: ['没有实习经历', '实习经历'],
            sectionLabel: '实习经历',
          },
        ],
      },
    ],
  }, profile);

  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.diagnostics.unmappedFields.length, 0);
  assert.equal(result.diagnostics.missingRequiredFields.length, 0);
});

test('base adapter infers repeat section keys from key path and labels', () => {
  const base = loadSiteAdapterBase();

  assert.equal(base.inferSectionKeyFromField({ key: 'experience[0].company' }), 'experience');
  assert.equal(base.inferSectionKeyFromField({
    field: {
      sectionLabel: 'Language Exams',
      label: 'Exam Type',
      labelCandidates: ['Language Exam'],
    },
  }), 'languageExams');
  assert.equal(base.getSectionConfig('developerLanguages')?.keywords?.includes('programming language'), true);
  assert.equal(base.getSectionConfig('competitions')?.keywords?.includes('竞赛'), true);
});

test('site adapter registry falls back to the generic action engine for unknown sites', () => {
  const registry = loadSiteAdapterRegistry();
  const active = registry.__jobpilotGetSiteAdapter({
    document: {},
    location: { hostname: 'jobs.bytedance.com' },
  });

  assert.equal(active?.id, 'generic-action-engine');
  assert.equal(registry.__jobpilotListSiteAdapters().some(item => item.id === 'generic-action-engine'), true);
});

test('base adapter uses aria labels for add buttons and avoids unrelated generic add actions', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const unrelatedHeading = new MockElement({ tagName: 'h3', textContent: '教育经历' });
  const unrelatedAdd = new MockElement({
    tagName: 'button',
    textContent: '添加',
    parentElement: { parentElement: null },
    previousElementSibling: unrelatedHeading,
  });

  const languageHeading = new MockElement({ tagName: 'h3', textContent: '语言能力' });
  const languageAdd = new MockElement({
    tagName: 'button',
    attrs: { 'aria-label': '添加语言能力' },
    parentElement: { parentElement: null },
    previousElementSibling: languageHeading,
  });

  sandbox.document.querySelectorAll = selector => {
    if (selector === '[id$="_addButton"]') return [];
    return [unrelatedAdd, languageAdd];
  };

  assert.equal(base.getElementText(languageAdd), '添加语言能力');
  assert.equal(
    base.findRepeatAddButton({
      sectionRoot: sandbox.document,
      keywords: ['语言能力'],
      buttonPatterns: [/(添加|新增).{0,6}(语言|外语)/i],
    }),
    languageAdd
  );
  assert.equal(
    base.findRepeatAddButton({
      sectionRoot: sandbox.document,
      keywords: ['语言考试'],
      buttonPatterns: [/(添加|新增).{0,6}(考试|成绩|外语)/i],
    }),
    null
  );
});

test('base adapter recognizes class-only add buttons used by structured form builders', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const heading = new MockElement({ tagName: 'h3', textContent: 'Project Experience' });
  const addButton = new MockElement({
    tagName: 'div',
    attrs: { class: 'createFormSection-addBtn addMore__3y7Bz', tabindex: '0' },
    parentElement: { parentElement: null },
    previousElementSibling: heading,
  });

  sandbox.document.querySelectorAll = selector => {
    if (selector === '[id$="_addButton"]') return [];
    return [addButton];
  };

  assert.equal(
    base.findRepeatAddButton({
      sectionRoot: sandbox.document,
      keywords: ['Project Experience'],
      buttonPatterns: [/\b(add|new|append)\b.{0,12}\b(project|practice)\b/i],
    }),
    addButton
  );
});

test('base adapter recognizes generic add buttons with only localized add text', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const heading = new MockElement({ tagName: 'h3', textContent: 'Education Experience' });
  const addButton = new MockElement({
    tagName: 'button',
    textContent: '\u6dfb\u52a0',
    attrs: { class: 'ud__button ud__button--text' },
    parentElement: { parentElement: null },
    previousElementSibling: heading,
  });
  const wrapper = new MockElement({ tagName: 'div', textContent: 'Education Experience Add' });
  wrapper.querySelectorAll = selector => {
    if (selector.includes('button')) return [addButton];
    return [];
  };

  addButton.parentElement = wrapper;

  assert.equal(
    base.findRepeatAddButton({
      sectionRoot: wrapper,
      keywords: ['Education Experience'],
      buttonPatterns: [],
    }),
    addButton
  );
});

test('base adapter tries multiple section triggers until one reveals the hidden section', async () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;
  const adapter = new base.BaseSiteAdapter({ id: 'generic-action-engine' });
  let sectionVisible = false;

  sandbox.setTimeout = fn => {
    fn();
    return 0;
  };
  sandbox.clearTimeout = () => {};

  const sectionTitle = new MockElement({
    tagName: 'div',
    textContent: 'Awards',
    attrs: { class: 'applyFormModuleWrapper-title' },
  });
  const sectionWrapper = new MockElement({
    tagName: 'div',
    textContent: 'Awards Add',
    attrs: { class: 'applyFormModuleWrapper-windows' },
  });
  sectionWrapper.querySelector = selector => selector.includes('applyFormModuleWrapper-title') ? sectionTitle : null;
  sectionWrapper.querySelectorAll = () => [];

  const firstTrigger = new MockElement({
    tagName: 'div',
    textContent: 'Awards',
    attrs: { class: 'collapse-header', 'aria-expanded': 'false' },
  });
  const secondTrigger = new MockElement({
    tagName: 'button',
    textContent: 'Awards',
    attrs: { class: 'generic-trigger' },
  });
  firstTrigger.click = () => {};
  secondTrigger.click = () => {
    sectionVisible = true;
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) {
      return sectionVisible ? [sectionWrapper] : [];
    }
    if (selector.includes('[role="tab"]') || selector.includes('button') || selector.includes('span') || selector.includes('div')) {
      return [firstTrigger, secondTrigger];
    }
    return [];
  };

  const result = await adapter.ensureSectionVisible('awards', {
    keywords: ['Awards'],
    triggerPatterns: [/\bawards?\b/i],
  });

  assert.equal(result.activated, true);
  assert.equal(result.reason, 'activated');
  assert.equal(adapter.getRuntimeDiagnostics().triggerAttempts.length, 2);
  assert.equal(adapter.getRuntimeDiagnostics().triggerAttempts[0].outcome, 'no_effect');
  assert.equal(adapter.getRuntimeDiagnostics().triggerAttempts[1].outcome, 'activated');
  assert.ok(adapter.getRuntimeDiagnostics().triggerAttempts[1].score > adapter.getRuntimeDiagnostics().triggerAttempts[0].score);
});

test('base adapter reports section unavailable when a repeat section does not exist on the page', async () => {
  const base = loadSiteAdapterBase();
  const adapter = new base.BaseSiteAdapter({ id: 'generic-action-engine' });

  adapter.ensureSectionVisible = async () => ({ activated: false, reason: 'trigger_not_found' });

  const result = await adapter.ensureRepeatItemGeneric({
    sectionKey: 'awards',
    index: 0,
    keywords: ['Awards', 'Honors'],
    buttonPatterns: [/\b(add|new)\b.{0,12}\b(award|honor)\b/i],
    triggerPatterns: [/\bawards?\b|\bhonors?\b/i],
  });

  assert.equal(result.created, false);
  assert.equal(result.reason, 'awards_section_unavailable_on_page:trigger_not_found');
});

test('base adapter records diagnostics when a section is already visible or no trigger exists', async () => {
  const base = loadSiteAdapterBase();
  const adapter = new base.BaseSiteAdapter({ id: 'generic-action-engine' });
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const title = new MockElement({
    tagName: 'div',
    textContent: 'Awards',
    attrs: { class: 'applyFormModuleWrapper-title' },
  });
  const addButton = new MockElement({
    tagName: 'button',
    textContent: 'Add Award',
    attrs: { class: 'add-award-button' },
  });
  const wrapper = new MockElement({
    tagName: 'div',
    textContent: 'Awards Add Award',
    attrs: { class: 'applyFormModuleWrapper-windows' },
  });
  title.parentElement = wrapper;
  addButton.parentElement = wrapper;
  wrapper.querySelector = selector => {
    if (selector.includes('applyFormModuleWrapper-title')) return title;
    return null;
  };
  wrapper.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('div')) return [title, addButton];
    if (selector.includes('input') || selector.includes('textarea')) return [];
    return [];
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) return [wrapper];
    if (selector.includes('button') || selector.includes('div')) return [title, addButton];
    return [];
  };

  const visibleResult = await adapter.ensureSectionVisible('awards', {
    keywords: ['Awards'],
    triggerPatterns: [/\bawards?\b/i],
  });

  assert.equal(visibleResult.reason, 'already_visible');
  assert.equal(adapter.getRuntimeDiagnostics().triggerAttempts[0].outcome, 'already_visible');

  adapter.beforeFill();
  sandbox.document.querySelectorAll = () => [];

  const missingResult = await adapter.ensureSectionVisible('awards', {
    keywords: ['Awards'],
    triggerPatterns: [/\bawards?\b/i],
  });

  assert.equal(missingResult.reason, 'trigger_not_found');
  assert.equal(adapter.getRuntimeDiagnostics().triggerAttempts[0].outcome, 'trigger_not_found');
});

test('base adapter does not mistake trigger bars for visible section containers', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const noopTrigger = new MockElement({
    tagName: 'div',
    textContent: 'Awards',
    attrs: { class: 'collapse-header', 'aria-expanded': 'false', id: 'awards-noop-trigger' },
  });
  const revealTrigger = new MockElement({
    tagName: 'button',
    textContent: 'Awards',
    attrs: { class: 'generic-trigger', id: 'awards-reveal-trigger' },
  });
  const triggerBar = new MockElement({
    tagName: 'div',
    textContent: 'Awards Awards',
    attrs: { class: 'trigger-bar' },
  });
  noopTrigger.parentElement = triggerBar;
  revealTrigger.parentElement = triggerBar;
  triggerBar.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('div')) return [noopTrigger, revealTrigger];
    return [];
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) return [];
    if (selector.includes('h1') || selector.includes('label') || selector.includes('[id]')) return [noopTrigger, revealTrigger];
    return [];
  };

  assert.equal(base.findSectionContainer(['Awards']), null);
});

test('base adapter ignores descendants inside hidden section containers', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const hiddenTitle = new MockElement({
    tagName: 'div',
    textContent: 'Awards',
    attrs: { class: 'applyFormModuleWrapper-title' },
  });
  const hiddenAdd = new MockElement({
    tagName: 'button',
    textContent: 'Add Award',
    attrs: { class: 'add-award-button' },
  });
  const hiddenWrapper = new MockElement({
    tagName: 'section',
    textContent: 'Awards Add Award',
    attrs: { class: 'applyFormModuleWrapper-windows', hidden: '' },
  });
  hiddenTitle.parentElement = hiddenWrapper;
  hiddenAdd.parentElement = hiddenWrapper;
  hiddenWrapper.querySelector = selector => {
    if (selector.includes('applyFormModuleWrapper-title')) return hiddenTitle;
    return null;
  };
  hiddenWrapper.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('div')) return [hiddenTitle, hiddenAdd];
    return [];
  };

  const trigger = new MockElement({
    tagName: 'button',
    textContent: 'Awards',
    attrs: { class: 'generic-trigger' },
  });
  const main = new MockElement({ tagName: 'main', textContent: 'Awards Add Award' });
  trigger.parentElement = main;
  hiddenWrapper.parentElement = main;
  main.querySelectorAll = selector => {
    if (selector.includes('button') || selector.includes('div')) return [trigger, hiddenTitle, hiddenAdd];
    return [];
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) return [hiddenWrapper];
    if (selector.includes('h1') || selector.includes('label') || selector.includes('[id]')) return [trigger, hiddenTitle];
    return [];
  };

  assert.equal(base.findSectionContainer(['Awards']), null);
});

test('base adapter prefers the only add button inside the target section root even when parent has other add buttons', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const sectionAdd = new MockElement({
    tagName: 'button',
    textContent: '\u6dfb\u52a0',
    attrs: { class: 'ud__button ud__button--text' },
  });
  const otherAdd = new MockElement({
    tagName: 'button',
    textContent: '\u6dfb\u52a0',
    attrs: { class: 'ud__button ud__button--text' },
  });
  const wrapper = new MockElement({ tagName: 'div', textContent: 'Education Experience Add' });
  const parent = new MockElement({ tagName: 'div', textContent: 'Education Experience Add Projects Add' });

  wrapper.parentElement = parent;
  sectionAdd.parentElement = wrapper;
  otherAdd.parentElement = parent;
  wrapper.querySelectorAll = selector => {
    if (selector.includes('button')) return [sectionAdd];
    return [];
  };
  parent.querySelectorAll = selector => {
    if (selector.includes('button')) return [sectionAdd, otherAdd];
    return [];
  };

  assert.equal(
    base.findRepeatAddButton({
      sectionRoot: wrapper,
      keywords: ['Education Experience'],
      buttonPatterns: [],
    }),
    sectionAdd
  );
});

test('base adapter prefers module wrappers whose title matches the target section', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const educationTitle = new MockElement({ tagName: 'div', textContent: '教育经历', attrs: { class: 'applyFormModuleWrapper-title' } });
  const educationAdd = new MockElement({ tagName: 'button', textContent: '添加' });
  const educationWrapper = new MockElement({ tagName: 'div', attrs: { class: 'applyFormModuleWrapper-windows' }, textContent: '教育经历 添加' });
  educationWrapper.querySelector = selector => {
    if (selector.includes('applyFormModuleWrapper-title')) return educationTitle;
    if (selector.includes('button')) return educationAdd;
    return null;
  };
  educationWrapper.querySelectorAll = selector => {
    if (selector.includes('button')) return [educationAdd];
    return [];
  };

  const projectTitle = new MockElement({ tagName: 'div', textContent: 'Project Experience', attrs: { class: 'applyFormModuleWrapper-title' } });
  const projectAdd = new MockElement({ tagName: 'button', textContent: 'Add' });
  const projectWrapper = new MockElement({ tagName: 'div', attrs: { class: 'applyFormModuleWrapper-windows' }, textContent: 'Project Experience Add' });
  projectWrapper.querySelector = selector => {
    if (selector.includes('applyFormModuleWrapper-title')) return projectTitle;
    if (selector.includes('button')) return projectAdd;
    return null;
  };
  projectWrapper.querySelectorAll = selector => {
    if (selector.includes('button')) return [projectAdd];
    return [];
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) return [projectWrapper, educationWrapper];
    return [];
  };

  assert.equal(base.findSectionContainer(['教育经历']), educationWrapper);
  assert.equal(base.getSectionRoot(['Project Experience']), projectWrapper);
});

test('base adapter filters child title nodes from section wrapper candidates', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const sectionTitle = new MockElement({ tagName: 'div', textContent: 'Education Experience', attrs: { class: 'applyFormModuleWrapper-title' } });
  const sectionLeft = new MockElement({ tagName: 'div', textContent: 'Education Experience', attrs: { class: 'applyFormModuleWrapper-left' } });
  const addButton = new MockElement({ tagName: 'button', textContent: 'Add' });
  const wrapper = new MockElement({ tagName: 'div', attrs: { class: 'applyFormModuleWrapper-windows' }, textContent: 'Education Experience Add' });

  wrapper.querySelector = selector => {
    if (selector.includes('applyFormModuleWrapper-title')) return sectionTitle;
    if (selector.includes('applyFormModuleWrapper-left')) return sectionLeft;
    if (selector.includes('button')) return addButton;
    return null;
  };
  wrapper.querySelectorAll = selector => {
    if (selector.includes('button')) return [addButton];
    return [];
  };

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper')) return [sectionTitle, sectionLeft, wrapper];
    return [];
  };

  const wrappers = base.getSectionWrapperCandidates();
  assert.equal(wrappers.length, 1);
  assert.equal(wrappers[0], wrapper);
  assert.equal(base.findSectionContainer(['Education Experience']), wrapper);
});

test('base adapter keeps CJK text when normalizing comparable labels', () => {
  const base = loadSiteAdapterBase();

  assert.equal(base.normalizeComparableText('Education Experience'), 'educationexperience');
  assert.equal(base.normalizeComparableText('教育经历'), '教育经历');
  assert.equal(base.normalizeComparableText('教育经历 / Education Experience'), '教育经历educationexperience');
});

test('base adapter does not treat empty section titles as keyword matches', () => {
  const base = loadSiteAdapterBase();
  const { __sandbox: sandbox } = base;
  const MockElement = sandbox.Element;

  const wrapperTitle = new MockElement({ tagName: 'div', textContent: 'Education Experience', attrs: { class: 'applyFormModuleWrapper-title' } });
  const wrapper = new MockElement({ tagName: 'div', attrs: { class: 'applyFormModuleWrapper-windows' }, textContent: 'Education Experience Add' });
  wrapper.querySelector = selector => selector.includes('applyFormModuleWrapper-title') ? wrapperTitle : null;
  wrapper.querySelectorAll = () => [];

  const repeatCard = new MockElement({ tagName: 'div', attrs: { class: 'apply-form-array-card__hash' }, textContent: 'Add' });
  repeatCard.querySelector = () => null;
  repeatCard.querySelectorAll = () => [];

  sandbox.document.querySelectorAll = selector => {
    if (selector.includes('applyFormModuleWrapper') || selector.includes('apply-form-array-card')) {
      return [repeatCard, wrapper];
    }
    return [];
  };

  assert.equal(base.getSectionRoot(['Education Experience']), wrapper);
  assert.equal(base.findSectionContainer(['Education Experience']), wrapper);
});

test('form filler prefers start and end date inputs based on key timing hint', async () => {
  const { debug, MockElement, MockInputElement } = await loadFormFillerDebug();

  const wrapper = new MockElement({ tagName: 'div', textContent: '起止时间' });
  const startInput = new MockInputElement({
    tagName: 'input',
    attrs: { placeholder: '开始时间', name: 'internStart' },
    parentElement: wrapper,
  });
  const endInput = new MockInputElement({
    tagName: 'input',
    attrs: { placeholder: '结束时间', name: 'internEnd' },
    parentElement: wrapper,
  });

  wrapper.querySelectorAll = () => [startInput, endInput];
  startInput.closest = () => wrapper;
  endInput.closest = () => wrapper;

  const startEntry = {
    key: 'experience[0].startDate',
    field: {
      type: 'date',
      label: '起止时间',
      labelCandidates: ['起止时间*'],
    },
  };
  const endEntry = {
    key: 'experience[0].endDate',
    field: {
      type: 'date',
      label: '起止时间',
      labelCandidates: ['起止时间*'],
    },
  };

  assert.equal(debug.getFieldTimingHint(startEntry), 'start');
  assert.equal(debug.getFieldTimingHint(endEntry), 'end');
  assert.equal(debug.resolveDateTargetElement(startInput, startEntry), startInput);
  assert.equal(debug.resolveDateTargetElement(startInput, endEntry), endInput);
  assert.ok(debug.scoreElementForField(startInput, startEntry) > debug.scoreElementForField(endInput, startEntry));
  assert.ok(debug.scoreElementForField(endInput, endEntry) > debug.scoreElementForField(startInput, endEntry));
});

test('form filler recognizes language exam repeat sections from detect results', async () => {
  const { debug } = await loadFormFillerDebug();
  const detectResult = {
    forms: [
      {
        fields: [
          {
            type: 'text',
            label: '外语考试/等级',
            sectionLabel: '语言考试',
            repeatGroupKey: 'exam-0',
          },
          {
            type: 'text',
            label: '分数',
            sectionLabel: '语言考试',
            repeatGroupKey: 'exam-0',
          },
          {
            type: 'checkbox',
            label: '没有语言考试成绩',
            sectionLabel: '语言考试',
          },
        ],
      },
    ],
  };

  assert.equal(debug.inferRepeatSectionFromField(detectResult.forms[0].fields[0]), 'languageExams');
  assert.equal(debug.getRepeatCountFromDetect(detectResult, 'languageExams'), 1);

  assert.equal(debug.inferRepeatSectionFromField({
    type: 'search',
    label: '语言*',
    sectionLabel: '基本信息请填写基本信息',
    selector: '#formily-item-language > div:nth-of-type(2) > div > div > div > div > div:nth-of-type(1) > div:nth-of-type(2) > input',
  }), 'languages');

  assert.equal(debug.inferRepeatSectionFromField({
    type: 'text',
    label: '竞赛名称',
    sectionLabel: '竞赛',
    repeatGroupKey: 'competition-0',
  }), 'competitions');
});

test('form filler clears repeat creation warnings once final filled count reaches expected', async () => {
  const { debug } = await loadFormFillerDebug();
  const report = {
    repeatSections: [
      {
        section: 'education',
        expected: 2,
        filled: 2,
        warnings: ['education: repeat_item_created_but_not_detected', 'education: other_warning'],
      },
      {
        section: 'projects',
        expected: 2,
        filled: 1,
        warnings: ['projects: repeat_item_created_but_not_detected'],
      },
    ],
  };

  debug.reconcileRepeatSectionWarnings(report);

  assert.deepEqual(report.repeatSections[0].warnings, ['education: other_warning']);
  assert.deepEqual(report.repeatSections[1].warnings, ['projects: repeat_item_created_but_not_detected']);
});

test('normalizeProfile keeps qq contact data in the unified schema', () => {
  const normalized = normalizeProfile({
    qq: '87654321',
  });

  assert.equal(normalized.contact.qq, '87654321');
  assert.equal(normalized.qq, '87654321');
});

test('normalizeProfile preserves nested job preferences from structured input', () => {
  const normalized = normalizeProfile({
    jobPreferences: {
      expectedPositions: ['后端开发工程师'],
      expectedLocations: ['上海'],
    },
  });

  assert.deepEqual(normalized.jobPreferences.expectedPositions, ['后端开发工程师']);
  assert.deepEqual(normalized.jobPreferences.expectedLocations, ['上海']);
});

test('normalizeProfile keeps interview locations and new structured arrays', () => {
  const normalized = normalizeProfile({
    jobPreferences: {
      interviewLocations: ['深圳', '杭州'],
    },
    competitions: [
      { name: '挑战杯', level: '国家级', award: '二等奖' },
    ],
    developerLanguages: [
      { language: 'Python', proficiency: '熟练' },
    ],
  });

  assert.deepEqual(normalized.jobPreferences.interviewLocations, ['深圳', '杭州']);
  assert.equal(normalized.jobPreferences.interviewCity, '深圳, 杭州');
  assert.equal(normalized.competitions[0].level, '国家级');
  assert.equal(normalized.developerLanguages[0].name, 'Python');
  assert.equal(normalized.developerLanguages[0].level, '熟练');
});

test('normalizeProfile keeps language exams in a dedicated array', () => {
  const normalized = normalizeProfile({
    languageExams: [
      { examType: 'IELTS', score: '7.5' },
    ],
  });

  assert.equal(normalized.languageExams[0].examType, 'IELTS');
  assert.equal(normalized.languageExams[0].score, '7.5');
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

test('normalizeTargetKey collapses job target text into a stable storage key', () => {
  assert.equal(normalizeTargetKey('  百度 / 算法工程师（校招）  '), '百度-算法工程师-校招');
  assert.equal(normalizeTargetKey('JD Health | Data Scientist'), 'jd-health-data-scientist');
});

test('normalizeTargetProfileContext trims fields and derives a stable target key', () => {
  const context = normalizeTargetProfileContext({
    company: '  百度  ',
    role: '  算法工程师（校招） ',
    notes: '  突出推荐系统和大模型项目经验  ',
  });

  assert.equal(context.company, '百度');
  assert.equal(context.role, '算法工程师（校招）');
  assert.equal(context.notes, '突出推荐系统和大模型项目经验');
  assert.equal(context.targetKey, '百度-算法工程师-校招');
});

test('target profile context helpers detect empty state and build user-facing labels', () => {
  assert.equal(hasTargetProfileContext({ company: '', role: '', notes: 'only notes' }), false);
  assert.equal(hasTargetProfileContext({ company: '京东健康', role: '' }), true);
  assert.equal(getTargetDraftDisplayLabel({ company: '京东健康', role: '数据分析师' }), '京东健康 / 数据分析师');
  assert.equal(getTargetDraftDisplayLabel({ company: '', role: '前端开发' }), '前端开发');
});

test('mergeProfileWithTargetDraft applies sparse target-specific fields without losing base data', () => {
  const merged = mergeProfileWithTargetDraft(
    normalizeProfile({
      personal: { fullName: '宋培豪' },
      selfIntro: '通用版自我介绍',
      jobPreferences: {
        expectedPositions: ['数据科学家'],
        expectedLocations: ['上海'],
      },
      projects: [{ name: '通用项目', description: '基础描述' }],
    }),
    {
      selfIntro: '更偏向算法岗位的自我介绍',
      jobPreferences: {
        expectedPositions: ['算法工程师'],
      },
      projects: [{ description: '强调算法与建模能力' }],
    }
  );

  assert.equal(merged.personal.fullName, '宋培豪');
  assert.equal(merged.selfIntro, '更偏向算法岗位的自我介绍');
  assert.deepEqual(merged.jobPreferences.expectedPositions, ['算法工程师']);
  assert.deepEqual(merged.jobPreferences.expectedLocations, ['上海']);
  assert.equal(merged.projects[0].name, '通用项目');
  assert.equal(merged.projects[0].description, '强调算法与建模能力');
});

test('buildTargetProfilePrompt includes target role context and requests sparse patch output', () => {
  const messages = buildTargetProfilePrompt(
    {
      company: '百度',
      role: '算法工程师',
      notes: '突出推荐系统和大模型项目经验',
    },
    normalizeProfile({
      personal: { fullName: '宋培豪' },
      selfIntro: '通用版',
      jobPreferences: { expectedPositions: ['数据科学家'] },
    })
  );

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /稀疏 JSON Patch/);
  assert.match(messages[1].content, /百度/);
  assert.match(messages[1].content, /算法工程师/);
  assert.match(messages[1].content, /推荐系统和大模型项目经验/);
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

test('storage persists target profile drafts and merges them on demand', async () => {
  const { mod } = await importStorageModuleWithMock({
    profiles: {
      default: {
        name: '默认资料',
        data: normalizeProfile({
          personal: { fullName: '宋培豪' },
          selfIntro: '通用介绍',
          jobPreferences: { expectedPositions: ['数据科学家'] },
        }),
        createdAt: '2026-03-31T00:00:00.000Z',
      },
    },
    activeProfile: 'default',
  });

  await mod.saveTargetProfileDraft('default', '百度 / 算法工程师', {
    selfIntro: '偏算法岗位版本',
    jobPreferences: { expectedPositions: ['算法工程师'] },
  });

  const storedPatch = await mod.getTargetProfileDraft('default', '百度 / 算法工程师');
  const targetedProfile = await mod.getProfile('', '百度 / 算法工程师');
  const baseProfile = await mod.getProfile();

  assert.equal(storedPatch.selfIntro, '偏算法岗位版本');
  assert.equal(baseProfile.selfIntro, '通用介绍');
  assert.deepEqual(baseProfile.jobPreferences.expectedPositions, ['数据科学家']);
  assert.equal(targetedProfile.selfIntro, '偏算法岗位版本');
  assert.deepEqual(targetedProfile.jobPreferences.expectedPositions, ['算法工程师']);
});

test('storage persists learned semantic field memory samples', async () => {
  const { mod } = await importStorageModuleWithMock();

  await mod.learnSemanticFieldMemorySamples([
    buildSemanticFieldSample({
      type: 'text',
      label: '牛客意向岗位',
      placeholder: '请输入岗位名称',
      sectionLabel: '求职偏好',
    }, 'jobPreferences.expectedPositions', { hostname: 'campus.nowcoder.com' }),
  ]);
  await mod.learnSemanticFieldMemorySamples([
    buildSemanticFieldSample({
      type: 'text',
      label: '牛客意向岗位',
      placeholder: '请输入岗位名称',
      sectionLabel: '求职偏好',
    }, 'jobPreferences.expectedPositions', { hostname: 'campus.nowcoder.com' }),
  ]);

  const memory = await mod.getSemanticFieldMemory();
  assert.equal(memory.length, 1);
  assert.equal(memory[0].key, 'jobPreferences.expectedPositions');
  assert.equal(memory[0].observedCount, 2);
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
