# CHANGELOG

## Unreleased

### 2026-03-29

- Generalized repeat-section creation so `education`, `languages`, and `familyMembers` reuse shared add-button detection instead of site-specific hardcoding
- Moved repeat add-button discovery into the base site adapter and kept site adapters focused on section keywords and control interaction
- Improved repeat-section detection with stronger `repeatGroupKey` handling and duplicate-id-safe selectors for DOMs that reuse the same `id`
- Tightened repeat counting so sections prefer detected repeat containers over repeated generic labels like `startDate` and `endDate`
- Verified the China Taiping real form flow can now auto-add and fill the second `education`, `languages`, and `familyMembers` entries
- Kept frame fill timeouts and error propagation in the service worker so stuck frame writes fail fast instead of hanging indefinitely

## v0.5.0 — Phase 5 站点适配与发布整理

### Functional enhancements

- 增强字段语义识别：字段检测新增 `helperText`、`sectionLabel`、`contextText`，匹配不再只依赖 `label / placeholder / name`
- 扩展中国招聘场景结构化字段：新增期望城市、到岗时间、期望薪资、实习时长、毕业年份、证件类型、项目经历、奖项、语言能力
- 资料侧边栏新增对应表单区块和结构化卡片编辑能力
- PDF 本地解析扩展到求职偏好、项目经历、奖项、语言能力等字段
- PDF 本地解析升级为按 section 分段提取教育、实习、项目、奖项和技能，不再只做全文正则扫词
- PDF 本地解析新增读取链接注释，可提取 GitHub 等 PDF 内嵌超链接
- AI prompt 清洗和字段摘要新增上述结构化字段与上下文信息

### Repository and maintenance

- 新增标准开源仓库文件：`README.md`、`.gitignore`、`LICENSE`
- 新增公开发布用文案：`RELEASE-v0.5.0.md`
- 新增隐私说明：`PRIVACY.md`
- 新增兼容性跟踪台账：`COMPATIBILITY.md`
- 新增贡献说明：`CONTRIBUTING.md`
- 新增 GitHub issue 模板：bug report / compatibility report
- 新增零依赖本地测试入口：`package.json` + `test/run-tests.js`

### Fixes

- 修复同源 `iframe` 字段在检测后无法正确传递给填写链路的问题
- 修复多模板结构下 `education` 数据没有被正确带入 AI prompt 的问题
- 修复 Ollama 模式被错误要求必须填写 API Key 的问题

### Verification

- 新增 8 个本地测试用例，覆盖：
  - PDF 路径读写
  - PDF 本地解析与新增字段提取
  - AI prompt 数据清洗
  - AI 选项值修正

## v0.4.0 — Phase 4 功能增强

### Module A: 多 AI 服务商支持

- 新增支持 7 个 AI 服务商：DeepSeek、Google Gemini、通义千问（Qwen）、智谱 GLM、Moonshot/Kimi、Claude（Anthropic）、本地 Ollama
- `lib/ai-provider.js` 全面重构：
  - `callOpenAI()` — 统一处理 OpenAI 兼容格式（DeepSeek、Qwen、GLM、Moonshot、Ollama）
  - `callGemini()` — 独立 Gemini 格式处理（systemInstruction、role:model）
  - `callAnthropic()` — 独立 Anthropic 格式处理（x-api-key、anthropic-version 头）
  - `checkOllamaRunning()` — Ollama 健康检查（GET /api/tags，3s 超时）
  - `PROVIDER_PRESETS` — 7 个服务商预设（名称、baseUrl、模型列表、格式、是否需要 API Key）
  - `extractJSON()` — 带代码块和括号匹配的健壮 JSON 提取
- 设置页面 UI 更新：
  - 服务商下拉列表（7 选项）
  - 动态模型选择（随服务商切换）
  - Ollama 模式隐藏 API Key 行，显示使用说明
  - 「测试连接」按钮（直接在 sidepanel 调用 AI，无需经过 service worker）

### Module C: 多简历模板

