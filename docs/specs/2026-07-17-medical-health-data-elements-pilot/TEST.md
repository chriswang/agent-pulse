# TEST：医疗健康数据要素行业试跑

## 1. 配置与隔离

- profile schema 拒绝未知字段、重复 slug、非 HTTPS、越界分数和少于 20 / 多于 30 个来源；
- 行业模式只 seed 行业来源和行业主线，不 seed 上游 AI 历史 Event；
- 自定义 snapshot 路径不能逃出仓库；
- 行业 snapshot、报告和 Pages 不包含上游默认 snapshot 数据；
- 行业 Narrative 不包含 `tech-evolution`、`agi-progress` 等上游 AI 主线；
- 规则、Narrative、竞品和来源配置只能从当前行业包加载；
- 无 `INDUSTRY_PROFILE` 时保持上游默认行为。

## 2. 模型契约

- DeepSeek 兼容路径保持原 `response_format`、thinking 与 retry 行为；
- Ark 请求使用 Coding API `/api/coding/v3/chat/completions`、Bearer key 和 `glm-5.2`；
- Ark 默认不发送 `response_format`、`thinking`、`reasoning_effort`；
- 支持纯 JSON 和 fenced JSON，非 JSON、截断、空 choice 与认证失败产生安全错误码；
- `MODEL_API_KEY` 优先，旧 `DEEPSEEK_API_KEY` 继续可用；
- 日志和错误不包含 key、prompt 或原 response。
- 观点分析硬上限为 40 条有界短摘录，首轮请求默认最多 16 条、单一来源最多 5 条、单条摘要最多 480 字；请求单次最多等待 90 秒并最多尝试两次，提示最多输出 5 个精炼聚类，响应预算为 4,000 Token，本地 Schema 最多接受 10 个聚类；输出 URL 必须来自输入候选；中文、枚举、长度和 Token 用量通过本地 Schema。
- 模型不能写热度总分、事实状态或发布状态；模型失败时保留采集快照并记录安全错误码，但当日完整分析不计为成功。

## 3. 行业来源

- 每个来源声明用途、tier、role、采集方式、生命周期和 license note；
- active/observation 来源必须使用已有 adapter 并具有成功、空结果/漂移与失败 fixture；
- manual/restricted 来源不进入自动采集成功率分母；
- `trial.readySourceSlugs` 只能引用存在的自动来源，不能重复或包含 manual/restricted 来源；
- RSS 适配器覆盖 RSS 2.0、Atom、RSS 1.0 / RDF、Dublin Core 日期、嵌套标题与结构漂移；
- live audit 报告列出健康、失败、不可解析、内容过旧和需人工复核来源。
- ready 集合至少包含 12 个中国独立发布机构和 3 个国际发布机构，最新内容不超过 90 天，配置目标约 80% 中国行业、20% 国际对标；
- WHO、综合公共卫生、泛医学论文等宽泛条目不能仅凭来源权威绕过行业相关性门禁；
- GitHub 受限来源保持 shadow/manual，不以代理绕过 WAF。
- 试跑组合至少包含 4 个可自动采集的中国专家、媒体或行业观察来源；观点来源与原始事实来源分开标记。
- `--backfill --lookback-days=30` 只保留日期下界内的条目；未来日期和更早条目被拒绝；普通增量采集不受影响；
- HTML 历史回填只跟随同源分页链接，受最大页数、响应体、timeout、retry 与速率限制约束；跨域分页和无限循环被拒绝；
- “清空游标但只重抓首页”不能通过历史回填测试。

## 4. 相关性、中文化、聚类与发布

