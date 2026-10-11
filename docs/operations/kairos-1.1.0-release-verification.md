# Kairos 1.1.0 发布与验收报告

工程验收完成于北京时间 2026-10-11；本报告记录实际验证，不代表用户已经亲自体验确认。范围为 R01–R12 的 15 个执行 issue（#1–#11、#16–#19）及相关历史回归，逐条见[验收矩阵](kairos-backlog-acceptance.md)。用户后续明确暂缓的 AI 洞察与真实社媒不计入通过。

## 发布身份

| 项目 | 已核实结果 |
| --- | --- |
| 实现与审查 | [PR #20](https://github.com/EgoSay/kairos/pull/20)，已合并 |
| 正式版本与标签 | `1.1.0`，无 v 前缀，未移动旧标签 |
| 源提交 | `79a9cc5bfcd31b01175ed3cd3657c3e285a86b5a`，合入 main；与受测 `47725c596…` 的 Git tree 完全一致 |
| 实际镜像 | `ghcr.io/egosay/kairos@sha256:6efa274734418d2f38b86c13b072155e2987791d74acc6cf7554b2b3533ffc1f` |
| 发布运行 | [Kairos Image #38106765279](https://github.com/EgoSay/kairos/actions/runs/38106765279)，全部成功 |
| 生产部署 | 沿用既有 Dokploy 应用、Raw Compose、原数据卷及数据库路径；autodeploy 关闭，main 为唯一长期分支 |
| 线上核验 | 实际 profile、容器 image / RepoDigests、健康状态、Dokploy 声明及受保护字段一致；没有 pending release |

本报告后续的文档提交不改变已经发布的应用源码或标签身份，也不会触发部署。

## 检查与实际使用

- 最终产品候选 14 项 CI 全部成功；main 合并后的前端、后端、Proto 检查全部成功；正式标签又完成前后端检查、完整镜像构建和上一正式版本升级演练。
- 前端最终本地检查：229 个测试文件、2069 项测试、lint、生产构建通过。Go 全套与相关 race、tidy、lint，SQLite / MySQL / PostgreSQL 新建与升级、Proto 检查通过。
- 105 项发布/备份 Python 回归通过；容器缺失、健康失败、定时/重复回滚及新写入保护在真实隔离 Docker/Compose 演练中验证，未在生产制造破坏。
- 本机真实 Ego Lite 的合成数据验收覆盖原生粘贴、离线冷刷新、冲突、编辑/聚焦/源码、标签/搜索、置顶/关联、位置失败恢复、媒体、分享与导出。真实 Codex 客户端完成 MCP 授权、日期与完整分页、来源、撤销后的拒绝。
- 上线后原账户会话正常，真实浏览器分 4 页读取 707 条可见记录，逐条核对正文 SHA-256、原创建/更新时间、权限、附件成员和关系全部一致；5 条回收记录被正常入口排除，匿名读返回 401。
- 55 份 served 文件及 55 份原件逐字节哈希一致；54 份图片预览通过实际浏览器解码，1 份音频通过浏览器音频解码。12 次线上匿名媒体负向检查通过。附件管理列表和实际图片预览弹窗正常，未将视口外延迟加载的图片记为破损。
- 独立备份状态页面实际显示最新备份成功、监控送达、本次快照的应用恢复已验证及准确测试提交；页面无错误提示。已检查的上线后日志窗口（北京时间11:04:20–11:17:46）未发现 ERROR/FATAL/panic。

## 数据逐项核对及两项解释

冻结备份与登录验收前的 SQLite 在线备份副本逐表比较，包含全部 15 张表、每一列、关系、授权、未知字段和 sqlite_sequence；同时核对 110 个原件/保留媒体文件，不仅比较总数。

1. **预期索引迁移**：712 条记录增加精确标签派生索引；由正式提交的同版解析器逐条核对。去除这两项明确派生字段后，正文、日期、其它 payload、关系及附件的哈希保持一致。没有正文转换或原日期重写。
2. **已解释的会话刷新**：严格审计保留 `differenceCount=1`，唯一差异是一条 `REFRESH_TOKENS` 设置里某个既有会话的 tokenId / createdAt / expiresAt。客户端信息、会话数量、其它会话及所有其它设置/权限逐项一致；旧 ID 已移除，新期限仍为 30 天。数据库时间与 11:04:41 的真实 RefreshToken 成功日志吻合。独立复核仅解释这三个字段，结果为“1 项差异已解释，0 项未解释”，不冒称原始审计零差异，也没有修改任何生产或采样数据库。

首次审计还曾拒绝冻结备份旁由只读 fingerprint 留下的 0 字节 WAL。审计器适配只允许已绑定 manifest / receipt 的冻结 before 副本保留稳定空 WAL；非空 WAL、journal、符号链接、辅助文件变化及 post 副本任何辅助文件仍拒绝。21 个隔离回归（含真实 SQLite WAL 模式、审计中增长/换 inode/SHM 变化）通过。原失败报告、原数据库、完整逐表/权限断言均保留；这属于审计工具适配，不是修改应用或放宽内容验收。

## 新鲜备份与真实恢复

- 发布门禁先冻结写入，获得完整数据库与附件快照并加密上传 S3：`cc0dcb614758564b3e709764da4ebf5cbf838fd3c862987d85e22e94e6a9c04e`。
- 上线前最终 main 候选已用另一份真实 S3 备份验证恢复；上线后再次从上述**本次发布快照**恢复到全新目录，以**实际发布 digest**运行 network-none 容器。
- 最终恢复结果：applicationVerified / authorizationVerified 均 true；707 条正常记录、5 条回收排除、55 份 served / 55 份原件 / 54 份预览、110 个保留文件、2451 次负向权限检查通过。旧会话/分享撤销与外发暂停只发生于隔离副本，线上授权保留；测试容器已移除，证据与恢复副本保留。
- 既有备份 timer 已恢复；新版本上线后的真实计划任务成功，回执绑定正式 commit，mediaComplete=true；监控送达成功且未过期。11:22 的页面核验显示下一次自动执行为 11:26:43（北京时间）。这不是手动备份代替定时任务。
- 独立第二设备副本没有可核验回执，页面明确显示未知；不把主 S3 备份成功扩称所有副本已同步。浏览器本地草稿和任意外链不在服务器备份范围内，页面说明保留。

## 回滚与保留

旧版本 `1.0.1` / `2e931764ddef2df8d2a55ef8cc526794504e4b49`，旧 digest 为 `sha256:e0fb03c9f364e77d2cd99b2b384ad2aa437331784b3f8ade9a53bdbb51a53b33`。旧声明、冻结备份和加密快照保留，恢复步骤见 [scripts/README.md](../../scripts/README.md)。

已确认发布后不直接调用 pending-release 回滚，也不将旧备份覆盖已有新写入。派生索引迁移会改变数据库 fingerprint，自动保护可能要求人工判断；应先评估数据与版本兼容性，保留现有资料，再决定向前修复或安全回退。历史标签、PR 和备份均保留。

## 明确的验收边界

- AI 洞察真实服务 AC10–AC14，以及 AC23 的真实 AI 调用部分，按用户最新 Goal 转交 [#21](https://github.com/EgoSay/kairos/issues/21)，继续开放；mock 不作为真实服务通过证据。
- J15 / AC37 真实社媒接入继续暂缓；Webhook 协议验收不等于平台发布，不宣称旧 J17 整体验收通过。
- 设备范围按用户确认采用本机 Ego Lite 和移动视口。实体手机软键盘、触摸、GPS、麦克风未验收；真实定位权限已 granted，但设备返回 code2 无坐标，错误提示与手选恢复已通过，不声称 GPS 成功。
- 本轮工程验收完成；用户个人体验确认单独保留为未确认，不冒称用户已经亲自验收。

## 受控证据索引

下列文件位于被 Git 忽略的 `tmp/kairos-goal-20261010/`，服务器保留对应受控审计、备份和恢复目录。公开仓库仅保存这份脱敏总结，不发布私人正文、原始数据库或凭据。

| 证据 | 文件 |
| --- | --- |
| 正式工作流 / main CI | `release-1.1.0-workflow-final.json`、`release-main-ci-runs.json` |
| 最终候选与实际发版恢复 | `release-main-isolated-verification.json`、`release-1.1.0-shipped-restore.json` |
| 严格逐表报告与会话解释 | `release-1.1.0-strict-audit-summary.json`、`release-1.1.0-live-audit-reviewed.json`、`release-1.1.0-session-reconciliation.json` |
| 审计器回归 | `verify-live-upgrade-tests.json`、`verify-live-upgrade-sidecar-independent-tests.log` |
| 生产读取 / 媒体 / 预览 | `release-browser-records.json`、`release-browser-media.private.json`、`release-browser-preview.json` |
| 状态 / 定时任务 / 监控 / 日志 | `release-browser-backup-status.json`、`release-1.1.0-server-postflight.json`、`release-log-health.json` |
| 逐条需求与历史回归 | 本轮验收矩阵的 B、G/DB、FE、P、ZIP、M 等索引，原始失败与后续纠正证据均保留 |
