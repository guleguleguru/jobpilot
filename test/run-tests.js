import assert from 'node:assert/strict';

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
import { normalizeProfile } from '../lib/profile-schema.js';

const tests = [];

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
