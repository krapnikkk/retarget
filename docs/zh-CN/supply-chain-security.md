# 供应链安全

[English](../supply-chain-security.md)

`@krapnikkk/retarget` 以带作用域的公开包发布到公共 npm 注册表。消费端应用不是库的发布门禁，库发布也不会修改消费端应用。

## 发布流程

1. 使用声明的 Node 和 pnpm 工具链运行 `pnpm install --frozen-lockfile`。
2. 运行 `pnpm verify`，覆盖类型检查、固定资源、完整测试套件、正确性覆盖率、包体积诊断、打包入口安装，以及打包后浏览器 Worker 的请求/结果冒烟测试。发布时，`prepublishOnly` 也会强制执行 `pnpm verify`。
3. 使用要求的 Blender 和 Godot 版本，为固定的认证用例运行 `pnpm verify:ecosystem`。生态兼容证据应与本地检查结果分开记录。
4. 运行 `pnpm audit --prod`，记录生产依赖许可证清单，并在发布前审查发现的问题。
5. 使用维护者的 npm 账号，通过双重身份验证（2FA）执行 `npm publish --registry https://registry.npmjs.org/`。包的 `publishConfig.access` 为 `public`。注册表凭据由维护者保管，不得泄露。
6. 为已发布的提交打上 `vVERSION` 标签并推送，再基于该标签发布 GitHub Release，概述变更内容和生态兼容验证结果。npm 注册表会记录 tarball 的完整性校验值，且已发布版本不可覆盖。

打包产物继续由 Git 忽略。发布是验证通过后的独立步骤。当前维护模式仍暂缓自动更新消费端、强制托管 CI 和发布 SBOM。

## 提交验证

每个工作副本执行一次 `pnpm hooks:install`。纳入版本控制的 pre-commit hook 会运行 `pnpm check`：领域层导入规则、增量类型检查和 `unit` 测试项目。完整的 `pnpm verify` 门禁在发布前及 `prepublishOnly` 中执行。托管 CI 是发布或审查时的可选人工复核，不是每次提交的依赖。

MIT 许可证仅覆盖本库代码；消费端资源和生成输出仍须遵守各自的来源与许可要求。
