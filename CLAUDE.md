# JobPilot (智投助手) — Claude Code 开发 Prompt

---

## CLAUDE.md 内容开始

# JobPilot — 智投助手

## 项目概述

JobPilot 是一个 AI 驱动的 Chrome 浏览器扩展，用于在任意网站的求职申请表单上自动填写个人信息。它专注于中国市场的求职场景（校招官网、企业自建招聘系统、各类 ATS），但也兼容海外平台。

核心思路：用户维护一份结构化的个人简历数据（JSON），打开任何招聘页面后，插件扫描页面表单结构，通过 LLM 智能匹配字段语义，一键自动填写。

## 技术架构

### 纯 Chrome Extension（Manifest V3），无后端服务

```
jobpilot/
├── manifest.json              # Chrome Extension Manifest V3
├── popup/                     # 弹出面板 UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── sidepanel/                 # 侧边栏（主操作界面）
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── background/
│   └── service-worker.js      # Background Service Worker（API 调用在这里）
├── content/
│   ├── form-detector.js       # 表单检测：扫描页面所有表单字段
│   ├── form-filler.js         # 表单填写：把 AI 映射结果写入 DOM
│   ├── label-matcher.js       # 中文 label 快速匹配（正则，不过 AI）
│   └── file-uploader.js       # 简历文件上传（DataTransfer + drag-and-drop）
├── lib/
│   ├── ai-provider.js         # AI 模型统一接口（DeepSeek / Gemini 可切换）
│   ├── prompt-templates.js    # Prompt 模板集合
│   └── storage.js             # chrome.storage 封装
├── data/
│   └── default-profile.json   # 默认个人资料 schema 示例
├── icons/                     # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md                  # 项目文档（中文）
```

### 关键设计原则

1. **纯浏览器端运行**：所有 AI API 调用在 background service worker 中发起，无需后端服务器
2. **AI 调用最小化**：常见字段（姓名、手机、邮箱等）用中文 label 正则直接匹配，只有无法确定的字段才调 AI
3. **数据全部存本地**：个人资料、API key 等存在 `chrome.storage.local`，不上传任何服务器
4. **模块化设计**：form-detector、form-filler、label-matcher、ai-provider 各自独立，便于单独调试

## 核心模块详细设计

### 1. form-detector.js — 表单检测

参考 `smart-form-filler` 的 FormDetector 类设计，但做以下简化：

```javascript
// 核心职责：扫描当前页面（含 iframe）的所有表单字段，输出结构化描述
// 输出格式示例：
{
  forms: [
    {
      id: "form_0",
      name: "application-form",
      source: "main",       // "main" 或 "iframe"
      iframePath: "",        // iframe 时的路径
      fields: [
        {
          id: "field_0",
          name: "applicant_name",
          type: "text",        // text/email/tel/select/radio/checkbox/textarea/file/date
          label: "姓名",       // 从 <label>、aria-label、placeholder、title 提取
          placeholder: "请输入您的姓名",
          required: true,
          options: [],         // select/radio 的选项列表 [{value, text}]
          xpath: "...",        // 精确定位用
          selector: "...",     // CSS selector 备用
        }
      ]
    }
  ]
}
```

检测逻辑要点：
- 扫描 `<form>` 内和独立的 input/textarea/select 元素
- 支持 iframe 内的表单检测（try-catch 处理跨域）
- label 提取优先级：`<label for="...">` → `aria-label` → `placeholder` → `title` → 父元素文本
- 对 select 和 radio 提取所有选项
- 忽略 hidden、submit、button、password 类型

### 2. label-matcher.js — 中文 label 快速匹配

这是性能优化的关键。对常见的中文/英文 label 做正则匹配，命中则直接填写，不调 AI。

