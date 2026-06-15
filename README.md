# Mooncakes 贡献者每日分析

公开仪表盘，用 mooncakes.io 模块数据和 GitHub 公开主页资料做贡献者画像。

- 每天由 GitHub Actions 自动更新一次数据。
- 页面由 GitHub Pages 静态托管。
- GitHub 画像只使用公开字段：location、company、bio、type、followers、public_repos 等。
- 如果仓库配置了 `OPENAI_API_KEY` Secret，会在每日构建时对近 30 天新增 owner 生成 AI 画像；未配置时自动退回规则画像。

本地预览：

```bash
npm run build:data
npm start
```

可选环境变量：

- `OPENAI_API_KEY`：启用 AI 新增贡献者画像。
- `OPENAI_MODEL`：AI 模型，默认 `gpt-4.1-mini`。
- `AI_PORTRAIT_LIMIT`：每天最多分析多少个近 30 天新增 owner，默认 `80`。
