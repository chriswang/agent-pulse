# 医疗健康数据要素行业试跑

- 状态：本地 Demo 已完成，GitHub 接入中
- 日期：2026-07-17
- 目标版本：Unreleased
- 上游基线：`barretlee/agent-pulse@b86923f`

本规格把 Agent Pulse 作为持续升级的上游产品内核，在不复制其 AI 行业数据、不改写通用采集治理规则的前提下，增加一个公开的“医疗健康数据要素”行业包。行业包拥有独立信源、独立仓库快照、独立首页和独立 GitHub Actions；模型通过 OpenAI-compatible 适配层接入火山方舟 `glm-5.2`。

## 文档

- [PRD](PRD.md)：试跑目标、用户与验收口径
- [SYSTEM](SYSTEM.md)：上游隔离、行业包、模型与发布设计
- [TEST](TEST.md)：自动化、真实信源、真实模型与 Pages 验证
- [TASKS](TASKS.md)：实施与 7 天验收清单

## 核心原则

```text
upstream product kernel + isolated public industry pack + private runtime secrets
```

行业包和公开结果可进入仓库；模型密钥只进入 GitHub Actions Secret。方舟默认使用标准模型 API，Coding Plan Key 不作为通用应用 API Key 使用。

## Day 1 实测基线

- 30 个配置来源：21 个自动候选、9 个人工原始证据入口；
- 自动候选审计：19 healthy、2 degraded，健康率 90.5%；
- 18 个达到内容质量门槛的来源进入试跑，单次回溯采集 264 条 Signal，0 个运行错误；
- 确定性聚类形成 30 个 review Event，234 条低事件性 Signal 保留在可逆分诊池；
- 未配置方舟 Key 时 30 个 Event 全部被发布门禁阻断，未伪造模型结论或公开高优先级判断；
- 多来源 Event、Top 10 决策价值、人工聚类准确率和节省时间仍需连续 7 天验证。
