# Kairos 部署、升级与恢复

本文维护 Kairos 的当前部署入口。主应用由 Go 服务内嵌 React 构建，数据库和附件必须持久化。

## 本机或单机起步

使用仓库根目录 [README](../../README.md#快速开始) 的源码构建方式。`scripts/compose.yaml` 只绑定本机 5230 端口，使用自己的 `kairos-data` 卷；浏览器第一次进入时创建管理员。

可通过 `KAIROS_PORT` 调整宿主端口，通过 `KAIROS_TIMEZONE` 调整显示时区。
构建时传入 `KAIROS_VERSION` 和 `KAIROS_COMMIT`，将版本与源码对应起来。
容器内部继续使用 `/var/opt/memos` 和 `MEMOS_*`，用于现有数据与配置兼容。

开放公网前：完成管理员初始化，检查私密模式和注册设置，配置 HTTPS，再测试匿名访问边界。
持久化卷不能代替异地备份；更新时保留卷，不使用 `down --volumes`。

## 自有镜像与 Dokploy

镜像仓库为 `ghcr.io/egosay/kairos`。当前生产构建目标为 `linux/amd64`；其他架构可从源码构建，并自行验证。
部署固定的 `sha256` digest，镜像可拉取且经过检查后才更新声明。

现有流程：

1. 更新 `internal/version/VERSION` 并将改动合并到 `main`，推送指向该提交、基础版本与其一致的 `MAJOR.MINOR.PATCH[-rc.N]` 标签；独立版本从 `1.0.0` 起，不带 `v` 前缀。
2. GitHub Actions 运行前后端检查，构建完整镜像，并做启动、持久化和升级验证。
3. 升级闸门完成一致性快照和远端加密备份。
4. 服务器上的受限发布入口将已核验模板中的镜像固定到 digest，更新原 Dokploy 应用的 Raw Compose，并直接调用部署 API。
5. 等待对应 Dokploy 部署完成，检查公网源码身份、镜像 digest 与实际容器健康。
6. 确认后恢复备份调度，保留发布回执。

`main` 是唯一长期分支，Dokploy 关闭自动部署；普通分支推送和 PR 合并不部署；RC 标签也走生产流程。详情见 [发布与恢复工具](../../scripts/README.md)。

开发构建显示 `1.0.0-dev.<提交摘要>`，正式构建显示标签版本。旧 `26.10.1`、`26.10.2` 是迁移阶段的发布记录，保留供升级核验和恢复追溯；后续迭代按 `1.0.1`、`1.1.0` 等语义版本推进。数据库迁移序号与产品版本分开，既有数据库不会因产品改为 `1.0.0` 而降级或重建。

新建 Dokploy 环境可参考 `scripts/compose.dokploy.yaml`。现有生产应用使用 Raw Compose、`autoDeploy=false`，仓库元数据指向 `EgoSay/kairos` / `main`；不再依赖生产分支事件。API Key 仅保存在服务器的 root 私有配置中，不进入 GitHub Actions。
服务器安装的 Compose 模板必须与标签提交中的模板 SHA-256 一致；模板变更时先同步已审阅的服务器副本。这样构建期间即使 `main` 前进，也不会混用未经该次检查的部署配置。缺少凭据或模板不一致会在停写之前失败。
镜像名称改变时，必须同时核对：实际 Compose 镜像、镜像拉取权限、发布闸门允许的镜像仓库，以及回滚配置。失败回滚会先等待部署结束、检查数据未变化，再恢复 Dokploy 配置和旧镜像；新写入和表结构变化不会被备份覆盖。

首次发布新的 GHCR 包时，GitHub 默认将其设为私有，即使源码仓库是公开的。当前 Dokploy 方案使用公开镜像：首次推送后，在 Kairos 包的设置中将可见性设为 Public，再继续发布。流水线会使用不含登录凭据的临时 Docker 配置检查固定 digest 的清单；检查失败时会在冻结写入和更新生产声明之前停止。完成包权限配置后再重试，不能把 Actions 能推送镜像当作 Dokploy 能拉取的证据。[GitHub 镜像权限说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## 兼容与迁移

| 项目 | Kairos 的处理 |
| --- | --- |
| 代码仓库、帮助和反馈 | `EgoSay/kairos` |
| Go module | `github.com/EgoSay/kairos` |
| 新镜像 | `ghcr.io/egosay/kairos` |
| 现有 Dokploy appName / composeId | 保留，同一个应用继续挂载原数据 |
| 现有生产服务名和数据卷 | 保留 `memos`、`memos-data` 及实际 Compose 项目前缀 |
| 发布入口 | `main` 上的版本标签 → 检查和备份 → Dokploy API；保留原应用及数据绑定 |
| 现有域名、Tunnel 和备份路径 | 保留，由运维按实际资源维护；不随品牌改名迁移私人数据 |
| 数据目录与数据库名 | 保留 `/var/opt/memos` 和既有数据库文件名 |
| 环境变量、API、档案格式 | 保留 `MEMOS_*`、既有 RPC/HTTP 名称与 MIME 类型 |

新安装可以用 `kairos-data`；已有实例不能直接套用新安装 Compose，否则可能创建新的空卷。
镜像来源切换本身不需要复制数据库或清空浏览器草稿。涉及卷或域名的后续迁移必须另做数据和本机缓存迁移。

`EgoSay/kairos` 是独立仓库；早期 Issues 和 PR 历史保存在 `EgoSay/memos`，对应关系见 [项目历史](../history.md)。旧库不再承担生产发布。

仓库迁移沿用现有 Dokploy 应用和固定镜像声明。后续发布入口改为 `main` 上的版本标签和直接 API 部署，生产分支只在整条链路及线上数据验证后删除。仅迁移源码仓库不升级应用，也不更换数据卷。后续 Kairos 镜像仍通过正式版本标签发布，并完成镜像拉取、备份和 Dokploy 实际部署验证。

## 数据保障

[个人可迁移档案与实例恢复](personal-journal.md) 分别服务于带走内容和恢复整套实例。
现有 SQLite 快照脚本将数据库与引用的本地媒体组成一个可校验快照；外部媒体不在它的完整保护范围内。
MySQL/PostgreSQL 使用各自的一致性备份机制，并配套附件快照。

自动备份使用 restic 加密上传到 R2/S3 兼容目的地。需要独立配置调度、凭据、保留策略和监控，不能仅凭创建 bucket 就判断成功。
成功标准包括：定时任务真实运行、远端快照完成、逐文件校验，以及隔离恢复后的账户、记录和媒体可读取。
备份上报失败和备份本身失败分别判断。尚未同步的浏览器草稿不在服务器备份内。

恢复密钥应在服务之外保留独立副本。恢复到新的隔离目录，暂停旧分享和外发授权，验证后再计划切换；不直接覆盖正在写入的数据库。
现有脚本、配置字段与检查命令详见 [scripts/README.md](../../scripts/README.md)。

## 已知限制

- 产品内 S3 配置、检测和备份状态页面在 [#11](https://github.com/EgoSay/kairos/issues/11) 跟进。
- 发布回滚的容器缺失和声明恢复问题分别在 [#2](https://github.com/EgoSay/kairos/issues/2)、[#4](https://github.com/EgoSay/kairos/issues/4) 跟进。
- 历史部署成功只说明当时结果。每次发布都需要读取当前配置、备份回执和运行版本。