```javascript
// 匹配规则表（优先级从高到低）
const LABEL_RULES = [
  // 个人基本信息
  { pattern: /^(姓名|名字|name|full.?name|申请人)$/i, profileKey: "name" },
  { pattern: /(姓|last.?name|family.?name|surname)/i, profileKey: "lastName" },
  { pattern: /(名|first.?name|given.?name)/i, profileKey: "firstName" },
  { pattern: /(性别|gender|sex)/i, profileKey: "gender", type: "select" },
  { pattern: /(出生|生日|birth|birthday|date.?of.?birth)/i, profileKey: "birthday" },
  { pattern: /(民族|ethnicity|nationality)/i, profileKey: "ethnicity" },
  { pattern: /(籍贯|hometown|native.?place|出生地)/i, profileKey: "hometown" },
  { pattern: /(政治面貌|political|party)/i, profileKey: "politicalStatus" },
  { pattern: /(身份证|id.?card|id.?number)/i, profileKey: "idNumber" },

  // 联系方式
  { pattern: /(手机|电话|phone|mobile|tel|联系方式)/i, profileKey: "phone" },
  { pattern: /(邮箱|email|e-mail|电子邮件)/i, profileKey: "email" },
  { pattern: /(地址|address|通讯地址|现居住地)/i, profileKey: "address" },
  { pattern: /(微信|wechat)/i, profileKey: "wechat" },

  // 教育背景
  { pattern: /(学校|毕业院校|university|school|college|院校名称)/i, profileKey: "education.school" },
  { pattern: /(专业|major|学科)/i, profileKey: "education.major" },
  { pattern: /(学历|学位|degree|education.?level)/i, profileKey: "education.degree", type: "select" },
  { pattern: /(入学|start.?date|入学时间)/i, profileKey: "education.startDate" },
  { pattern: /(毕业|end.?date|graduation|毕业时间|毕业日期)/i, profileKey: "education.endDate" },
  { pattern: /(gpa|成绩|绩点|平均分)/i, profileKey: "education.gpa" },

  // 工作/实习经历
  { pattern: /(公司|company|employer|单位名称|工作单位)/i, profileKey: "experience[0].company" },
  { pattern: /(职位|岗位|position|title|job.?title)/i, profileKey: "experience[0].title" },

  // 链接
  { pattern: /(github)/i, profileKey: "links.github" },
  { pattern: /(linkedin)/i, profileKey: "links.linkedin" },
  { pattern: /(个人网站|website|portfolio|blog)/i, profileKey: "links.website" },

  // 简历/附件上传
  { pattern: /(简历|resume|cv|附件)/i, profileKey: "_resumeFile", type: "file" },
];
```

匹配流程：
1. 遍历 form-detector 输出的 fields
2. 用 field.label + field.placeholder + field.name 拼接文本
3. 按 LABEL_RULES 顺序匹配
4. 命中 → 从用户 profile 取值，标记为 "直接填写"
5. 未命中 → 收集到 "待 AI 处理" 列表

### 3. ai-provider.js — AI 模型统一接口

支持 DeepSeek API 和 Gemini API，统一输出格式。

```javascript
class AIProvider {
  constructor(config) {
    // config: { provider: "deepseek" | "gemini", apiKey: "...", model: "..." }
  }

  // 统一调用接口
  async complete(messages, options = {}) {
    // messages: [{ role: "system" | "user", content: "..." }]
    // options: { temperature, maxTokens, responseFormat: "json" }
    // 返回: { content: "...", usage: { promptTokens, completionTokens } }
  }
}

// DeepSeek: POST https://api.deepseek.com/chat/completions
//   model: "deepseek-chat" 或 "deepseek-reasoner"
//   标准 OpenAI 兼容格式

// Gemini: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
//   model: "gemini-2.0-flash" 或 "gemini-2.5-flash"
//   需要转换 messages 格式为 Gemini 的 contents 格式
```

### 4. prompt-templates.js — Prompt 模板

两阶段 prompt 设计（参考 smart-form-filler 的 formFillerController.js）：

**Stage 1: 表单相关性分析（多表单页面时使用）**
```
分析以下网页上的表单，确定哪个表单是求职申请表单。
页面表单结构：{formsJSON}
返回最相关的表单 ID 和置信度。JSON 格式：{ recommendedForm, confidence }
```

