# ViewComposer/

> L2 | 父级: web/src/components/CLAUDE.md（未建，向 AGENTS.md 看齐）

视图创建/编辑的唯一交互面。通过 `AppSidebarContext.viewComposer` 接收请求（`scope` 新建 / `editing` 编辑），
CEL 表达式经 `lib/view-scope.ts` 双向桥进出；不可识别的旧子句以 residual 原文保留。

成员清单

- `index.tsx`: ViewComposerDialog —— 图标+命名融合行、chip 盒（条件域默认折叠、空态为虚线邀请盒）、residual 原文 chip、候选预览 + debounce validateOnly + 保存直达视图
- `facet-groups.tsx`: FacetGroup/Pill/TimeEditor/GROUP_FACTORS —— 条件域的单开手风琴（内容/时间/标签/属性/分区），复用 AppSidebar/SearchFacetPanel 的字段块
- `labels.ts`: describeViewFilter / viewFilterIcon —— 条件因子 → 本地化标签与图标；MemoViews 管理页复用同一摘要

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
