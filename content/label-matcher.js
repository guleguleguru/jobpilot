/**
 * label-matcher.js — 中文/英文 label 快速匹配
 *
 * 对常见字段用正则直接匹配，命中则无需调 AI。
 * 支持多段教育/工作经历：当页面有第 N 个"学校"字段时，
 * 自动从 profile.education[N] 取对应记录。
 */

// ── 匹配规则表 ────────────────────────────────────────────────
// group + subkey：表示属于数组类字段，匹配时动态决定索引
// key：表示普通标量字段

const LABEL_RULES = [
  // ── 姓名类 ──
  { pattern: /^(姓名|名字|full\s*name|applicant\s*name|申请人姓名?)$/i, key: 'name' },
  { pattern: /(last\s*name|family\s*name|surname|姓$)/i,                key: 'lastName' },
  { pattern: /(first\s*name|given\s*name|^名$)/i,                       key: 'firstName' },

  // ── 个人基本信息 ──
  { pattern: /(性别|gender|sex)/i,                                       key: 'gender' },
  { pattern: /(出生日期|生日|birth\s*day|date\s*of\s*birth|出生年月)/i,  key: 'birthday' },
  { pattern: /(民族|ethnicity)/i,                                        key: 'ethnicity' },
  { pattern: /(籍贯|hometown|native\s*place|出生地)/i,                   key: 'hometown' },
  { pattern: /(政治面貌|political\s*status|party\s*member)/i,            key: 'politicalStatus' },
  { pattern: /(身份证\s*号?码?|id\s*card|id\s*number)/i,                 key: 'idNumber' },

  // ── 联系方式 ──
  { pattern: /(手机\s*号?码?|电话\s*号?码?|mobile|phone|tel(?!linkedin)(?!ephone))/i, key: 'phone' },
  { pattern: /(邮\s*箱|e-?mail|电子邮件)/i,                             key: 'email' },
  { pattern: /(通讯地址|现居住地|详细地址|^地址$|^address$)/i,          key: 'address' },
  { pattern: /(微信\s*号?|wechat)/i,                                     key: 'wechat' },

  // ── 教育背景（使用 group/subkey，自动递增索引） ──
  { pattern: /(毕业院校|学校名称|就读学校|university|college|school\s*name|院校)/i, group: 'education', subkey: 'school' },
  { pattern: /(所学专业|专业名称|^专业$|^major$|学科方向)/i,             group: 'education', subkey: 'major' },
  { pattern: /(学历|最高学历|学位|degree|education\s*level)/i,           group: 'education', subkey: 'degree' },
  { pattern: /(入学(时间|日期|年份)?|start\s*date|enrollment)/i,         group: 'education', subkey: 'startDate' },
  { pattern: /(毕业(时间|日期|年份)?|graduation|end\s*date)/i,           group: 'education', subkey: 'endDate' },
  { pattern: /(gpa|绩点|平均\s*分|成绩)/i,                              group: 'education', subkey: 'gpa' },

  // ── 工作/实习经历（使用 group/subkey，自动递增索引） ──
  { pattern: /(实习公司|工作单位|所在公司|company|employer|单位名称)/i,   group: 'experience', subkey: 'company' },
  { pattern: /(实习岗位|工作职位|担任职位|岗位名称|job\s*title|position|^职位$|^职称$)/i, group: 'experience', subkey: 'title' },
  { pattern: /(工作描述|岗位职责|工作内容|job\s*description|responsibilities)/i,         group: 'experience', subkey: 'description' },

  // ── 技能 ──
  { pattern: /(技能|专业技能|技术栈|skills|expertise)/i,                 key: 'skills' },

  // ── 自我介绍 ──
  { pattern: /(自我评价|自我介绍|个人简介|自我描述|self[\s-]?intro|about\s*me)/i, key: 'selfIntro' },

  // ── 链接 ──
  { pattern: /github/i,                                                  key: 'links.github' },
  { pattern: /linkedin/i,                                                key: 'links.linkedin' },
  { pattern: /(个人网站|portfolio|blog|website)/i,                       key: 'links.website' },

  // ── 文件上传 ──
  { pattern: /(简历|resume|cv|附件)/i,                                   key: '_resumeFile', isFile: true },
];

// ── 路径取值（支持 education[0].school、experience[1].company） ──

function getProfileValue(profile, keyPath) {
  const parts = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let val = profile;
  for (const part of parts) {
    if (val == null) return undefined;
    val = val[part];
  }
  if (Array.isArray(val)) return val.join('、');
  return val;
}

// ── 单字段匹配 ────────────────────────────────────────────────

/**
 * 对单个字段尝试正则匹配
 * @param {object} field    - form-detector 输出的字段对象
 * @param {object} profile  - 用户个人资料
 * @param {object} counters - { education: { school: N, ... }, experience: { company: N, ... } }
 * @returns {{ matched, key, value, isFile }}
 */
function matchField(field, profile, counters) {
  const matchText = [field.label, field.placeholder, field.name]
    .filter(Boolean)
    .join(' ');

  for (const rule of LABEL_RULES) {
    if (!rule.pattern.test(matchText)) continue;

    if (rule.isFile) {
      return { matched: true, key: '_resumeFile', value: null, isFile: true };
    }

    let key;
    if (rule.group === 'education' || rule.group === 'experience') {
      // 取当前已见到该子键的次数作为数组索引
      const grp = counters[rule.group];
      const idx = grp[rule.subkey] || 0;
      grp[rule.subkey] = idx + 1;
      key = `${rule.group}[${idx}].${rule.subkey}`;
    } else {
      key = rule.key;
    }

    const value = getProfileValue(profile, key);
    if (value != null && value !== '') {
      return { matched: true, key, value: String(value), isFile: false };
    }
    return { matched: true, key, value: null, isFile: false };
  }

  return { matched: false, key: null, value: null, isFile: false };
}

// ── 全表单匹配 ────────────────────────────────────────────────

/**
 * 对整个表单检测结果做快速 label 匹配。
 * 多段教育/经历字段按页面出现顺序依次对应 profile 数组索引。
 * @param {object} detectResult - form-detector 的输出 { forms: [...] }
 * @param {object} profile      - 用户个人资料
 * @returns {{ matched: object[], unmatched: object[] }}
 */
function matchForms(detectResult, profile) {
  const matched   = [];
  const unmatched = [];
  // 每次调用重置计数器：每类子键独立计数
  const counters  = { education: {}, experience: {} };

  for (const form of detectResult.forms) {
    for (const field of form.fields) {
      // file input 统一当简历上传处理
      if (field.type === 'file') {
        matched.push({ field, formId: form.id, key: '_resumeFile', value: null, isFile: true });
        continue;
      }

      const result = matchField(field, profile, counters);
      if (result.matched && result.value != null) {
        matched.push({ field, formId: form.id, key: result.key, value: result.value, isFile: false });
      } else {
        unmatched.push({ field, formId: form.id });
      }
    }
  }

  return { matched, unmatched };
}

// ── 消息监听 ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'matchFields') {
    const { detectResult, profile } = message;
    try {
      const result = matchForms(detectResult, profile);
      sendResponse({ success: true, data: result });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});

// 调试用
window.__jobpilotMatchForms = matchForms;
window.__jobpilotMatchField = matchField;
window.__jobpilotGetProfileValue = getProfileValue;
