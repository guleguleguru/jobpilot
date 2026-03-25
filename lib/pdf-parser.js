/**
 * pdf-parser.js — PDF 简历解析工具
 * 提供两种模式：本地正则解析 / AI 智能解析
 * PDF 文本提取依赖 pdf.js（由 pdfjs-loader.js 加载）
 * 支持多段教育经历和多段工作经历
 */

// ── 字段定义（用于 PDF 导入比对预览） ────────────────────────
// 最多显示 2 段教育 + 2 段经历（覆盖绝大多数简历场景）

export const PROFILE_DISPLAY_FIELDS = [
  { key: 'name',                      label: '姓名',          path: 'name' },
  { key: 'phone',                     label: '手机号',        path: 'phone' },
  { key: 'email',                     label: '邮箱',          path: 'email' },
  { key: 'gender',                    label: '性别',          path: 'gender' },
  { key: 'birthday',                  label: '出生日期',      path: 'birthday' },
  { key: 'graduationYear',            label: '毕业年份',      path: 'graduationYear' },
  { key: 'ethnicity',                 label: '民族',          path: 'ethnicity' },
  { key: 'hometown',                  label: '籍贯',          path: 'hometown' },
  { key: 'politicalStatus',           label: '政治面貌',      path: 'politicalStatus' },
  { key: 'documentType',              label: '证件类型',      path: 'documentType' },
  { key: 'address',                   label: '地址',          path: 'address' },
  { key: 'wechat',                    label: '微信号',        path: 'wechat' },
  { key: 'jobPreferences.expectedCity',        label: '期望城市',   path: 'jobPreferences.expectedCity' },
  { key: 'jobPreferences.availableFrom',       label: '最早到岗',   path: 'jobPreferences.availableFrom' },
  { key: 'jobPreferences.expectedSalary',      label: '期望薪资',   path: 'jobPreferences.expectedSalary' },
  { key: 'jobPreferences.internshipDuration',  label: '实习时长',   path: 'jobPreferences.internshipDuration' },

  // 第 1 段教育
  { key: 'education[0].school',       label: '学校（1）',     path: 'education[0].school' },
  { key: 'education[0].major',        label: '专业（1）',     path: 'education[0].major' },
  { key: 'education[0].degree',       label: '学历（1）',     path: 'education[0].degree' },
  { key: 'education[0].startDate',    label: '入学时间（1）', path: 'education[0].startDate' },
  { key: 'education[0].endDate',      label: '毕业时间（1）', path: 'education[0].endDate' },
  { key: 'education[0].gpa',          label: 'GPA（1）',      path: 'education[0].gpa' },

  // 第 2 段教育
  { key: 'education[1].school',       label: '学校（2）',     path: 'education[1].school' },
  { key: 'education[1].major',        label: '专业（2）',     path: 'education[1].major' },
  { key: 'education[1].degree',       label: '学历（2）',     path: 'education[1].degree' },
  { key: 'education[1].startDate',    label: '入学时间（2）', path: 'education[1].startDate' },
  { key: 'education[1].endDate',      label: '毕业时间（2）', path: 'education[1].endDate' },

  // 第 1 段经历
  { key: 'experience[0].company',     label: '公司（1）',     path: 'experience[0].company' },
  { key: 'experience[0].title',       label: '职位（1）',     path: 'experience[0].title' },
  { key: 'experience[0].startDate',   label: '经历开始（1）', path: 'experience[0].startDate' },
  { key: 'experience[0].endDate',     label: '经历结束（1）', path: 'experience[0].endDate' },
  { key: 'experience[0].description', label: '工作描述（1）', path: 'experience[0].description' },

  // 第 2 段经历
  { key: 'experience[1].company',     label: '公司（2）',     path: 'experience[1].company' },
  { key: 'experience[1].title',       label: '职位（2）',     path: 'experience[1].title' },
  { key: 'experience[1].startDate',   label: '经历开始（2）', path: 'experience[1].startDate' },
  { key: 'experience[1].endDate',     label: '经历结束（2）', path: 'experience[1].endDate' },
  { key: 'experience[1].description', label: '工作描述（2）', path: 'experience[1].description' },

  { key: 'projects[0].name',          label: '项目（1）',     path: 'projects[0].name' },
  { key: 'projects[0].role',          label: '项目角色（1）', path: 'projects[0].role' },
  { key: 'projects[0].description',   label: '项目描述（1）', path: 'projects[0].description' },
  { key: 'projects[1].name',          label: '项目（2）',     path: 'projects[1].name' },
  { key: 'projects[1].role',          label: '项目角色（2）', path: 'projects[1].role' },

  { key: 'awards[0].name',            label: '奖项（1）',     path: 'awards[0].name' },
  { key: 'awards[0].year',            label: '获奖年份（1）', path: 'awards[0].year' },
  { key: 'awards[1].name',            label: '奖项（2）',     path: 'awards[1].name' },
  { key: 'awards[1].year',            label: '获奖年份（2）', path: 'awards[1].year' },

  { key: 'languages[0].name',         label: '语言（1）',     path: 'languages[0].name' },
  { key: 'languages[0].level',        label: '水平（1）',     path: 'languages[0].level' },
  { key: 'languages[1].name',         label: '语言（2）',     path: 'languages[1].name' },
  { key: 'languages[1].level',        label: '水平（2）',     path: 'languages[1].level' },

  { key: 'skills',                    label: '技能',          path: 'skills' },
  { key: 'links.github',              label: 'GitHub',        path: 'links.github' },
  { key: 'links.linkedin',            label: 'LinkedIn',      path: 'links.linkedin' },
  { key: 'links.website',             label: '个人网站',      path: 'links.website' },
  { key: 'selfIntro',                 label: '自我介绍',      path: 'selfIntro' },
];

