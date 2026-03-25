# JobPilot v0.4.0

首个适合公开发布的版本。

JobPilot 是一个 AI 驱动的 Chrome 扩展，目标是在招聘网站和 ATS 页面上自动识别并填写求职表单。这个版本已经具备本地加载、基础资料管理、AI 辅助填写、PDF 简历导入和多模板切换的完整工作流。

## Highlights

- 支持在任意招聘页面检测和填写表单
- 支持规则优先匹配，减少 AI 调用成本
- 支持 7 个 AI 服务商：DeepSeek、Gemini、Qwen、GLM、Moonshot、Claude、Ollama
- 支持多份简历模板切换
- 支持从 PDF 简历导入资料
- 支持简历文件自动上传
- 支持 React / Vue 受控表单兼容填写

## Included In This Release

- Chrome Extension Manifest V3 基础架构
- Side Panel 主操作界面
- Popup 快捷操作面板
- Background Service Worker AI 调用链路
- 表单检测、规则匹配、DOM 填写、文件上传模块
- 本地存储封装与历史记录
- PDF 解析与导入流程

## Release Notes

### New

- 新增多 AI 服务商统一接入层
- 新增多简历模板支持
- 新增 PDF 简历导入与字段预览
- 新增填写历史记录
- 新增快捷键 `Alt+J`

### Improved

- 完善 React / Vue 场景下的表单写入兼容
- 优化 AI 填写结果展示与低置信度提示
- 优化文件上传失败时的手动兜底体验

### Fixed Before Release

- 修复同源 `iframe` 字段能检测但不能正确回填的问题
- 修复多模板结构下教育经历没有正确传给 AI 的问题
- 修复 Ollama 模式仍被错误要求填写 API Key 的问题

## Notes

- 当前仍以“本地加载扩展”方式使用，不包含 Chrome Web Store 发布流程
- 跨域 `iframe` 仍受浏览器安全限制，无法直接读取和填写
- AI 填写质量取决于页面字段语义和资料完整度

## Suggested GitHub Release Title

`v0.4.0 - First public release`
