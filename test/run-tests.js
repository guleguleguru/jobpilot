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

教育背景
上海交通大学
专业：计算机科学与技术
本科
2017年09月 - 2021年06月
GPA：3.8/4.0

工作经历
字节跳动科技
2020年07月 - 2020年12月

技能：Python, JavaScript, Docker

自我评价：具有扎实的工程基础和良好的团队协作能力。
`.trim();

  const parsed = parseLocalRegex(text);

  assert.equal(parsed.name, '张三');
  assert.equal(parsed.phone, '13800138000');
  assert.equal(parsed.email, 'zhangsan@example.com');
  assert.equal(parsed.links.github, 'https://github.com/zhangsan');
  assert.equal(parsed.education[0].school, '上海交通大学');
  assert.equal(parsed.education[0].major, '计算机科学与技术');
  assert.equal(parsed.education[0].degree, '本科');
  assert.equal(parsed.education[0].startDate, '2017-09');
  assert.equal(parsed.education[0].endDate, '2021-06');
  assert.equal(parsed.education[0].gpa, '3.8/4.0');
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
  assert.equal(sanitized.education.length, 2);
  assert.equal(sanitized.experience.length, 2);
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
