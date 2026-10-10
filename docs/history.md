# Kairos 项目历史

2026-10-10，Kairos 从原 fork 迁入独立仓库。当前开发、反馈和发布入口为 [EgoSay/kairos](https://github.com/EgoSay/kairos)；[EgoSay/memos](https://github.com/EgoSay/memos) 保存早期原生 PR 和已关闭 Issues。

完整 Git 提交历史以及迁移时的 7 个分支、1 个标签已经承接。旧 PR 的合并代码在本仓库，原生讨论、审查和活动记录在历史库；它们不会出现在新库的 Pull requests 列表中。

## 未完成需求与缺陷

以下 12 项使用 GitHub 原生转移，继续保持开放状态。标题、内容、创建时间、指派、标签与已有评论经过核对；迁移期间仅将历史引用调整为明确的仓库和编号。

| 原编号 | 当前条目 | 内容 |
| --- | --- | --- |
| [memos#20](https://github.com/EgoSay/memos/issues/20) | [kairos#1](https://github.com/EgoSay/kairos/issues/1) | [P1] 分区切换与正文保存需统一提交，避免按旧分区安排外发 |
| [memos#21](https://github.com/EgoSay/memos/issues/21) | [kairos#2](https://github.com/EgoSay/kairos/issues/2) | [P1] 发布回滚应支持目标容器不存在的失败状态 |
| [memos#22](https://github.com/EgoSay/memos/issues/22) | [kairos#3](https://github.com/EgoSay/kairos/issues/3) | [P2] 编辑器仅修改分区时应正常保存 |
| [memos#23](https://github.com/EgoSay/memos/issues/23) | [kairos#4](https://github.com/EgoSay/kairos/issues/4) | [P2] 定时回滚完成后，流水线仍需恢复生产部署声明 |
| [memos#25](https://github.com/EgoSay/memos/issues/25) | [kairos#5](https://github.com/EgoSay/kairos/issues/5) | [R02] 优化搜索：关键词、可视化筛选与未添加标签快捷入口 |
| [memos#26](https://github.com/EgoSay/memos/issues/26) | [kairos#6](https://github.com/EgoSay/kairos/issues/6) | [R03] 优化图片粘贴：直接插入、上传反馈与失败恢复 |
| [memos#27](https://github.com/EgoSay/memos/issues/27) | [kairos#7](https://github.com/EgoSay/kairos/issues/7) | [R04] 优化位置添加：快捷入口、常用地点与定位纠错 |
| [memos#28](https://github.com/EgoSay/memos/issues/28) | [kairos#8](https://github.com/EgoSay/kairos/issues/8) | [R05] 将聚焦模式设为编辑器直接可见入口 |
| [memos#29](https://github.com/EgoSay/memos/issues/29) | [kairos#9](https://github.com/EgoSay/kairos/issues/9) | [R06] 优化写作时关联已有记录：快捷搜索、预览与双向回看 |
| [memos#30](https://github.com/EgoSay/memos/issues/30) | [kairos#10](https://github.com/EgoSay/kairos/issues/10) | [R07] 修复附件预览并让附件随记录进入和恢复回收站 |
| [memos#31](https://github.com/EgoSay/memos/issues/31) | [kairos#11](https://github.com/EgoSay/kairos/issues/11) | [R08] 数据库与附件定时备份到 S3：配置检测、独立状态页与恢复验证 |
| [memos#32](https://github.com/EgoSay/memos/issues/32) | [kairos#12](https://github.com/EgoSay/kairos/issues/12) | [需求清单] 2026-10-10 记录体验与数据备份改进（R01–R08） |

## 历史 PR

以下链接指向原生 PR，保留各自实际的合并和审查记录。

| PR | 内容 |
| --- | --- |
| [memos#19](https://github.com/EgoSay/memos/pull/19) | feat: 私人生活记录、可控分享与可恢复部署 |
| [memos#24](https://github.com/EgoSay/memos/pull/24) | ci: 按版本标签部署并停用上游自动化 |
| [memos#33](https://github.com/EgoSay/memos/pull/33) | fix(tags): preserve punctuation in quoted tag names |
| [memos#34](https://github.com/EgoSay/memos/pull/34) | 将项目独立为 Kairos，统一品牌、文档与部署配置 |
| [memos#35](https://github.com/EgoSay/memos/pull/35) | 在准备部署前检查 Kairos 镜像拉取权限 |

## 已关闭的早期需求

这些条目保留在历史库，不因迁移而重开。

| Issue | 内容 |
| --- | --- |
| [memos#1](https://github.com/EgoSay/memos/issues/1) | [产品总需求] 私人生活记录工具 v0.2：产品哲学、交互规范与开发清单 |
| [memos#2](https://github.com/EgoSay/memos/issues/2) | [J01] 需求评审与低保真交互原型 |
| [memos#3](https://github.com/EgoSay/memos/issues/3) | [J02] 日常记录、时间语义与基础找回 |
| [memos#4](https://github.com/EgoSay/memos/issues/4) | [J03] 照片与录音原件、可选转写 |
| [memos#5](https://github.com/EgoSay/memos/issues/5) | [J04] 草稿持久化、离线保存与同步冲突恢复 |
| [memos#6](https://github.com/EgoSay/memos/issues/6) | [J05] 编辑版本、最近删除与衍生内容清理 |
| [memos#7](https://github.com/EgoSay/memos/issues/7) | [J06] 保留活动日历数量着色与日期浏览 |
| [memos#8](https://github.com/EgoSay/memos/issues/8) | [J07] 个人分区及安全的归属与删除语义 |
| [memos#9](https://github.com/EgoSay/memos/issues/9) | [J08] 每日回顾：主动进入、同日稳定的旧记录 |
| [memos#10](https://github.com/EgoSay/memos/issues/10) | [J09] 随机漫步：纯随机、可后退、随时离开 |
| [memos#11](https://github.com/EgoSay/memos/issues/11) | [J10] AI 洞察：手选来源、可核对、原文不变 |
| [memos#12](https://github.com/EgoSay/memos/issues/12) | [J11] 自定义集合分享：时期、标签、手选与快照 |
| [memos#13](https://github.com/EgoSay/memos/issues/13) | [J12] 访客只读页面、分享授权及媒体访问边界 |
| [memos#14](https://github.com/EgoSay/memos/issues/14) | [J13] 分区 Webhook 配置、自动外发触发与可见状态 |
| [memos#15](https://github.com/EgoSay/memos/issues/15) | [J14] Webhook 持久投递、去重、顺序与授权复核 |
| [memos#16](https://github.com/EgoSay/memos/issues/16) | [J15] 首个社媒目标接入与真实发布链路验证 |
| [memos#17](https://github.com/EgoSay/memos/issues/17) | [J16] 可迁移导出、独立备份与无意外外发的恢复 |
| [memos#18](https://github.com/EgoSay/memos/issues/18) | [J17] 完整版本验收：记录体验、隐私与跨功能恢复 |

## 旧链接与编号

历史库曾使用 `EgoSay/kairos` 名称。本仓库重新使用这个名称后，旧的 `/kairos/issues/N` 或 `/kairos/pull/N` 地址可能失效或指向不同条目。请按上表定位；旧提交消息和冻结设计文档中的裸 `#N` 需要结合历史仓库理解。

`EgoSay/memos` 的已转移 Issue 地址会由 GitHub 跳转到新条目。后续开发使用当前编号，总清单为 [kairos#12](https://github.com/EgoSay/kairos/issues/12)。

## 代码来源与部署

本仓库继续保留 Memos 的原版权声明和 MIT 许可。仓库独立化不抹去来源，也不改写历史提交。

仓库迁移沿用现有应用和数据资源；后续镜像发布目标为 `ghcr.io/egosay/kairos`。迁移本身没有发布新版本或替换生产镜像。部署及首次镜像发布的要求见 [部署说明](operations/deployment.md)。
