# JobPilot 智投助手

AI 驱动的 Chrome 浏览器扩展，用于在招聘网站和 ATS 页面上自动识别并填写求职表单。

项目面向中文求职场景设计，支持校招官网、企业招聘系统和通用 ATS，也兼容常见海外平台。

> 一个面向中文求职场景的 AI Chrome 扩展：自动检测表单、匹配字段、填写资料，并支持 PDF 简历导入和多模板管理。

## GitHub 展示文案

仓库简介（短）：

`AI-powered Chrome extension for auto-filling job application forms, built for Chinese recruiting sites and ATS workflows.`

仓库简介（中文）：

`面向中文求职场景的 AI Chrome 扩展，可自动识别并填写招聘表单，支持多模板资料、PDF 简历导入和多模型 AI 补全。`

## 当前状态

- 已可作为本地加载的 Chrome 扩展使用
- 无需构建，无 npm 依赖，纯原生 HTML / CSS / JavaScript
- 当前版本：`0.5.0`

## 核心能力

- 通用表单检测：扫描页面中的 `input` / `textarea` / `select`，支持同源 `iframe`
- 规则优先匹配：40+ 中英文规则直接匹配常见字段，减少 AI 调用
- AI 辅助补全：对无法规则命中的字段调用大模型生成建议值
- 多模板资料管理：支持多份简历资料切换、复制、删除
- PDF 简历导入：支持本地快速解析或 AI 智能解析
- 简历文件上传：支持 `DataTransfer`、拖放和手动兜底
- React / Vue 兼容填写：触发原生事件，尽量适配受控组件

## 支持的 AI 服务商

- DeepSeek
- Google Gemini
- 通义千问
- 智谱 GLM
- Moonshot / Kimi
- Claude
- Ollama

说明：

- 所有 API Key 保存在 `chrome.storage.local`
- 不内置任何服务端
- AI 请求由浏览器扩展直接发往用户自己配置的服务商接口

## 项目结构

```text
jobpilot/
├── manifest.json
├── background/
├── content/
├── data/
├── icons/
├── lib/
├── popup/
├── sidepanel/
├── test/
├── tools/
└── README.md
```

## 安装方式

1. 克隆仓库

```bash
git clone <your-repo-url>
```

2. 打开 Chrome，进入 `chrome://extensions`
3. 打开右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择当前项目目录

## 使用方式

1. 点击扩展图标，打开侧边栏
2. 在“资料”页填写个人信息，或导入 JSON / PDF
3. 在“设置”页配置 AI 服务商与 API Key
4. 打开任意招聘申请页面，点击“一键填写”

也可以使用快捷键 `Alt+J` 执行仅规则匹配的快速填写。

## 权限说明

扩展当前使用以下关键权限：

- `storage`：保存个人资料、设置、历史记录和简历文件
- `activeTab` / `scripting`：与当前标签页交互
- `sidePanel`：打开侧边栏界面
- `host_permissions: <all_urls>`：为了在任意招聘站点上识别和填写表单

`<all_urls>` 是这个项目正常工作的必要条件。项目不会将页面数据主动上传到自建服务器；只有在用户启用 AI 且配置 API Key 后，才会把表单字段结构和资料摘要发送给对应 AI 服务商。

## 隐私说明

- 用户资料、API Key、填写历史保存在浏览器本地
- 不内置数据收集、统计或远程上报
- AI 请求只会发送给用户自己选择的模型服务商
- 填写历史仅记录页面 URL 与统计数字，不记录完整填写内容

更正式的隐私说明见 `PRIVACY.md`。

## 维护文档

- `PRIVACY.md`：隐私与数据流说明
- `COMPATIBILITY.md`：真实站点兼容性跟踪
- `docs/project-progress.md`：项目进度表与后续执行清单
- `CHANGELOG.md`：版本与维护变更记录
- `CONTRIBUTING.md`：贡献与提 issue 说明

## 测试

仓库包含本地测试页面：

- `test/test-form.html`

也提供了不依赖第三方库的 Node 原生单元测试：

```bash
npm test
```

修改代码后，在 `chrome://extensions` 页面点击刷新即可重新加载扩展。

真实站点验证建议记录到 `COMPATIBILITY.md`。

## 已知限制

- 跨域 `iframe` 无法被浏览器扩展直接读取或填写
- 某些自定义上传控件仍可能需要用户手动选择文件
- AI 填写质量依赖页面字段语义和用户资料完整度

## 开源许可

本项目采用 MIT License，见 `LICENSE`。
