<p align="center"><img src="web/public/logo.svg" width="88" alt="Kairos 标识"></p>

<h1 align="center">Kairos</h1>
<p align="center"><strong>留下此刻，日后重逢。</strong><br>Keep a moment. Meet yourself again.</p>

Kairos 是一个私密、轻松、可以长期保存的生活记录工具。留下当时的文字、照片与声音，让多年后的自己仍能读到真实的生活。

[开始使用](#快速开始) · [使用说明](docs/usage.md) · [部署与恢复](docs/operations/deployment.md) · [需求与已知问题](https://github.com/EgoSay/kairos/issues/12) · [项目历史](docs/history.md) · [MIT License](LICENSE)

![Kairos 桌面记录页，使用演示数据](docs/assets/screenshots/desktop.png)

## 为什么做 Kairos

当文字和图像越来越容易生成，亲身经历过的片段、当时的语气和自己的视角，值得被认真保存。

一条记录可以是一句没想完整的话、一张路上的照片，也可以是几个月之后才补写的往事。它不必有标题、分类、结论，或值得分享的理由。多年后重新打开时，仍能读到那个时刻的自己。

Kairos 的名字取意于古希腊的“契机、恰当的时刻”。在这里，留下什么、什么时候回来，都由本人决定。

## 设计哲学

- **记录本身已经完整。** 保存之后，不追加标签、总结、心情评分或下一条输入的任务。
- **允许间断。** 活动日历展示积累，空白日期保持中性；没有断签惩罚和补记压力。
- **本人拥有解释权。** 保留原话，也允许修改。AI 在主动选定来源后提供阅读角度，不替本人定义人生。
- **主动回顾。** 每日回顾和随机漫步是可进入、可忽略、可随时离开的去处。
- **私密与自主。** 默认私密；分享和分区外发有明确范围，可以查看、暂停和撤销。
- **多年后仍可读取。** 草稿保护、原件、导出、备份和恢复是产品的基础。保存失败必须看得见。

取舍顺序是：**数据与隐私 → 本人控制权 → 记录的低负担 → 找回与阅读 → 探索的乐趣 → 装饰。** 完整约定见 [BRAND.md](BRAND.md)。

## 当前可以做什么

| 场景 | 当前能力 |
| --- | --- |
| 随手记录 | Markdown 可视化编辑与源码切换、直接粘贴图片、聚焦写作；位置、常用地点、个人分区和离线草稿 |
| 找回片段 | 关键词与组合筛选、未标签入口、嵌套标签、置顶、日历、地图；搜索关联记录并双向回看 |
| 随便看看 | 每日回顾、随机漫步；主动选择记录后使用 AI 洞察 |
| 自己掌控开放范围 | 固定或动态只读分享、范围预览、提取码、暂停与期限；按分区配置外部投递 |
| 修改与恢复 | 编辑版本、记录与附件回收联动、图片及音频预览、可阅读的个人 ZIP 档案及导入恢复 |
| 长期保存 | 数据库与附件快照、S3 兼容目的地检测和定时备份、状态与监控、隔离恢复 |
| Agent 回顾 | 独立的限期只读 MCP 凭据，按日期读取自己的记录，可靠分页与原文来源 |

AI 需要自己的服务配置；外部投递需要接收服务，不等于已支持所有社媒平台。离线冷启动需要此前成功联网打开应用，浏览器草稿尚未同步时不在服务器备份里。

上表描述本分支的能力；实际部署版本、测试与上线证据分别记录在 [需求清单 #12](https://github.com/EgoSay/kairos/issues/12) 和 [验收矩阵](docs/operations/kairos-backlog-acceptance.md)。产品内实例备份需由管理员安装受限的宿主备份代理，见 [部署说明](docs/operations/deployment.md)。Agent 接入见 [MCP 使用说明](docs/operations/agent-access.md)。

## 看看实际界面

以下截图来自 Kairos 的本地演示实例，使用虚构记录，不包含私人账号或生产数据。手机图展示响应式 Web 布局。

| 手机随手记录 | 日历找回 |
| --- | --- |
| <img src="docs/assets/screenshots/mobile.png" width="270" alt="Kairos 手机记录界面"> | <img src="docs/assets/screenshots/calendar.png" width="690" alt="Kairos 日历视图"> |

![Kairos 随便看看入口](docs/assets/screenshots/revisit.png)

![Kairos 记录详情与媒体，使用虚构演示数据](docs/assets/screenshots/record.png)

## 快速开始

需要 Git 和带 Compose 的 Docker。以下方式从自己的源码构建完整镜像，默认只在本机开放端口：

```sh
git clone https://github.com/EgoSay/kairos.git
cd kairos
KAIROS_VERSION="$(bash scripts/release_version.sh development-version)" \
KAIROS_COMMIT="$(git rev-parse HEAD)" \
  docker compose -f scripts/compose.yaml up -d --build
```

打开 **http://localhost:5230**，创建自己的管理员账户。记录保存在 Compose 的 `kairos-data` 卷；停止或更新容器时保留该卷。首次构建会下载 Node、Go 和项目依赖。

```sh
# 查看健康状态和日志
docker compose -f scripts/compose.yaml ps
docker compose -f scripts/compose.yaml logs --tail=100 kairos

# 停止容器，保留数据卷
docker compose -f scripts/compose.yaml down
```

在服务器上运行时，先完成账户初始化，再配置 HTTPS 和入口。生产部署、既有实例升级和恢复见 [部署说明](docs/operations/deployment.md)。镜像发布目标为 `ghcr.io/egosay/kairos`，生产实例使用确认过的固定 digest；不依赖上游镜像的 `stable` 或 `canary` 标签。

## 部署与数据保障

Kairos 是 **Go 服务 + 内嵌 React 前端 + 数据库与附件**，一个应用容器即可运行。默认使用 SQLite，也保留 MySQL、PostgreSQL 存储支持。公网入口可接现有反向代理或 Cloudflare Tunnel。

```mermaid
flowchart LR
    Browser[浏览器] --> HTTPS[HTTPS / Tunnel]
    HTTPS --> App[Kairos 应用容器]
    App --> Data[(数据库与附件)]
    Data --> Snapshot[一致性快照与校验]
    Snapshot --> Backup[加密异地备份]
    Backup --> Restore[隔离恢复验证]
```

- **个人档案**：导出可解压阅读的 Markdown、媒体和元数据，用于带走自己的内容。
- **实例备份**：保存账户、数据库和媒体，用于恢复服务；使用一致性快照并验证完整性。
- **远端保障**：SQLite 与本地或受管理的 S3 附件通过 restic 加密备份；安装宿主代理后，可在产品中检测目的地、试运行并启用调度，查看独立状态页。备份完成、状态上报和实际恢复是不同结果。
- **发布**：独立版本从 `1.0.0` 起，采用语义版本号。只保留 `main` 作为长期分支；其上的版本标签触发 GitHub 构建和检查，通过预备份后由发布入口直接调用 Dokploy，部署固定 digest。普通提交与合并不自动上线，失败时保留备份和安全回滚能力。

数据卷不是异地备份。内置实例备份目前面向 SQLite；MySQL/PostgreSQL 仍需各自的一致性备份机制及附件快照。受管理 S3 原件必须完整下载并校验，任意外部 URL 附件不在保护范围内，会使备份明确失败。

[完整部署与恢复](docs/operations/deployment.md) · [备份及发布工具](scripts/README.md) · [日常运行说明](docs/operations/personal-journal.md)

## 一起维护

Kairos 从自己的使用需要出发持续迭代。遇到问题或有想法，可以在 [Issues](https://github.com/EgoSay/kairos/issues) 描述具体场景。现有功能的可靠性和低负担体验优先。

本地开发、检查和 PR 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，目录与工程规则见 [AGENTS.md](AGENTS.md)，接口说明见 [API 文档](docs/api.md)。

## 项目历史

Kairos 在本仓库独立维护。Git 提交历史与历史版本标签保留；已完成的临时分支在合并后清理。未完成的需求与缺陷在本仓库的 Issues 中继续跟进。

早期已关闭的 Issues 和原生 PR 讨论保存在 [EgoSay/memos 历史库](https://github.com/EgoSay/memos)。旧库曾使用 `EgoSay/kairos` 名称，因此旧链接和裸 `#编号` 可能不再指向原条目；查阅历史时请使用 [Issues 编号对照与 PR 索引](docs/history.md)。

## 许可与来源

Kairos 基于 [Memos](https://github.com/usememos/memos) 发展，感谢原项目及其贡献者。产品方向、品牌和维护入口由本项目独立维护。

代码按 [MIT License](LICENSE) 开放，保留原版权声明并注明 Kairos 新增贡献。旧 API、导出格式与部分配置名称保留兼容性，具体边界见 [兼容与迁移](docs/operations/deployment.md#兼容与迁移)。
