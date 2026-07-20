# Mooncakes 贡献者每日分析

公开仪表盘，用 business-analytics 导出的 Mooncakes 模块、下载量和 GitHub 映射字段做贡献者画像。

时间口径统一为 UTC：快照日期、模块贡献时间和页面更新时间都按 UTC 展示。页面包含独立的“新用户贡献”板块，以 owner 在完整非撤回版本历史中的最早发布时间作为新用户口径；另列上一完整 UTC 自然周已注册但没有非撤回包记录的待转化用户。

- 每天由本机 LaunchAgent 在 `16:00 UTC`（北京时间次日 `00:00`）读取内网源站、校验并提交最新快照。
- GitHub Actions 负责部署已提交快照；公开 runner 无法访问内网源站时不会伪装成已刷新数据。
- 页面由 GitHub Pages 静态托管。
- 默认数据源：`http://192.168.86.2:18080/`。
- 基础数据只读取导出站点的 `users.csv`、`packages.csv`、`module-download-totals.csv`。
- “新增模块”只按模块最早非撤回发布时间计算；“活跃模块”按近 7 天内是否有版本发布计算；“版本发布”按完整 `packages.csv` 记录数计算。7 天窗口严格包含快照日及此前 6 个 UTC 日期。
- `users.csv.signup_time` 是 `Asia/Shanghai` 的无时区源字段，构建时先转换为 UTC；公开快照只保留注册日期，不保留原始精确时间。
- 每次发布前运行 `npm run validate:data`，校验模块/owner 历史、两个 7 天窗口、版本数、下载量、源站映射和已知回归案例。
- 公开快照只保留画像所需的脱敏公开字段；校验器会阻止密码、令牌、邮箱、电话、原始用户 ID 和原始 `meta_json` 进入部署产物。
- 如需 AI 画像，应在能访问内网源站的环境中配置 `OPENAI_API_KEY` 并手动运行；未配置时使用规则画像。

本地预览：

```bash
npm run build:data
npm run validate:data
npm start
```

可选环境变量：

- `MOONCAKES_EXPORTS_BASE_URL`：business-analytics 导出站点地址，默认 `http://192.168.86.2:18080`。
- `BUSINESS_ANALYTICS_EXPORTS_BASE_URL`：同上，作为兼容别名。
- `OPENAI_API_KEY`：启用 AI 新增贡献者画像。
- `OPENAI_MODEL`：AI 模型，默认 `gpt-4.1-mini`。
- `AI_PORTRAIT_LIMIT`：每天最多分析多少个目标 owner，默认 `80`。

本机自动更新任务按每天 `16:00 UTC` 运行；当前上海时区对应次日 `00:00`。
