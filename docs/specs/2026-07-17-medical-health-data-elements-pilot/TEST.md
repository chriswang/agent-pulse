# TEST：医疗健康数据要素行业试跑

## 1. 配置与隔离

- profile schema 拒绝未知字段、重复 slug、非 HTTPS、越界分数和少于 20 / 多于 30 个来源；
- 行业模式只 seed 行业来源和行业主线，不 seed 上游 AI 历史 Event；
- 自定义 snapshot 路径不能逃出仓库；
- 行业 snapshot、报告和 Pages 不包含上游默认 snapshot 数据；
- 无 `INDUSTRY_PROFILE` 时保持上游默认行为。

## 2. 模型契约

- DeepSeek 兼容路径保持原 `response_format`、thinking 与 retry 行为；
- Ark 请求使用标准 `/api/v3/chat/completions`、Bearer key 和 `glm-5.2`；
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

## 4. 试跑报告

- 7 天窗口按 source run 计算自动采集成功率；
- 多来源 Event 按不同非聚合 source slug 计数；
- 高优先级 Event 的证据 URL 必须全部来自公开 Evidence；
- Top 10 排序稳定并保留证据链接；
- 人工指标未填写时显示 pending，不自动判定通过；
- 报告不包含 raw payload、秘密、内部错误全文或本机路径。

## 5. 页面与 GitHub

- 中文根首页 title、description、canonical 与行业名称一致；
- 390px 与 1440px 下首页可读，无横向溢出；
- 根首页不出现上游 AI 行业 Hero 或演示 Event；
- 专用 workflow 使用行业 snapshot 和 `MODEL_API_KEY` Secret；
- 上游写数据 workflow 在 Fork 中禁用；
- PR/main CI、industry workflow、Pages deployment 与线上 smoke 全部成功。

## 6. 完成命令

```bash
npm run check
npm run build
git diff --check
```