// ── 工具：嵌套路径读写 ────────────────────────────────────────

/**
 * 按点分路径读取嵌套对象中的值，支持 education[0].school 格式
 */
export function getFieldValue(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let val = obj;
  for (const p of parts) {
    if (val == null) return '';
    val = val[p];
  }
  if (Array.isArray(val)) return val.join(', ');
  return val ?? '';
}

/**
 * 按点分路径写入嵌套对象，自动创建中间层
 */
export function setFieldValue(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const nextIsIndex = !isNaN(parts[i + 1]);
    if (cur[p] == null || typeof cur[p] !== 'object') {
      cur[p] = nextIsIndex ? [] : {};
    }
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  // 技能字段：逗号分隔字符串 → 数组
  if (path === 'skills' && typeof value === 'string') {
    cur[last] = value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
  } else {
    cur[last] = value;
  }
}

// ── PDF 文本提取 ──────────────────────────────────────────────

/**
 * 使用 pdf.js 从 File 对象提取全文文本
 * @param {File} pdfFile
 * @param {object} pdfjsLib - 已加载的 pdf.js 模块
 * @returns {Promise<string>} 合并后的全文
 */
export async function extractPdfContent(pdfFile, pdfjsLib) {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  const links = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const annotations = await page.getAnnotations().catch(() => []);
    let line = '', lastY = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        pageTexts.push(line.trim());
        line = '';
      }
      line  += item.str;
      lastY  = y;
    }
    if (line.trim()) pageTexts.push(line.trim());

    for (const annotation of annotations) {
      if (annotation?.url) links.push(annotation.url);
    }
  }
  return {
    text: pageTexts.filter(Boolean).join('\n'),
    links: [...new Set(links)],
  };
}

export async function extractPdfText(pdfFile, pdfjsLib) {
  const { text } = await extractPdfContent(pdfFile, pdfjsLib);
  return text;
}

// ── 本地正则解析 ──────────────────────────────────────────────

