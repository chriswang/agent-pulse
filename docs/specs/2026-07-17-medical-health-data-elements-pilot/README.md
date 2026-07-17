# 医疗健康数据要素行业试跑

- 状态：首轮结果因信源、领域门禁与趋势隔离失效而暂停；30 天基线重建中
- 日期：2026-07-17
- 目标版本：Unreleased
- 上游基线：`barretlee/agent-pulse@b86923f`

本规格把 Agent Pulse 作为持续升级的上游产品内核，在不复制其 AI 行业数据的前提下，增加一个公开的“医疗健康数据要素”行业包。行业包拥有独立信源、领域规则、30 天证据基线、趋势叙事、仓库快照、首页和 GitHub Actions；模型通过 OpenAI-compatible 适配层接入火山方舟 `glm-5.2`，但 30 天基线阶段明确不调用模型。

公开 Fork：<https://github.com/chriswang/agent-pulse>；行业站点配置为 <https://chriswang.github.io/agent-pulse/>。Fork 仅保留 CI、行业基线和行业页面工作流；上游的数据刷新、发布、监控、质量门禁、审计及提案工作流均已关闭。行业基线工作流在 GitHub 信源复审通过前保持手动停用。

## 文档

- [PRD](PRD.md)：试跑目标、用户与验收口径
- [SYSTEM](SYSTEM.md)：上游隔离、行业包、模型与发布设计
- [TEST](TEST.md)：自动化、真实信源、真实模型与 Pages 验证
- [TASKS](TASKS.md)：30 天证据基线、后续 7 天试跑与验收清单

## 核心原则

```text
upstream product kernel + isolated public industry pack + private runtime secrets
```

行业包和公开结果可进入仓库；模型密钥只进入 GitHub Actions Secret。方舟使用 Coding API `https://ark.cn-beijing.volces.com/api/coding/v3`，Coding Plan Key 不进入仓库、快照、日志或公开页面。

2026-07-17 首轮运行只证明英文 RSS 与模型结构化链路可运行，不能证明医疗健康数据要素情报有效。试跑工作流已手动停用，现有公开 Event 不作为基线或验收成绩。恢复运行前必须满足：

- 约 80% 中国行业内容、20% 国际对标；
- 至少 12 个中文核心来源通过 GitHub 真实采集；
- 相关性、中文化、聚类、证据独立性和行业评分进入硬门禁；
- 行业趋势只读取行业包的 30 天证据基线，不回退到上游 AI 行业 Narrative；
- 当前偏题 Event 退出公开结果并保留可审计拒绝原因。

本地重建审计已达到 12 个中国独立发布机构和 3 个国际发布机构，且内容日期均在 90 天内；这只是本地准入证据，必须由无模型、无部署的 GitHub source audit 再验证后，才启动 2026-07-17—2026-08-15 的 30 天基线。

## 已拒绝的 Day 1 技术运行

- 18 个 ready 来源全部为英文，264 条 Signal 全部为英文；
- 行业关键词未进入采集或发布门禁，宽泛公共卫生内容被错误归入行业主线；
- 聚类与研究筛选仍依赖 AI 行业实体和关键词，30 个 Event 均只有一个 Signal；
- 自动 Event 影响分固定为 55，而高优先级门槛要求 80，验收条件不可达；
- 医疗 Track 与上游 AI Narrative slug 不匹配，趋势阶段为空；
- 7 个已发布 Event 均不作为有效行业成果，工作流保持停用直至本规格的新门禁全部通过。
