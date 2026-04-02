# Debug Replay Evaluation

Mode: leave-one-out
Generated: 2026-04-01T03:45:51.164Z

| 文件 | 原始命中 | 当前基线 | 训练后 | 未映射下降 | 必填缺失下降 |
| --- | ---: | ---: | ---: | ---: | ---: |
| jobpilot-debug-cntp.zhiye.com-20260328-130658.json | 2/61 | 1/61 | 2/61 | 1 | 0 |
| jobpilot-debug-cntp.zhiye.com-20260328-220246.json | 26/61 | 5/61 | 6/61 | 1 | 0 |
| jobpilot-debug-join.qq.com-20260331-175723.json | 16/60 | 16/60 | 16/60 | 0 | 0 |
| jobpilot-debug-talent.antgroup.com-20260331-174545.json | 12/30 | 9/30 | 10/30 | 1 | 0 |

## Aggregate

- Original matched: 56/212
- Current baseline matched: 31/212
- Trained replay matched: 34/212
- Baseline unmapped fields: 111
- Trained unmapped fields: 108
- Baseline missing required fields: 35
- Trained missing required fields: 35

## Top Remaining Clusters

| 类别 | 次数 | 标签示例 | 站点 | 建议 |
| --- | ---: | --- | --- | --- |
| detector_or_label_gap | 27 | 请输入 | cntp.zhiye.com | 优先修表单检测和标签提取质量 |
| manual_or_no_autofill | 2 | 本人已详细阅读蚂蚁集团招聘信息声明并理解其中内容 | talent.antgroup.com | 保持人工确认，不建议默认自动填写 |
| schema_gap | 2 | 开发语言* | join.qq.com | 补 canonical schema 或 customFields 归档规则 |
| structural_control | 2 | 起止时间* | join.qq.com | 补结构启发式或控件交互逻辑 |
| detector_or_label_gap | 2 | 请输入 | cntp.zhiye.com | 优先修表单检测和标签提取质量 |
| manual_or_no_autofill | 2 | 应聘者声明 | cntp.zhiye.com | 保持人工确认，不建议默认自动填写 |
| schema_gap | 1 | 参加面试城市* | join.qq.com | 补 canonical schema 或 customFields 归档规则 |
| detector_or_label_gap | 1 | 成绩排名 | join.qq.com | 优先修表单检测和标签提取质量 |
| detector_or_label_gap | 1 | 出生日期 | cntp.zhiye.com | 优先修表单检测和标签提取质量 |
| schema_gap | 1 | 大赛等级 | talent.antgroup.com | 补 canonical schema 或 customFields 归档规则 |
| schema_gap | 1 | 大赛经历 | talent.antgroup.com | 补 canonical schema 或 customFields 归档规则 |
| detector_or_label_gap | 1 | 当前所处地 | join.qq.com | 优先修表单检测和标签提取质量 |

