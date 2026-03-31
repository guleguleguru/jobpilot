# Compatibility Matrix

这个文件用于跟踪 JobPilot 在真实招聘网站和 ATS 页面上的兼容情况。

目标不是一次写完，而是每测一个站点就补一条，持续积累。

## Status Legend

- `working`: 检测、匹配、填写、上传基本可用
- `partial`: 部分可用，有明显限制或需要人工介入
- `blocked`: 当前不可用，存在明确阻塞
- `untested`: 尚未验证

## Test Checklist

每次验证建议至少记录以下项目：

- 页面是否能检测到表单
- 常见字段是否能规则匹配
- AI 字段补全是否正常
- select / radio / checkbox 是否可填写
- 简历文件上传是否可用
- 是否存在同源或跨域 iframe
- 是否需要站点特化逻辑

## Matrix

| Site / ATS | Region | Form Detection | Basic Fill | AI Fill | Resume Upload | iframe | Status | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Local test form | CN | yes | yes | yes | yes | no | working | `test/test-form.html` 本地验证页 |
| 中国太平招聘官网 / cntp.zhiye.com | CN | yes | yes | untested | untested | unknown | partial | 2026-03-31 使用真实 Edge 登录态复测：表单页可进入，检测到 1 个表单 / 61 个字段，基础匹配 21 项，填写结果 27 filled / 3 skipped / 0 errors，重复区块新增与填写正常；AI 填写与简历上传本轮未测，因此整体仍保留 `partial` |
| Boss 直聘 | CN | untested | untested | untested | untested | unknown | untested |  |
| 牛客校招 | CN | untested | untested | untested | untested | unknown | untested |  |
| 智联招聘 | CN | untested | untested | untested | untested | unknown | untested |  |
| 前程无忧 / 51Job | CN | untested | untested | untested | untested | unknown | untested |  |
| 猎聘 | CN | untested | untested | untested | untested | unknown | untested |  |
| Greenhouse | Global | untested | untested | untested | untested | unknown | untested |  |
| Lever | Global | untested | untested | untested | untested | unknown | untested |  |
| Workday | Global | untested | untested | untested | untested | unknown | untested | 常见 iframe / 动态表单风险 |
| SuccessFactors | Global | untested | untested | untested | untested | unknown | untested |  |

## Known Compatibility Constraints

- 跨域 `iframe` 无法直接读取或填写，这是浏览器安全限制
- 某些自定义上传控件不暴露标准 `input[type=file]`，只能回退到手动上传
- 一些 React / Vue / 内部组件库会延迟渲染字段，需要重新检测或分步填写

## How To Update

新增或更新站点记录时，建议附带：

- 测试日期
- 测试页面类型
- Chrome 版本
- AI 是否开启
- 遇到的异常字段示例

如果发现稳定复现的问题，也应同步更新 `CHANGELOG.md` 或单独开 issue。