function parseDateRange(line) {
  const datePart = '((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+20\\d{2}|20\\d{2}[.\\-\\/]\\d{1,2}|20\\d{2}年\\d{1,2}月|20\\d{2}|Present|至今)';
  const match = line.match(new RegExp(`${datePart}\\s*[-–~至到]\\s*${datePart}`, 'i'));
  if (!match) return null;

  const normalizePart = (value) => {
    const raw = value.replace(/\s+/g, ' ').trim();
    if (/present|至今/i.test(raw)) return 'Present';

    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };

    const monthName = raw.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i);
    const englishYear = raw.match(/(20\d{2})/);
    if (monthName && englishYear) {
      return `${englishYear[1]}-${monthMap[monthName[1].slice(0, 3).toLowerCase()]}`;
    }

    const yearMonth = raw.match(/(20\d{2})[.\-\/年](\d{1,2})/);
    if (yearMonth) return `${yearMonth[1]}-${yearMonth[2].padStart(2, '0')}`;

    const yearOnly = raw.match(/(20\d{2})/);
    if (yearOnly) return yearOnly[1];

    return raw;
  };

  return {
    startDate: normalizePart(match[1]),
    endDate: normalizePart(match[2]),
  };
}

function getSectionLines(lines, headingRegex, allHeadingRegex) {
  const start = lines.findIndex(line => headingRegex.test(line));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (allHeadingRegex.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).map(line => line.trim()).filter(Boolean);
}

function isSchoolLine(line) {
  return /(?:大学|学院|学校|University|College)$/i.test(line);
}

function isCompanyLine(line) {
  return /(?:公司|科技|集团|有限|Ltd|Inc|Corp|Technology|Software)$/i.test(line);
}

function isLikelyProjectTitle(line) {
  return line.length <= 80 &&
    !/[。；，,:：]/.test(line) &&
    /—|-|Agent|流水线|助手|系统|平台|框架/i.test(line) &&
    !parseDateRange(line);
}

function looksLikeCategoryHeading(line) {
  return /^(编程语言|机器学习|自然语言处理（NLP）|自然语言处理|大语言模型（LLM）|统计学与数学)$/i.test(line);
}

function extractEnglishTechTokens(text) {
  const tokenRegex = /GitHub Actions|Cross-Encoder|LightGBM|XGBoost|LangGraph|MATLAB|Python|SQLite|Pandas|FAISS|BM25|SQL|Stata|LoRA|PEFT|MCP|RAG|Git|R\b|AI\b/gi;
  const seen = new Set();
  const tokens = [];
  for (const match of text.matchAll(tokenRegex)) {
    const value = match[0].replace(/\bGit\b/, 'Git').replace(/\bAI\b/, 'AI');
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(value);
    }
  }
  return tokens;
}

/**
 * 从简历文本中用正则启发式规则提取结构化数据
 * 支持多段教育和多段工作经历
 * @param {string} text
 * @returns {object} 部分填充的 profile 对象
 */
