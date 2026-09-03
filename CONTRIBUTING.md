# 贡献指南

感谢你愿意改进轨道模拟工作台。提交修改前，请尽量保持改动聚焦、可复现，并附上必要的测试。

## 开发流程

1. 从 `main` 创建功能分支，例如 `feat/ground-track-export`。
2. 在本地运行项目：

```bash
npm start
```

3. 修改完成后运行测试：

```bash
npm test
```

4. 提交信息建议使用简洁的 Conventional Commits 风格，例如 `feat: add orbit import validation` 或 `fix: handle hidden canvas resize`。
5. Pull Request 中说明改动目的、主要行为变化和已执行的验证命令。

## 代码与资源约定

- 项目应保持离线可运行；新增前端依赖时，请说明来源和更新方式。
- 不提交 `.env`、密钥、令牌、本机路径配置、日志、覆盖率报告或生成输出。
- 大型二进制资源应有明确用途，并尽量压缩到网页演示所需的尺寸。
- UI 文案、测试和 README 更新应与用户可见行为同步。

## 报告问题

提交 Issue 时请包含复现步骤、预期结果、实际结果、浏览器版本以及必要的输入数据。涉及安全风险的信息请按 `SECURITY.md` 处理。
