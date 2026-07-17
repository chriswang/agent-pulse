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

## 5. 30 天基线与试跑报告

- 30 天基线和后续 7 天窗口都按不同日历日的 source run 计算连续性与自动采集成功率；
- 多来源 Event 按不同非聚合发布机构计数，同域名栏目不能重复计数；
- 高优先级 Event 的证据 URL 必须全部来自公开 Evidence；
- Top 10 排序稳定并保留证据链接；
- 公开完整性校验只比较当前基线或试跑窗口内 Event，窗口外历史 Event 可继续保留在累计时间线；
- 人工指标未填写时显示 pending，不自动判定通过；
- 30 天基线六条主线各至少 3 个审核 Event 和两个独立来源，不足时显示 evidence gap；
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
- 试跑阶段页面使用“领域观察”，不把 30 天基线描述为长期趋势计算；
- 当前 7 个偏题 Event 不再进入 timeline、Top 10 或领域观察；
- 专用 workflow 使用行业 snapshot；30 天基线设置 `BASELINE_MODE=true` 且不读取或调用 `MODEL_API_KEY`；
- 上游写数据 workflow 在 Fork 中禁用；
- PR/main CI、industry workflow、Pages deployment 与线上 smoke 全部成功。

## 7. 完成命令

```bash
npm run check
npm run build
git diff --check
```
