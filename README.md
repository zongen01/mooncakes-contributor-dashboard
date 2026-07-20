# Mooncakes 贡献者每日分析

公开仪表盘，用 business-analytics 导出的 Mooncakes 模块、下载量和 GitHub 映射字段做贡献者画像。

时间口径统一为 UTC：快照日期、模块贡献时间和页面更新时间都按 UTC 展示。页面包含独立的“新用户贡献”板块，以 owner 首次发布模块作为新用户口径。

- 每天由 GitHub Actions 自动更新一次数据。
- 页面由 GitHub Pages 静态托管。
- 默认数据源：`http://192.168.86.2:18080/`。
- 基础数据只读取导出站点的 `users.csv`、`packages.csv`、`module-download-totals.csv`。
- GitHub Actions 要自动刷新数据时，runner 必须能访问该导出站点；普通 push 会在远端不可达时部署已提交的 `public/data/latest.json`。
- 如果仓库配置了 `OPENAI_API_KEY` Secret，会在每日构建时对近 7 天活跃 owner 生成 AI 画像；未配置时自动退回规则画像。

本地预览：

```bash
npm run build:data
npm start
```

可选环境变量：

- `MOONCAKES_EXPORTS_BASE_URL`：business-analytics 导出站点地址，默认 `http://192.168.86.2:18080`。
- `BUSINESS_ANALYTICS_EXPORTS_BASE_URL`：同上，作为兼容别名。
- `OPENAI_API_KEY`：启用 AI 新增贡献者画像。
- `OPENAI_MODEL`：AI 模型，默认 `gpt-4.1-mini`。
- `AI_PORTRAIT_LIMIT`：每天最多分析多少个目标 owner，默认 `80`。

本机自动更新任务按每天 `00:00 UTC` 运行；当前上海时区对应本机 `08:00`。
