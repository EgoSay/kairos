# Design Documents

Design documents may evolve while a feature is being designed and implemented. Once implementation is complete, set `Status: Implemented` and freeze the document.

Do not update implemented designs to track later code changes. They preserve the original design and rationale; source code and tests describe current
behavior. New and unimplemented designs may still be added or revised.

Active design specifications (decided direction, not yet implemented):

- [随机漫步：沿着记录发现关联](random-walk-associations.md) — #38，已确认产品方案 v0.2；后台自动维护关系、直接进入、原文优先与即时阅读，开发中。
- [随机漫步：技术设计](random-walk-technical-design.md) — #38，技术方案 v0.2；Cloudflare Workers AI、语义表示、关联证据、增量任务、局部结果与前端预取；开发中，待本地验收。
- [Kairos 设计系统规范](kairos-design-system-2026-10-16.md) — 配色（松绿）、字体分层（文楷内容层）、圆角/阴影/空间/文案/Token/组件状态的完整规范与迁移优先级；视觉依据为 `prototypes/` 方向 B。
- [Kairos 视图编排器](kairos-view-composer-2026-10-19.md) — #25（R14）的设计方案：规范 CEL 语法 + 分句识别器双向桥、单一 ViewComposerDialog 四入口、动态/固定时间语义边界与 residual 旧表达式保留机制。
- [记录多选批量调整标签与统一标签管理](tag-organization.md) — R13：多选批量增删标签 + 标签管理（重命名/合并/层级/删除），服务端批量 RPC + AST 正文改写，标签整理不触发分区外发。

Explorations (not yet decided, free to change):

- [随机漫步 A+C 交互](random-walk-interaction-options.md) — 已确认连续原文与按需地图，正在实施；A/B/C 讨论原型保留，入口 `prototypes/wander/index.html`，组合版 `#hybrid`。
- `prototypes/` — 设计系统方向原型（HTML，可直接双击打开）。入口 `prototypes/index.html`；用于配色、排版等风格取舍的实际体验对比。

Personal Life Journal design baseline:

- [Product Requirements and Interaction Specification](personal-life-journal-prd.md) — original review proposal, preserved as the implementation baseline.
- [Development Issues and Requirement Descriptions](personal-life-journal-issues/README.md) — original issue descriptions.
- [Current implementation and verification](../operations/personal-journal-validation.md) — current engineering evidence and remaining external acceptance.

The following designs have been implemented and are frozen:

- [API abuse controls](api-abuse-controls.md)
- [Configuration provisioning](configuration-provisioning.md)
- [Kairos 日期页 collection 上下文](kairos-journal-day-collection-2026-10-19.md)
- [Memos Export Format](memos-export-format.md), including the schemas under `memo-export/1.0/`
- [Multi-Spaces](multi-spaces.md)
- [Unique email](unique-email.md)

The configuration provisioning design was moved here from `docs/configuration-provisioning.md` and frozen after implementation.
