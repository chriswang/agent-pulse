# SYSTEM：行业包、方舟适配与 GitHub 运行

## 1. 仓库与数据隔离

```text
upstream = barretlee/agent-pulse
origin   = chriswang/agent-pulse

上游通用代码 ───────────────┐
                            ├─ build / test / collectors / governance
industry-packs/medical-health-data-elements/
  profile.json              ├─ source and page configuration
  rules.json                ├─ scope, aliases, scoring and publication policy
  narratives.json           ├─ 30-day evidence baseline and track judgments
  data/snapshot.json        ├─ fork-only runtime state
  data/pilot-report.json    └─ seven-day acceptance evidence
```

上游 `data/snapshot/v1.json` 不进入本行业运行。Fork 的专用工作流显式设置 `INDUSTRY_PROFILE` 与 `REPOSITORY_SNAPSHOT_PATH`；上游写数据的 workflow 在 Fork 中由仓库状态禁用，不通过长期改写上游 workflow 来维持隔离。

## 2. 行业包契约

`profile.json` 经过 Zod 校验，包含：

- slug、名称、说明和公开页面文案；
- 关注对象、主题、竞品组与关键词；
- 20—30 个来源，含 tier、role、采集方式、生命周期、合规说明与用途；
- 六条行业观察主线；
- 7 天试跑阈值与人工验收字段说明。

行业模式下 fresh database 只 seed 该行业包来源和主线，不 seed 上游 AI 行业历史 Event、Actor、资源或 Narrative。来源默认 `shadow`；`trial.readySourceSlugs` 只列入本轮已经通过现场审计、内容相关性和质量门槛的来源，并在行业试跑中映射为 `active/ready`。新增或失效来源仍走 shadow observation，不改变上游通用 E4 准入规则。

行业公开信源目标为 80% 中国行业、20% 国际对标。首轮恢复运行至少需要 12 个中国独立发布机构和 3 个国际发布机构同时通过 GitHub 自动审计，且最新有效内容不超过 90 天；同一机构的多个栏目不能重复计数。GitHub 无法稳定访问时先寻找官方 RSS、API、JSON、Sitemap 或栏目入口，不绕过 WAF。仍不足 12 个中国发布机构时保持工作流暂停，并单独请求是否增加境内轻量采集节点。

## 3. 行业相关性与中文规范化

`rules.json` 经过 Zod 校验，包含强相关词、上下文词、排除词、实体别名、竞品、来源栏目映射、Track 规则、行业影响权重和发布门禁。

```text
normalized Signal
  -> deterministic scope score
  -> out-of-scope: triage + audit, not public
  -> borderline: bounded Ark include|hold|exclude review
  -> in-scope: industry eventability + cluster
```

模型可以拒绝候选，不再强制每条内容选择 Track。中文站使用中文 Event 标题与摘要；英文原题保留在 Evidence。相关英文 Signal 只翻译公开短标题和短摘要并缓存，不复制原文。

## 4. 模型适配

新增通用 OpenAI-compatible JSON client 与 factory，保留 `DeepSeekClient` 的兼容导出，避免破坏上游现有调用。

配置优先级：

```text
MODEL_PROVIDER    default deepseek; fork uses ark
MODEL_API_KEY     fallback DEEPSEEK_API_KEY
MODEL_BASE_URL    fallback DEEPSEEK_BASE_URL
MODEL_NAME        fallback DEEPSEEK_MODEL
MODEL_JSON_MODE   native | prompt-only
```

方舟 Coding API 默认：

```text
provider: ark
base URL: https://ark.cn-beijing.volces.com/api/coding/v3
model: glm-5.2
endpoint: POST /chat/completions
JSON mode: prompt-only, followed by strict local JSON parse and Zod validation
```

`response_format`、DeepSeek `thinking` 和 `reasoning_effort` 只有明确支持时才发送。密钥、prompt、原 completion 和 reasoning 不进入日志、artifact、snapshot 或 Pages。

## 5. 聚类、评分与发布

行业聚类使用主体、行为、对象、时间窗口、实体别名和原始引用链；上游 AI 模型名称 fingerprint 只在默认行业生效。来源独立性按 original URL、source identity 和引用链计算，不能只按 source slug 计数。