- `lib/storage.js` 全面重构，新增多模板支持：
  - 存储结构：`profiles`（对象，key 为模板 ID）+ `activeProfile`（当前模板 ID）
  - `migrateToMultiProfile()` — 幂等迁移，将旧 `userProfile` 数据迁移到多模板格式
  - `getProfiles()`、`getActiveProfileId()`、`getActiveProfileData()`、`saveActiveProfileData()`
  - `setActiveProfile(id)`、`createProfile(name, data?)`、`duplicateProfile(id, name)`
  - `deleteProfile(id)` — 禁止删除最后一个模板，自动切换至其他模板
  - `renameProfile(id, name)`
  - 向后兼容：`getProfile()` → `getActiveProfileData()`，`saveProfile()` → `saveActiveProfileData()`
- 侧边栏「资料」Tab 更新：
  - 顶部模板选择器（下拉列表 + 新建 / 复制 / 删除按钮）
  - 切换模板时自动保存当前编辑
  - 新建 / 复制 / 删除 / 重命名操作（通过 `prompt()` / `confirm()` 交互）
- 「填写」Tab 预览区显示当前模板名称
- Popup 面板新增模板选择行，可快速切换模板（直接读写 `chrome.storage.local`）

### Module B: PDF 简历导入

- 新增 `lib/pdf-parser.js`：
  - `PROFILE_DISPLAY_FIELDS` — 26 个字段定义（key、label、存储路径）
  - `getFieldValue(obj, path)` / `setFieldValue(obj, path, value)` — 深路径读写
  - `extractPdfText(pdfFile, pdfjsLib)` — 按 Y 坐标分行提取 PDF 文本
  - `parseLocalRegex(text)` — 本地正则解析（手机、邮箱、GitHub、学校、专业、学历、日期范围、GPA、工作经历、技能、自我介绍）
  - `buildAiParsePrompt(text)` — 构建 AI 解析 prompt（截断至 6000 字符）
- 新增 `lib/pdfjs-loader.js`：懒加载 pdf.js ESM 模块，缓存实例，设置 worker URL
- 新增 `tools/download-pdfjs.bat`：自动下载 pdf.js v4.9.155 到 `lib/` 目录
- 侧边栏「资料」Tab 新增 PDF 导入流程：
  1. 选择 PDF 文件
  2. 选择解析方式（本地快速解析 / AI 智能解析）
  3. 字段对比预览（勾选要导入的字段，显示当前值与解析值）
  4. 确认导入，合并到当前模板

### 其他更新

- `manifest.json` 版本升级至 0.5.0
- `web_accessible_resources` 新增 `lib/pdf.min.mjs`、`lib/pdf.worker.min.mjs`
- 侧边栏 CSS 新增 PDF 模态框、模板选择器、测试连接等样式

---

## v0.3.0 — Phase 3 完善功能

- `content/file-uploader.js`：简历文件上传（DataTransfer → drag-drop → 高亮提示三级回退）
- 侧边栏填写体验：填写预览区、阶段提示、点击高亮、内联编辑、重新填写按钮
- Popup 重新设计：状态卡片、字段计数、API Key 警告横幅
- 填写历史记录（最近 20 条，存储 URL + 统计数据）
- `Alt+J` 快捷键一键填写（仅用正则匹配，无需 AI）
- Service Worker keepalive port（防止 30s 睡眠导致 AI 调用中断）
- `setup.bat` / `update.bat` Windows 辅助脚本

---

## v0.2.0 — Phase 2 AI 增强

- `lib/ai-provider.js`：DeepSeek + Gemini 双模型统一接口
- `lib/prompt-templates.js`：两阶段 prompt 设计（表单相关性分析 + 字段映射）
- Service Worker AI 字段映射流程（正则未命中的字段交给 AI）
- 侧边栏填写结果可视化（✅ 正则 / 🤖 AI / ⚠️ 低置信度 / ❌ 错误）

---

## v0.1.0 — Phase 1 MVP

- Chrome Extension Manifest V3 脚手架
- `content/form-detector.js`：扫描页面表单字段（含 iframe）
- `content/label-matcher.js`：中文 label 正则快速匹配（40+ 规则）
- `content/form-filler.js`：React/Vue 兼容的表单填写
- `lib/storage.js`：chrome.storage 封装
- 侧边栏三 Tab UI（填写 / 资料 / 设置）
- `test/test-form.html`：校招申请表单测试页面
