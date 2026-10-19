# Design Documents

Design documents may evolve while a feature is being designed and implemented. Once implementation is complete, set `Status: Implemented` and freeze the document.

Do not update implemented designs to track later code changes. They preserve the original design and rationale; source code and tests describe current
behavior. New and unimplemented designs may still be added or revised.

Active design specifications (decided direction, not yet implemented):

- [Kairos 设计系统规范](kairos-design-system-2026-10-16.md) — 配色（松绿）、字体分层（文楷内容层）、圆角/阴影/空间/文案/Token/组件状态的完整规范与迁移优先级；视觉依据为 `prototypes/` 方向 B。
- [Kairos 视图编排器](kairos-view-composer-2026-10-19.md) — #25（R14）的设计方案：规范 CEL 语法 + 分句识别器双向桥、单一 ViewComposerDialog 四入口、动态/固定时间语义边界与 residual 旧表达式保留机制。

Explorations (not yet decided, free to change):

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