行业影响分由确定性标签映射计算，模型不能直接写总分。高优先级 Event 要求 Tier 1 原始证据和独立辅助证据，或两个独立 Tier 2 证据；单一 Tier 1 Event 可以作为普通事实发布，但明确显示待交叉验证，不能进入高优先级 Top 10。无模型普通事实的标题还必须包含发布、印发、召开、上线、签约等可验证动作；评论、解读和观点文章即使正文提到相关动作，也只保留为 Signal，不自动包装成 Event。

事实摘要、行业判断、未来信号和业务价值分别持久化使用的 Evidence URL。相关性不足、中文输出失败、证据映射不完整或评分不可解释时保持 review/triage。

## 6. 30 天历史证据与 7 天领域观察

行业包独立 `narratives.json`。首次运行从当前日期向前回填 30 天，并从新的验证起始日连续运行 7 天。六条主线每条至少 3 个已审核 Event、两个独立来源，才显示阶段趋势判断、影响对象、反向信号和下一观察点。未达到门槛时不得隐藏已经采集的证据：页面继续显示有效 Signal、候选事实、单一 Tier 1 事实 Event 与缺口说明。

试跑期页面使用“领域观察”语义，不宣称已经计算长期趋势。通过 7 天验收后，再单独建设周度脉冲、趋势强度和阶段晋级。

## 7. 运行与发布

专用 `industry-pilot.yml` 在首次 30 天回填及后续 7 天验证期间执行：

```text
restore industry snapshot
  -> audit configured sources
  -> require 12 China + 3 international independent publishers
  -> collect trial-ready sources / observe new shadow sources
  -> initial run: bounded same-origin pagination + 30-day publication cutoff
  -> daily run: incremental collection
  -> deterministic cluster + track classification + fact extraction
  -> deterministic industry scope
  -> industry cluster / scoring (no model call during baseline)
  -> deterministic readiness / publish
  -> generate 30-day baseline report
  -> write privacy-safe industry snapshot
  -> commit fork-only data files
  -> dispatch industry Pages
  -> optional weekly Issue
```

本轮明确设置 `MODEL_ENRICHMENT_ENABLED=false`，Ark 步骤不会执行。首次回填必须有真实的 30 天日期下界，并对同源分页设置页数、响应体和速率上限；不能把“清空游标后重抓首页”称为历史回填。确定性路径负责中文事实摘要、主体、主线和原始证据绑定。后续只有经用户确认才允许模型整理；AI 失败仍不阻断确定性采集与快照回流。Pages 使用独立 `industry-pages.yml`，从行业快照构建根首页。

首次真实回填前必须清理旧基线的 Signal、Event、聚类关系与运行计数，保留来源目录和最新来源审计；验证窗口从新规则首次成功运行重新计时。连续性按七个独立日历日的完整 run 计算，不能只按最早时间推算。

## 8. 公开首页

行业首页展示：

- 当前试跑天数与信源成功率；
- 配置来源、可自动采集来源、健康来源与待替换来源；
- 最近信号、已形成 Event、多来源 Event 与证据覆盖；
- 自动排序的 Top 10 候选及原始证据入口；
- 聚类准确率、决策价值和节省时间的人工填写状态；
- 医院、数据集团、保司/TPA、药企、药械等关注对象与六条观察主线。

没有数据时显示真实空状态，不回退展示上游 AI 演示数据；有 Signal 但没有趋势时必须展示证据漏斗，不能只显示“等待有效证据”。

## 9. 同步上游

常规同步只合并 `upstream/main`。预期冲突面限制在：

- 通用模型 client/factory 接口；
- seed 时的行业 profile hook；
- static export 的行业首页 hook；
- `CHANGELOG.md` 与产品 Changelog。

医疗关键词、来源、竞品、实体别名、评分权重与 Narrative 必须留在行业包；通用代码只增加可选加载和策略端口。无 `INDUSTRY_PROFILE` 时保持上游默认行为。

行业来源、页面文案、试跑阈值、快照与专用 workflow 都是新增文件，正常上游升级不会覆盖。
