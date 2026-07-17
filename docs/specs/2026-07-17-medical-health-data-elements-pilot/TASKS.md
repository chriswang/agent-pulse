# TASKS：医疗健康数据要素行业试跑

只有代码、测试或真实运行证据齐备后才能勾选。

## 1. 本地最小 Demo

- [ ] 建立 `origin/upstream` 隔离与行业包规格
- [x] 增加 profile schema、医疗健康数据要素来源与行业主线
- [x] 增加方舟 OpenAI-compatible client 与旧 DeepSeek 兼容层
- [x] 增加独立 snapshot、7 天试跑报告和行业首页
- [x] 增加专用 GitHub pilot / Pages workflow
- [x] 完成单元、集成、导出与隐私验证

## 2. GitHub 闭环

- [x] 恢复 `chriswang` 的 GitHub CLI 授权
- [x] 创建公开 Fork、推送本地分支并配置 Pages
- [x] 禁用 Fork 中的上游数据写入 workflow
- [ ] 由用户在 GitHub Secret 录入标准方舟 `MODEL_API_KEY`
- [ ] 真实验证 `glm-5.2` model id、JSON 输出与 Token 用量
- [ ] 手动触发首轮 audit / collect / Pages 并浏览器验收

## 3. 连续 7 天

- [ ] 记录每日来源成功率与失败原因
- [ ] 审核多来源 Event 与聚类准确率
- [ ] 审核高优先级判断的原始证据
- [ ] 人工评审 Top 10 决策价值
- [ ] 记录信息整理耗时变化
- [ ] 给出继续、替换信源、调整规则或停止的结论