export function parseLocalRegex(text, metadata = {}) {
  const result = {
    education:  [],
    experience: [],
    projects:   [],
    awards:     [],
    languages:  [],
    links:      {},
    jobPreferences: {},
  };

  // ── 联系方式 ──
  const phoneMatch = text.match(/(?<!\d)(1[3-9]\d{9})(?!\d)/);
  if (phoneMatch) result.phone = phoneMatch[1];

  const emailMatch = text.match(/[\w.+\-]+@[\w\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) result.email = emailMatch[0];

  // ── 链接 ──
  const githubMatch = text.match(/github\.com\/[\w\-]+/i);
  if (githubMatch) result.links.github = `https://${githubMatch[0]}`;

  const linkedinMatch = text.match(/linkedin\.com\/in\/[\w\-]+/i);
  if (linkedinMatch) result.links.linkedin = `https://${linkedinMatch[0]}`;

  const websiteMatch = text.match(/https?:\/\/(?!github|linkedin)[\w.\-/]+/i);
  if (websiteMatch) result.links.website = websiteMatch[0];

  if (Array.isArray(metadata.links)) {
    for (const url of metadata.links) {
      if (/github\.com\//i.test(url) && !result.links.github) result.links.github = url;
      else if (/linkedin\.com\//i.test(url) && !result.links.linkedin) result.links.linkedin = url;
      else if (/^https?:\/\//i.test(url) && !result.links.website) result.links.website = url;
    }
  }

  // ── 姓名（简历头部第一个短行） ──
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const sectionHeadingRegex = /^(教育经历|教育背景|学习经历|学历信息|实习经历|工作经历|实习经验|工作经验|项目经历|项目经验|科研项目|研究经历|技能|荣誉奖项|奖项荣誉|获奖经历|荣誉奖项|获奖情况|语言能力|语言水平)$/i;
  for (const line of lines.slice(0, 8)) {
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(line) || /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(line)) {
      result.name = line;
      break;
    }
  }
  const nameLabel = text.match(/姓\s*名[：:]\s*([\u4e00-\u9fa5A-Za-z\s]{2,10})/);
  if (!result.name && nameLabel) result.name = nameLabel[1].trim();

  const gradYearMatch = text.match(/(毕业年份|毕业年|届别)[：:\s]*(20\d{2})/i);
  if (gradYearMatch) result.graduationYear = gradYearMatch[2];

  const documentTypeMatch = text.match(/(证件类型|证件类别)[：:\s]*(居民身份证|身份证|护照|港澳居民居住证|台湾居民居住证)/i);
  if (documentTypeMatch) result.documentType = documentTypeMatch[2] === '身份证'
    ? '居民身份证' : documentTypeMatch[2];

  const expectedCityMatch = text.match(/(期望城市|意向城市|工作城市)[：:\s]*([^\n。；;]{2,30})/i);
  if (expectedCityMatch) result.jobPreferences.expectedCity = expectedCityMatch[2].trim();

  const availableFromMatch = text.match(/(到岗时间|最早到岗|可入职时间)[：:\s]*([^\n。；;]{2,30})/i);
  if (availableFromMatch) result.jobPreferences.availableFrom = availableFromMatch[2].trim();

  const expectedSalaryMatch = text.match(/(期望薪资|薪资要求|薪酬要求)[：:\s]*([^\n。；;]{2,30})/i);
  if (expectedSalaryMatch) result.jobPreferences.expectedSalary = expectedSalaryMatch[2].trim();

  const internshipDurationMatch = text.match(/(实习时长|实习周期|可实习多久)[：:\s]*([^\n。；;]{2,40})/i);
  if (internshipDurationMatch) result.jobPreferences.internshipDuration = internshipDurationMatch[2].trim();

  // ── 全文日期范围（用于推断教育/经历时间段） ──
  const dateRanges = [...text.matchAll(
    /(20\d{2})[.\-\/年](\d{1,2})[月]?\s*[-–~至到]\s*(20\d{2})[.\-\/年]?(\d{0,2})[月]?/g
  )];

  // ── 教育背景（支持多段） ──
  // 切分教育段落：找"教育"或"学历"区块
  const eduSectionMatch = text.match(
    /(?:教育背景|教育经历|学习经历|学历信息)([\s\S]{0,1200})(?=工作|实习|项目|技能|证书|$)/i
  );
  const eduText = eduSectionMatch ? eduSectionMatch[1] : text;

  // 找所有学校名
  const schoolMatches = [...eduText.matchAll(
    /([\u4e00-\u9fa5]+(?:大学|学院|学校|研究院))/g
  )];
  const degrees = [...eduText.matchAll(/(本科|学士|硕士|博士|大专|master|doctor|bachelor)/gi)];
  const degreeMap = { master: '硕士', doctor: '博士', bachelor: '本科' };

  // 找教育段内的日期范围
  const eduDateRanges = [...eduText.matchAll(
    /(20\d{2})[.\-\/年](\d{1,2})[月]?\s*[-–~至到]\s*(20\d{2})[.\-\/年]?(\d{0,2})[月]?/g
  )];

  const eduCount = Math.max(schoolMatches.length, Math.min(eduDateRanges.length, 2));
  for (let i = 0; i < eduCount; i++) {
    const edu = {};
    if (schoolMatches[i]) edu.school = schoolMatches[i][1];
    if (degrees[i]) {
      const d = degrees[i][1].toLowerCase();
      edu.degree = degreeMap[d] || degrees[i][1];
    }
    if (eduDateRanges[i]) {
      const [, sy, sm, ey, em] = eduDateRanges[i];
      edu.startDate = `${sy}-${sm.padStart(2, '0')}`;
      if (ey) edu.endDate = em ? `${ey}-${em.padStart(2, '0')}` : ey;
      if (!result.graduationYear && ey) result.graduationYear = ey;
    }
    // GPA（只取第一段）
    if (i === 0) {
      const gpaMatch = eduText.match(/GPA[：:\s]*([\d.\/]+)/i);
      if (gpaMatch) edu.gpa = gpaMatch[1];
      const majorMatch = eduText.match(/专\s*业[：:\s]*([\u4e00-\u9fa5A-Za-z\s（）()\-]+?)(?:\n|学历|GPA|入学|$)/);
      if (majorMatch) edu.major = majorMatch[1].trim();
    }
    if (Object.keys(edu).length) result.education.push(edu);
  }
  // 确保至少一条（空数组会在 renderCards 中显示空卡片）
  if (!result.education.length) result.education.push({});

  const educationLines = getSectionLines(lines, /^(教育经历|教育背景|学习经历|学历信息)$/i, sectionHeadingRegex);
  if (educationLines.length) {
    const parsedEducation = [];
    for (let i = 0; i < educationLines.length; i++) {
      const line = educationLines[i];
      if (!isSchoolLine(line)) continue;
      const entry = { school: line };

      for (let j = i + 1; j < educationLines.length; j++) {
        const next = educationLines[j];
        if (isSchoolLine(next)) break;
        const range = parseDateRange(next);
        if (range) {
          entry.startDate = range.startDate;
          entry.endDate = range.endDate;
          if (!result.graduationYear && /\d{4}/.test(range.endDate)) {
            result.graduationYear = range.endDate.slice(0, 4);
          }
          continue;
        }
        if (/^\d(?:\.\d+)?\s*\/\s*\d(?:\.\d+)?$/.test(next) || /^GPA/i.test(next)) {
          entry.gpa = next.replace(/^GPA[：:\s]*/i, '').trim();
          continue;
        }
        if (/(硕士|学士|本科|博士|研究生|大专|Master|Bachelor|PhD)/i.test(next)) {
          if (!entry.degree) {
            if (/硕士|Master/i.test(next)) entry.degree = '硕士';
            else if (/博士|PhD/i.test(next)) entry.degree = '博士';
            else if (/本科|学士|Bachelor/i.test(next)) entry.degree = '本科';
            else if (/大专/i.test(next)) entry.degree = '大专';
          }
          const major = next
            .replace(/理学|工学|文学|经济学|管理学/g, '')
            .replace(/硕士|学士|本科|博士|研究生|大专|Master|Bachelor|PhD/gi, '')
            .trim();
          if (major && major.length >= 2) entry.major = major;
          continue;
        }
        if (!entry.major && next.length <= 30) {
          entry.major = next.replace(/^专业[：:\s]*/i, '').trim();
        }
      }

      parsedEducation.push(entry);
      if (parsedEducation.length >= 2) break;
    }
    if (parsedEducation.length) result.education = parsedEducation;
  }

  // ── 工作/实习经历（支持多段） ──
  const expSectionMatch = text.match(
    /(?:工作经历|实习经历|实习经验|工作经验)([\s\S]{0,1500})(?=教育|技能|项目|证书|$)/i
  );
  const expText = expSectionMatch ? expSectionMatch[1] : '';

  if (expText) {
    // 找所有公司名
    const companyMatches = [...expText.matchAll(
      /[\u4e00-\u9fa5A-Za-z]{2,20}(?:公司|科技|集团|有限|Ltd|Inc|Corp|Technology|Software)/g
    )];
    // 找经历段内日期范围
    const expDateRanges = [...expText.matchAll(
      /(20\d{2})[.\-\/年](\d{1,2})[月]?\s*[-–~至到]\s*(20\d{2})[.\-\/年]?(\d{0,2})[月]?/g
    )];

    const expCount = Math.max(companyMatches.length, Math.min(expDateRanges.length, 3));
    for (let i = 0; i < expCount; i++) {
      const exp = {};
      if (companyMatches[i]) exp.company = companyMatches[i][0];
      if (expDateRanges[i]) {
        const [, sy, sm, ey, em] = expDateRanges[i];
        exp.startDate = `${sy}-${sm.padStart(2, '0')}`;
        if (ey) exp.endDate = em ? `${ey}-${em.padStart(2, '0')}` : ey;
      }
      if (Object.keys(exp).length) result.experience.push(exp);
    }
  }
  // 找剩余日期范围（不在教育和经历段内）推断额外经历
  if (!result.experience.length && dateRanges.length > eduDateRanges.length) {
    const exp0 = {};
    const r = dateRanges[eduDateRanges.length];
    if (r) {
      const [, sy, sm, ey, em] = r;
      exp0.startDate = `${sy}-${sm.padStart(2, '0')}`;
      if (ey) exp0.endDate = em ? `${ey}-${em.padStart(2, '0')}` : ey;
      result.experience.push(exp0);
    }
  }
  if (!result.experience.length) result.experience.push({});

  const experienceLines = getSectionLines(lines, /^(实习经历|工作经历|实习经验|工作经验)$/i, sectionHeadingRegex);
  if (experienceLines.length) {
    const parsedExperience = [];
    for (let i = 0; i < experienceLines.length; i++) {
      const line = experienceLines[i];
      if (!isCompanyLine(line)) continue;
      const entry = { company: line };

      const titleLine = experienceLines[i + 1];
      if (titleLine && !parseDateRange(titleLine) && titleLine.length <= 30) {
        entry.title = titleLine;
      }

      for (let j = i + 1; j < experienceLines.length; j++) {
        const next = experienceLines[j];
        if (j > i + 1 && isCompanyLine(next)) break;

        const range = parseDateRange(next);
        if (range) {
          entry.startDate = range.startDate;
          entry.endDate = range.endDate;
          continue;
        }

        if (next === entry.title) continue;
        if (next.length >= 18 && !isCompanyLine(next)) {
          entry.description = entry.description ? `${entry.description} ${next}` : next;
        }
      }

      parsedExperience.push(entry);
    }
    if (parsedExperience.length) result.experience = parsedExperience;
  }

  // ── 项目经历 ──
  const projectSectionMatch = text.match(
    /(?:项目经历|项目经验|科研项目)([\s\S]{0,1500})(?=工作|实习|教育|技能|奖项|证书|$)/i
  );
  const projectText = projectSectionMatch ? projectSectionMatch[1] : '';
  if (projectText) {
    const projectLines = projectText.split('\n').map(line => line.trim()).filter(Boolean);
    for (let i = 0; i < projectLines.length && result.projects.length < 2; i++) {
      const line = projectLines[i];
      if (line.length < 3 || /(项目经历|项目经验|科研项目)/i.test(line)) continue;
      if (/^[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9\s\-·()（）]{2,40}$/.test(line)) {
        const project = { name: line };
        const next = projectLines[i + 1] || '';
        if (/20\d{2}/.test(next)) {
          const range = next.match(/(20\d{2})[.\-\/年](\d{1,2})?[月]?\s*[-–~至到]\s*(20\d{2})[.\-\/年]?(\d{0,2})?[月]?/);
          if (range) {
            const [, sy, sm = '01', ey, em = '01'] = range;
            project.startDate = `${sy}-${String(sm).padStart(2, '0')}`;
            project.endDate = `${ey}-${String(em).padStart(2, '0')}`;
          }
        }
        const descCandidates = [];
        const line1 = projectLines[i + 1] || '';
        const line2 = projectLines[i + 2] || '';
        if (line1 && !/20\d{2}/.test(line1)) descCandidates.push(line1);
        if (line2 && !/20\d{2}/.test(line2)) descCandidates.push(line2);
        const desc = descCandidates.join(' ');
        if (desc) project.description = desc.slice(0, 160);
        result.projects.push(project);
      }
    }
  }
  if (!result.projects.length) result.projects.push({});

  const projectLines = getSectionLines(lines, /^(项目经历|项目经验|科研项目)$/i, sectionHeadingRegex);
  if (projectLines.length) {
    const parsedProjects = [];
    for (let i = 0; i < projectLines.length; i++) {
      const line = projectLines[i];
      if (!isLikelyProjectTitle(line)) continue;

      const entry = { name: line };
      let j = i + 1;
      while (j < projectLines.length) {
        const next = projectLines[j];
        if (isLikelyProjectTitle(next) && j > i + 1) break;
        if (/^(研究经历)$/i.test(next)) break;

        const range = parseDateRange(next);
        if (range) {
          entry.startDate = range.startDate;
          entry.endDate = range.endDate;
          j++;
          continue;
        }

        if (/技术栈[:：]/i.test(next)) {
          entry.role = next.split(/[|｜]/)[0].trim();
          const stackText = next.split(/技术栈[:：]/i)[1] || '';
          const stack = extractEnglishTechTokens(stackText);
          if (stack.length) entry.techStack = stack;
          j++;
          continue;
        }

        if (next.length >= 16) {
          entry.description = entry.description ? `${entry.description} ${next}` : next;
        }
        j++;
      }

      parsedProjects.push(entry);
      i = j - 1;
      if (parsedProjects.length >= 2) break;
    }
    if (parsedProjects.length) result.projects = parsedProjects;
  }

  // ── 奖项荣誉 ──
  const awardSectionMatch = text.match(
    /(?:奖项荣誉|获奖经历|荣誉奖项|获奖情况)([\s\S]{0,800})(?=语言|技能|项目|工作|教育|$)/i
  );
  const awardText = awardSectionMatch ? awardSectionMatch[1] : '';
  if (awardText) {
    const awardLines = awardText.split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of awardLines) {
      const year = line.match(/(20\d{2})/);
      const name = line.replace(/(20\d{2})(年)?/g, '').replace(/[：:]/g, '').trim();
      if (name.length >= 2) {
        result.awards.push({ name: name.slice(0, 60), ...(year ? { year: year[1] } : {}) });
      }
      if (result.awards.length >= 2) break;
    }
  }
  if (!result.awards.length) result.awards.push({});

  const awardLines = getSectionLines(lines, /^(荣誉奖项|奖项荣誉|获奖经历|获奖情况)$/i, sectionHeadingRegex);
  if (awardLines.length) {
    result.awards = awardLines.slice(0, 3).map(line => {
      const year = line.match(/(20\d{2})/);
      const cleanedName = line
        .replace(/\(?20\d{2}(?:[\/-]\d{2})?.*?\)?/g, '')
        .replace(/（[^）]*连续两学年[^）]*）/g, '')
        .replace(/[，,]\s*[）)]/g, '）')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        name: cleanedName || line.trim(),
        ...(year ? { year: year[1] } : {}),
      };
    });
  }

  // ── 语言能力 ──
  const languageSectionMatch = text.match(
    /(?:语言能力|语言水平|Languages?)([\s\S]{0,500})(?=奖项|技能|项目|工作|教育|$)/i
  );
  const languageText = languageSectionMatch ? languageSectionMatch[1] : text;
  const languagePatterns = [
    { name: '英语', regex: /(英语|英文|English)[：:\s]*(CET-?[46]|TEM-?[48]|雅思\s*\d(?:\.\d)?|托福\s*\d+|熟练|流利|良好)/i },
    { name: '日语', regex: /(日语|Japanese)[：:\s]*(N[1-5]|JLPT\s*N?[1-5]|熟练|流利|良好)/i },
  ];
  for (const item of languagePatterns) {
    const match = languageText.match(item.regex);
    if (match) result.languages.push({ name: item.name, level: match[2] || match[1] });
  }
  if (!result.languages.length) {
    const cetMatch = text.match(/(CET-?6|CET-?4)/i);
    if (cetMatch) result.languages.push({ name: '英语', level: cetMatch[1].toUpperCase() });
  }
  if (!result.languages.length) result.languages.push({});

  const explicitLanguageLines = getSectionLines(lines, /^(语言能力|语言水平)$/i, sectionHeadingRegex);
  if (explicitLanguageLines.length) {
    const parsedLanguages = [];
    for (const line of explicitLanguageLines) {
      const english = line.match(/(英语|英文|English)[：:\s]*(CET-?[46]|TEM-?[48]|雅思\s*\d(?:\.\d)?|托福\s*\d+|熟练|流利|良好)/i);
      const japanese = line.match(/(日语|Japanese)[：:\s]*(N[1-5]|JLPT\s*N?[1-5]|熟练|流利|良好)/i);
      if (english) parsedLanguages.push({ name: '英语', level: english[2] });
      if (japanese) parsedLanguages.push({ name: '日语', level: japanese[2] });
    }
    if (parsedLanguages.length) result.languages = parsedLanguages;
  }

  // ── 技能 ──
  const skillsSection = text.match(
    /(?:技能|技术栈|专业技能|Skills)[：:\s]*([\s\S]{0,300}?)(?:\n\n|\n[A-Z\u4e00-\u9fa5])/i
  );
  if (skillsSection) {
    const skillsRaw = skillsSection[1]
      .replace(/[，,、\|\/·•]/g, ',')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 30);
    if (skillsRaw.length > 0) result.skills = skillsRaw;
  }

  const skillsLines = getSectionLines(lines, /^技能$/i, sectionHeadingRegex);
  if (skillsLines.length) {
    const skillText = skillsLines
      .filter(line => !looksLikeCategoryHeading(line))
      .join(' ');
    const extracted = extractEnglishTechTokens(skillText);
    if (extracted.length) result.skills = extracted;
  }

  // ── 自我评价 ──
  const introMatch = text.match(
    /(?:自我评价|个人简介|个人陈述|自我介绍)[：:\s]*([\s\S]{20,300}?)(?:\n\n|$)/i
  );
  if (introMatch) result.selfIntro = introMatch[1].trim();

  return result;
}