**Stage 2: 字段映射（核心 prompt）**
```
你是一个求职表单自动填写助手。根据用户的个人资料数据，为以下表单字段生成合适的填写值。

用户个人资料：
{profileJSON}

待填写的表单字段（这些是 label-matcher 无法自动匹配的字段）：
{unmatchedFieldsJSON}

要求：
1. 根据字段的 label、placeholder、type、options 理解字段语义
2. 从用户资料中找到最匹配的信息填入
3. 对于 select/radio 类型，你的 suggestedValue 必须是 options 中的某个 value
4. 对于开放式问题（如"为什么想加入我们"），基于用户资料生成简短合理的回答
5. 如果某字段无法从资料中推断，设置 confidence 为 0，不要编造

返回 JSON 格式：
{
  "fieldMappings": [
    {
      "fieldId": "field_x",
      "suggestedValue": "填写的值",
      "confidence": 0.95,
      "reasoning": "简短说明为什么这样填"
    }
  ]
}
```

### 5. form-filler.js — 表单填写

参考 smart-form-filler 的 FormFiller + ApplyEase 的 fillForm 逻辑：

```javascript
// 核心：拿到 fieldMappings 后，逐字段写入 DOM
// 关键技术点：
// 1. 用 xpath 或 CSS selector 定位元素
// 2. 设置值后必须触发 input/change/blur 事件（否则 React/Vue 框架不会响应）
// 3. select 元素需要匹配 option value
// 4. radio 需要找到对应 value 的 input 并 click
// 5. checkbox 需要判断当前状态再决定是否 click
// 6. date 类型需要格式化为 input[type=date] 的 YYYY-MM-DD 格式
// 7. iframe 内的元素需要通过 iframe.contentDocument 访问

function setValue(element, value) {
  element.focus();
  // 对于 React 受控组件，需要用 nativeInputValueSetter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.blur();
}
```

### 6. file-uploader.js — 简历上传

直接移植 ApplyEase 的逻辑：

```javascript
// 方案 1: DataTransfer API 直接设置 input.files
// 方案 2: 模拟 drag-and-drop 到 dropzone
// 方案 3: 如果以上都失败，高亮该 input 并提示用户手动选择文件
```

### 7. 用户个人资料 Schema (default-profile.json)

```json
{
  "name": "张三",
  "firstName": "三",
  "lastName": "张",
  "gender": "男",
  "birthday": "1999-01-15",
  "ethnicity": "汉族",
  "hometown": "上海市",
  "politicalStatus": "共青团员",
  "idNumber": "",
  "phone": "13800138000",
  "email": "zhangsan@example.com",
  "address": "上海市浦东新区xxx路xxx号",
  "wechat": "zhangsan_wx",

  "education": {
    "school": "上海交通大学",
    "major": "计算机科学与技术",
    "degree": "本科",
    "startDate": "2017-09",
    "endDate": "2021-06",
    "gpa": "3.8/4.0"
  },

  "experience": [
    {
      "company": "字节跳动",
      "title": "后端开发实习生",
      "startDate": "2020-07",
      "endDate": "2020-12",
      "description": "参与推荐系统开发，使用 Go 语言..."
    }
  ],

  "skills": ["Python", "JavaScript", "React", "Node.js", "Docker", "Linux"],

  "links": {
    "github": "https://github.com/zhangsan",
    "linkedin": "",
    "website": ""
  },

  "selfIntro": "具有扎实的计算机基础和丰富的项目经验...",

  "resumeFilePath": ""
}
```

## UI 设计

### Side Panel（主界面）

侧边栏分三个 tab：

1. **填写** — 主操作页
   - 顶部：当前页面检测到 X 个表单字段
   - "一键填写" 按钮（大按钮，醒目）
   - 填写结果列表：每个字段显示 [字段名] → [填写值] [✅/⚠️]
   - 对于 confidence < 0.7 的字段标黄，让用户确认
   - 对于无法填写的字段标红

2. **资料** — 个人信息管理
   - 分区显示：基本信息、联系方式、教育背景、工作经历、技能、链接
   - 每个字段可编辑
   - 支持导入/导出 JSON
   - 支持上传简历 PDF（存在 extension storage 中）

3. **设置** — 配置页
   - AI 模型选择：DeepSeek / Gemini 切换
   - API Key 输入框
   - 模型选择（deepseek-chat / gemini-2.0-flash 等）
   - 高级选项：temperature、是否启用 AI（关闭则只用正则匹配）