- 强相关、组合相关、排除项和实体别名 fixture 通过；
- `include / hold / exclude` 三种结果可审计，模型允许拒绝候选；
- 无关内容不能产生公开 Event 或出现在公开来源更新；
- 医疗数据要素研究不再被 AI/LLM 专属关键词规则压到不可聚类；
- 中英文同事件、同公告转载、版本更新和不同事件 golden cases 通过；
- 独立来源按 original URL、identity 与引用链去重；
- 自动 Event 影响分不是固定 55，高优先级阈值在合法 fixture 中可达；
- 单源 Event 不能进入高优先级 Top 10；
- 中文页面 Event 标题和摘要为中文，英文原题和原始 URL 保留；
- 每个高优先级事实与判断都能解析到持久化 Evidence URL。
- 只有通用“数据要素”但没有医疗、医保、医药或健康上下文的交通、气象和综合赛事内容不能进入 Event；
- 防汛抗旱、疾病通报等标题即使因列表解析串入相邻文章的数据关键词，也不能进入 Signal 或 Event；
- 中文 Tier 1 原始文件在没有模型时也能生成非占位事实摘要、主体、主线关联与普通事实 Event；
- 标题没有发布、印发、召开、上线或合作等可验证动作的评论和观点文章只保留为 Signal，即使摘要提到相关动作也不生成无模型 Event；
- 两个独立 Tier 2 来源可以满足普通事实证据门槛；单一 Tier 2 只能保持待核验；
- 同一正式文件名或政策编号出现在不同标题时可以聚合，动作类型不同的内容仍保持分离。

## 4.1 观点、热度与统一 Top 10

- 观点、分析和预测进入 Viewpoint，不进入 Event；每条 Viewpoint 至少回链一个输入 URL。
- 相同主张的不同表述可以聚合，支持与反对观点不能合并为同一立场。
- 独立发布机构、作者、平台和互动指标按原始数据去重；同一机构多个栏目不能制造多源关注。
- 没有互动指标且只有单一来源时只能标记“新出现观点”，不得显示“热门”。
- 两个独立发布方讨论相同主张时可以标记“多源关注”，但不能据此认定主张为事实。
- 统一 Top 10 可同时包含 fact 和 viewpoint，保留类型、证据状态、目标对象、排序理由和原文 URL；没有合格内容时不凑满 10 条。

## 5. 30 天历史回填与 7 天试跑报告

- 30 天历史窗口按 Signal / Event 的发布日期计算，7 天连续验证按不同日历日的 source run 计算；
- 多来源 Event 按不同非聚合发布机构计数，同域名栏目不能重复计数；
- 高优先级 Event 的证据 URL 必须全部来自公开 Evidence；
- Top 10 排序稳定并保留证据链接；
- 公开完整性校验只比较当前基线或试跑窗口内 Event，窗口外历史 Event 可继续保留在累计时间线；
- 人工指标未填写时显示 pending，不自动判定通过；
- 报告记录观点数、多源关注观点数、当日模型运行状态与 Token 用量；模型未运行不能判定完整试跑通过；
- 空数据库快照不继承仓库历史 `viewpoints.json` 的模型状态或观点，避免 CI fixture 被运行数据污染；
- 只有全部证据 URL 仍存在于当前快照的 Viewpoint 才能进入报告和 Pages；国际来源即使被翻译成中文，也按发布机构地域进入 80 / 20 配额；
- 六条主线各至少 3 个审核 Event 和两个独立来源才形成趋势判断；不足时仍展示 Signal、候选事实和单一来源事实 Event；
- 七天连续性需要 7 个不同日历日的完整 workflow run；
- 相关性抽检保存样本、判定与理由，不只保存百分比；
- 聚类验收保存 same/different pair golden 样本并计算 precision/recall；
- Top 10 保存逐 Event 的价值判断、目标受众、用途和理由；
- 时间节省保存逐日 before/after，不只保存一个汇总数字；
- 报告不包含 raw payload、秘密、内部错误全文或本机路径。

## 6. 页面与 GitHub

- 中文根首页 title、description、canonical 与行业名称一致；
- 390px 与 1440px 下首页可读，无横向溢出；
- 根首页不出现上游 AI 行业 Hero 或演示 Event；
- 试跑阶段页面使用“领域观察”，不把 30 天历史证据描述为长期趋势计算；
- 当前 7 个偏题 Event 不再进入 timeline、Top 10 或领域观察；
- 专用 workflow 使用行业 snapshot；完整验证设置 `MODEL_ENRICHMENT_ENABLED=true`，只向方舟发送通过门禁的有界短摘录；
- 首次回填显式重置旧行业情报状态，使用 30 天日期边界；报告显示 7 天验证进度，而不是 30 天等待进度；
- 上游写数据 workflow 在 Fork 中禁用；
- PR/main CI、industry workflow、Pages deployment 与线上 smoke 全部成功。

## 7. 完成命令

```bash
npm run check
npm run build
git diff --check
```