// ── AI 解析 Prompt ────────────────────────────────────────────

/**
 * 构建 AI 解析简历的 prompt
 * @param {string} pdfText
 * @returns {object[]} messages 数组
 */
export function buildAiParsePrompt(pdfText) {
  // 截断至 4000 字符（简历内容不会更长，超出部分多为页眉页脚重复内容）
  const truncated = pdfText.slice(0, 4000);

  const systemMsg = `你是一个专业的简历解析助手。从提供的简历文本中提取结构化个人信息。
- 严格按照 JSON 格式返回，不输出任何其他内容
- 找不到的字段设为空字符串或空数组
- 日期统一格式：YYYY-MM-DD 或 YYYY-MM（只有年月时）
- education 和 experience 均为数组，可包含多条记录
- skills 字段返回字符串数组`;

  const userMsg = `请从以下简历文本中提取结构化信息，返回 JSON：

{
  "name": "姓名",
  "firstName": "名",
  "lastName": "姓",
  "gender": "性别",
  "birthday": "出生日期（YYYY-MM-DD）",
  "graduationYear": "毕业年份",
  "ethnicity": "民族",
  "hometown": "籍贯",
  "politicalStatus": "政治面貌",
  "documentType": "证件类型",
  "phone": "手机号",
  "email": "邮箱",
  "address": "地址",
  "wechat": "微信号",
  "jobPreferences": {
    "expectedCity": "期望城市",
    "availableFrom": "最早到岗时间",
    "expectedSalary": "期望薪资",
    "internshipDuration": "可实习时长"
  },
  "education": [
    {
      "school": "学校名称",
      "major": "专业",
      "degree": "学历（本科/硕士/博士）",
      "startDate": "入学时间（YYYY-MM）",
      "endDate": "毕业时间（YYYY-MM）",
      "gpa": "GPA"
    }
  ],
  "experience": [
    {
      "company": "公司名称",
      "title": "职位",
      "startDate": "开始时间（YYYY-MM）",
      "endDate": "结束时间（YYYY-MM）",
      "description": "工作描述"
    }
  ],
  "projects": [
    {
      "name": "项目名称",
      "role": "项目角色",
      "startDate": "开始时间（YYYY-MM）",
      "endDate": "结束时间（YYYY-MM）",
      "description": "项目描述"
    }
  ],
  "awards": [
    {
      "name": "奖项名称",
      "issuer": "颁发单位",
      "year": "获奖年份"
    }
  ],
  "languages": [
    {
      "name": "语言",
      "level": "水平"
    }
  ],
  "skills": ["技能1", "技能2"],
  "links": { "github": "", "linkedin": "", "website": "" },
  "selfIntro": "自我评价/个人简介"
}

简历文本：
${truncated}`;

  return [
    { role: 'system', content: systemMsg },
    { role: 'user',   content: userMsg },
  ];
}
