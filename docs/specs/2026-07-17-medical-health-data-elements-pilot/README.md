# 医疗健康数据要素行业试跑

- 状态：首轮云端运行已完成，7 天连续试跑进行中
- 日期：2026-07-17
- 目标版本：Unreleased
- 上游基线：`barretlee/agent-pulse@b86923f`

本规格把 Agent Pulse 作为持续升级的上游产品内核，在不复制其 AI 行业数据、不改写通用采集治理规则的前提下，增加一个公开的“医疗健康数据要素”行业包。行业包拥有独立信源、独立仓库快照、独立首页和独立 GitHub Actions；模型通过 OpenAI-compatible 适配层接入火山方舟 `glm-5.2`。

公开 Fork：<https://github.com/chriswang/agent-pulse>；行业站点配置为 <https://chriswang.github.io/agent-pulse/>。Fork 仅保留 CI、行业试跑和行业页面工作流启用，上游的数据刷新、发布、监控、质量门禁、审计及提案工作流均已关闭。

## 文档

- [PRD](PRD.md)：试跑目标、用户与验收口径
- [SYSTEM](SYSTEM.md)：上游隔离、行业包、模型与发布设计
- [TEST](TEST.md)：自动化、真实信源、真实模型与 Pages 验证
- [TASKS](TASKS.md)：实施与 7 天验收清单

## 核心原则

```text
upstream product kernel + isolated public industry pack + private runtime secrets
```

行业包和公开结果可进入仓库；模型密钥只进入 GitHub Actions Secret。方舟使用 Coding API `https://ark.cn-beijing.volces.com/api/coding/v3`，Coding Plan Key 不进入仓库、快照、日志或公开页面。

## Day 1 本地实测基线

- 30 个配置来源：21 个自动候选、9 个人工原始证据入口；
- 自动候选审计：19 healthy、2 degraded，健康率 90.5%；
- 18 个达到内容质量门槛的来源进入试跑，单次回溯采集 264 条 Signal，0 个运行错误；
- 确定性聚类形成 30 个 review Event，234 条低事件性 Signal 保留在可逆分诊池；
- 未配置方舟 Key 时 30 个 Event 全部被发布门禁阻断，未伪造模型结论或公开高优先级判断；
- 多来源 Event、Top 10 决策价值、人工聚类准确率和节省时间仍需连续 7 天验证。

## Day 1 云端试跑

- GitHub Actions 完成 audit、collect、Ark enrichment、发布门禁、隐私校验、快照提交和 Pages 部署；
- 21 个自动来源中 17 healthy、2 degraded、2 failed；36 次来源运行成功 34 次，采集成功率 94.4%，达到 90% 目标；
- `glm-5.2` 处理 8 个候选，7 个生成有效 JSON 并通过本地 Schema，1 个截断响应被安全拒绝；
- 模型用量为 5,342 prompt tokens、8,835 completion tokens，共 14,177 tokens；
- 累计公开 7 个 Event，其中最近 7 天窗口内 6 个；264 条 Signal 均保留原始来源回链；
- 多来源 Event、高优先级 Event 和人工指标仍为 0 / pending，继续作为后续 6 天的主要验证项。
