# Contributing

感谢你对 JobPilot 的关注。

这个项目当前仍处于快速迭代阶段。为了减少回归和低质量 issue，提交改动前请先阅读下面这些约定。

## Development Principles

- 优先修真实用户场景中的兼容问题
- 优先避免误填、乱填，其次才是“尽量多填”
- 不引入不必要的构建系统和复杂依赖
- 保持本地优先和权限透明

## Before Opening An Issue

提 issue 前请先确认：

- 使用的是最新代码或最新发布版本
- 已阅读 `README.md`
- 已查看 `COMPATIBILITY.md`
- 问题可以稳定复现，或至少能提供页面类型和字段示例

## Before Sending A Pull Request

请尽量做到：

- 变更范围聚焦，不要把不相关重构混在一起
- 不提交真实 API Key、个人资料或简历文件
- 修改逻辑后同步补测试或补说明
- 如果影响行为，更新 `README.md`、`CHANGELOG.md` 或 `COMPATIBILITY.md`

## Local Checklist

提交前建议至少执行：

```bash
node test/run-tests.js
```

以及：

- 在 `chrome://extensions` 中重新加载扩展
- 用 `test/test-form.html` 做一次基本回归
- 如果改动涉及真实站点兼容性，更新 `COMPATIBILITY.md`

## What Kind Of Contributions Are Most Useful

- 真实招聘站点 / ATS 的兼容性修复
- 表单检测、选择框、单选框、上传控件的稳定性改进
- PDF 解析准确率提升
- 测试补充
- 权限、隐私、数据流文档改进

## Security And Privacy

如果你发现的是安全问题或隐私风险，不建议直接公开贴出敏感细节。请使用维护者指定的联系方式私下沟通。

当前仓库尚未配置专门的安全通道时，可先开一个不含敏感细节的 issue，标注为 security-related。