### Popup（简略版）

点击工具栏图标弹出的小窗口：
- 显示当前页面检测到的表单数量
- "一键填写" 快捷按钮
- "打开侧边栏" 按钮

## 技术要求

### 代码规范
- 代码和变量名使用英文
- 注释和文档使用中文
- 使用 ES6+ 语法，async/await
- 不使用任何构建工具（纯原生 JS，Chrome Extension 直接加载）
- 不使用任何 UI 框架（原生 HTML/CSS/JS）

### Chrome Extension 规范
- Manifest V3
- 使用 service worker（不是 background page）
- Content Scripts 注入到 `<all_urls>`
- 权限最小化：activeTab, storage, scripting, sidePanel

### AI API 调用
- 所有 API 调用在 background service worker 中发起（content script 通过 chrome.runtime.sendMessage 请求）
- 超时处理：10 秒超时
- 错误处理：API 失败时 graceful degrade（只用正则匹配的结果）
- token 用量预估显示

### 安全
- API Key 存在 chrome.storage.local，不硬编码
- 不向任何第三方服务器发送用户个人数据
- 只向用户配置的 AI API endpoint 发送表单结构 + 用户资料

## 参考代码来源

本项目核心逻辑参考以下开源项目（均已审查代码）：

1. **表单检测**：参考 `hddevteam/smart-form-filler` 的 `extension/src/modules/formDetector.js`（922行）
   - 重点参考：iframe 扫描、label 提取优先级、xpath 生成
   - GitHub: https://github.com/hddevteam/smart-form-filler

2. **AI 字段映射 prompt**：参考 `smart-form-filler` 的 `backend/controllers/formFillerController.js`（862行）
   - 重点参考：两阶段 prompt 设计、JSON 输出格式约束
   
3. **表单填写 + 简历上传**：参考 `sainikhil1605/ApplyEase` 的 `contentscript.js`（537行）
   - 重点参考：React 受控组件兼容的 setValue、DataTransfer 文件上传、drag-and-drop fallback
   - GitHub: https://github.com/sainikhil1605/ApplyEase

4. **DeepSeek 适配器**：参考 `smart-form-filler` 的 `backend/services/gptService/modelAdapters/DeepSeekAdapter.js`

## 开发顺序

### Phase 1: MVP（最小可用）
1. 搭建 Chrome Extension 脚手架（manifest.json, 基本文件结构）
2. 实现 form-detector.js — 能扫描并输出表单结构
3. 实现 label-matcher.js — 中文正则匹配常见字段
4. 实现 storage.js + 个人资料管理 UI（sidepanel 的"资料" tab）
5. 实现 form-filler.js — 能根据匹配结果填写表单
6. 测试：用一个本地 HTML 模拟校招表单来测试

### Phase 2: AI 增强
7. 实现 ai-provider.js（DeepSeek + Gemini 双模型）
8. 实现 prompt-templates.js
9. 在 service-worker.js 中实现 AI 字段映射流程
10. 实现侧边栏"填写" tab 的完整交互

### Phase 3: 完善
11. 实现 file-uploader.js（简历上传）
12. 实现设置页面
13. 实现 popup 快捷面板
14. 添加填写结果的 confidence 可视化
15. 测试各类真实网站

## 测试用 HTML 表单

请在开发时创建一个 `test/test-form.html`，模拟典型的中国校招申请表单：

```html
<!-- 包含以下字段：
  - 姓名、性别（下拉）、出生日期、民族、籍贯、政治面貌（下拉）
  - 手机号、邮箱、微信
  - 毕业院校、专业、学历（下拉：本科/硕士/博士）、毕业时间、GPA
  - 实习经历（公司名、职位、起止时间、工作描述 textarea）
  - 技能特长 textarea
  - 自我评价 textarea
  - 为什么想加入我们 textarea（开放式问题，测试 AI 生成能力）
  - 简历上传 file input
  - 期望薪资（下拉）
  - 可到岗时间（下拉）
-->
```

## CLAUDE.md 内容结束


