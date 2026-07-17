# SYSTEM：行业包、方舟适配与 GitHub 运行

## 1. 仓库与数据隔离

```text
upstream = barretlee/agent-pulse
origin   = chriswang/agent-pulse

上游通用代码 ───────────────┐
                            ├─ build / test / collectors / governance
industry-packs/medical-health-data-elements/
  profile.json              ├─ source and page configuration
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

行业模式下 fresh database 只 seed 该行业包来源和主线，不 seed 上游 AI 行业历史 Event、Actor 或资源。来源默认 `shadow`；`trial.readySourceSlugs` 只列入本轮已经通过现场审计与内容质量门槛的来源，并在行业试跑中映射为 `active/ready`。新增或失效来源仍走 shadow observation，不改变上游通用 E4 准入规则。

## 3. 模型适配

新增通用 OpenAI-compatible JSON client 与 factory，保留 `DeepSeekClient` 的兼容导出，避免破坏上游现有调用。

配置优先级：

```text
MODEL_PROVIDER    default deepseek; fork uses ark
MODEL_API_KEY     fallback DEEPSEEK_API_KEY
MODEL_BASE_URL    fallback DEEPSEEK_BASE_URL
MODEL_NAME        fallback DEEPSEEK_MODEL
MODEL_JSON_MODE   native | prompt-only
```

方舟默认：

```text
provider: ark
base URL: https://ark.cn-beijing.volces.com/api/v3
model: glm-5.2
endpoint: POST /chat/completions
JSON mode: prompt-only, followed by strict local JSON parse and Zod validation
```

`response_format`、DeepSeek `thinking` 和 `reasoning_effort` 只有明确支持时才发送。密钥、prompt、原 completion 和 reasoning 不进入日志、artifact、snapshot 或 Pages。

## 4. 运行与发布

专用 `industry-pilot.yml` 每天执行：

```text
restore industry snapshot
  -> audit configured sources
  -> collect trial-ready sources / observe new shadow sources
  -> collect + deterministic cluster
  -> optional Ark event enrichment
  -> deterministic readiness / publish
  -> generate seven-day pilot report
  -> write privacy-safe industry snapshot
  -> commit fork-only data files
  -> dispatch industry Pages
  -> optional weekly Issue
```

AI 失败不阻断确定性采集与快照回流。Pages 使用独立 `industry-pages.yml`，从行业快照构建根首页。

## 5. 公开首页

行业首页展示：

- 当前试跑天数与信源成功率；
- 配置来源、可自动采集来源、健康来源与待替换来源；
- 最近信号、已形成 Event、多来源 Event 与证据覆盖；
- 自动排序的 Top 10 候选及原始证据入口；
- 聚类准确率、决策价值和节省时间的人工填写状态；
- 医院、数据集团、保司/TPA、药企、药械等关注对象与六条观察主线。

没有数据时显示真实空状态，不回退展示上游 AI 演示数据。

## 6. 同步上游

常规同步只合并 `upstream/main`。预期冲突面限制在：

- 通用模型 client/factory 接口；
- seed 时的行业 profile hook；
- static export 的行业首页 hook；
- `CHANGELOG.md` 与产品 Changelog。

行业来源、页面文案、试跑阈值、快照与专用 workflow 都是新增文件，正常上游升级不会覆盖。
