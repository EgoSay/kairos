# Kairos 视图编排器：当前筛选直接保存与可视化配置

Status: Draft — 2026-10-19。本文档是尚未实现的新设计，实现完成前可持续修订。
依据：#25（R14 需求与验收基线）、`web/src/contexts/MemoFilterContext.tsx` 的 facet 模型、`web/src/hooks/useMemoFilters.ts` 的 CEL 发射、`filter/` 的查询语义、#5（R02）已验收的可视化筛选、`kairos-design-system-2026-10-16.md` 的组件契约。

## 0. 一句话

**用户面对"想看哪些记录"思考，CEL 只是存储格式，不再是交互语言。**

创建视图 = 选出条件 + 起个名字。表达式只在"高级条件"次级入口里存在，且永远以原文保留、原文生效。

## 1. 核心架构：规范语法 + 分句识别器

CEL 是全量表达式语言，反向解析全部 CEL 不现实也不需要。编排器只发射一套**自定义规范语法**（每类条件一种确定形态，括号包裹、`&&` 连接）；识别器按顶层 `&&` 分句、逐句匹配这套语法。识别不出的子句进入 `residual`，原样拼回、原样生效——"无法无损转换的旧表达式"不是一个需要拒绝的边界情况，而是默认路径的一等公民。

```
ViewScope = { facets: MemoFilter[] }                    // 复用现有 facet 模型
composeViewFilter(scope, timezone) → string             // 规范发射器（新）
parseViewFilter(cel) → { scope, residual?: string }     // 分句识别器（新）
```

不变量：`parse(compose(scope)) === scope`；`compose(parse(cel))` 语义等价于 `cel`（residual 原文 AND 回）。

### 1.1 规范语法表（发射形态 ↔ 识别形态）

| 条件 | 规范 CEL 形态 | 识别还原 |
| --- | --- | --- |
| 关键词（每词一条） | `content.contains("词")` | `contentSearch` facet，多词合并回关键词串 |
| 包含标签（含子标签） | `("tag" in tags \|\| tags.exists(t, t.startsWith("tag/")))` | `tagSearch` |
| 包含标签（仅本身） | `"tag" in explicit_tags` | `tagSearch` + `tagExact` |
| 排除标签 | `!(上述两种形态)` | `tagExclude` |
| 任一/全部标签 | 多标签子句 ` \|\| ` / ` && ` 连接 | `tagMatch: any`（缺省 all） |
| 未标签 | `size(tags) == 0` | `untagged` |
| 固定日期 | `created_ts >= timestamp(N)` / `created_ts < timestamp(N)` | `dateStart`/`dateEnd`（epoch → `journalDate` 逆运算，Kairos 时区） |
| 动态·最近 N 天 | `created_ts >= now - duration("168h")` | `dateRange: rolling:7d` |
| 动态·今年 | `created_ts.getFullYear() == now.getFullYear()` | `dateRange: year`（UTC 边界，见 §3.2） |
| 置顶 | `pinned` | `pinned` |
| 属性 | `has_image` `has_audio` `has_attachment` `has_link` `has_code` `has_task_list` `has_location` | `property.*` |
| 分区 | `journal_partition == "id"` | `partition`（显示用分区名回填） |
| 其它一切 | — | `residual` 原文保留 |

`displayTime`（日历单日选中）不进入视图模型：保存时转 `created_ts` 上的固定日期范围并在摘要中说明，因为视图按 issue 要求只认"原始记录日期"。

### 1.2 新 factor

`MemoFilter.factor` 增加 `"dateRange"`，值为预设档 ID（`rolling:24h|7d|30d|90d`、`year`）。发射/识别/摘要展示走同一注册表，避免三处分叉。

`buildMemoFilter` 增加 `dateRange` 分支；`buildSearchFacetConditions` 不动。

## 2. 交互：单一 ViewComposerDialog

一个全局 dialog，四个入口共用，编辑与创建同构：

| 入口 | 初始条件来源 |
| --- | --- |
| `MemoFilters` 条件条尾"存为视图" | 当前 `filters` + 选中视图的 filter 内联（chip 标注"来自视图 X"） |
| `QuickFindDialog` 底部"存为视图" | `query`（text→关键词、cel→residual）+ `facets` |
| 侧栏 `ViewsSection` "+" / 空态 | 空模型 |
| `/views` 页"新建"与每行"编辑" | 空模型 / `parseViewFilter(view.filter)` |

Dialog 结构（自上而下，移动端全屏）：

1. **条件摘要**：每个识别出的条件一个可移除 chip；residual 显示为"高级条件"chip（只读摘要，点击展开下方高级区）。
2. **编辑条件**（默认折叠，"按需展开"）：复用 `SearchFacetPanel` 的条件域——日期（固定范围 + 动态档单选互斥）、属性开关、标签含/排除 + 任一全部 + 子标签、分区；外加一行关键词输入。面板不搬样式，只抽条件域为可受控组件。
3. **预览**：`useMemoCandidateSearch`（`filter = creator(me) && compose(scope,residual)`，`state: NORMAL`，pageSize 8），列表 + "还有更多"；加载/空结果/校验失败/请求失败四态分显。
4. **名称 + 图标**：图标可选（`CustomIconPicker`）。重名不拦，条件完全重复（归一化 CEL 与现有视图比对）时行内提示"与『X』条件相同"。
5. **高级条件区**（仅 residual 非空或用户主动展开）：textarea 预填 residual，debounce 调 `CreateMemoView{validateOnly:true}`；错误以具体文案给出（`filter: invalid ...` → "这个条件表达式写不通：…"）。正常流程无 Validate 按钮。
6. **保存**：未过校验禁点；成功后 `setMemoView(newId)` + 落在适用路由即生效（"新增视图可直接访问"）；失败保留全部输入。

`/views` 页保留列表/删除管理，行内展示可解析的 chips 摘要（复用 `describeViewFilter`）；示例墙与字段表不进 dialog——高级条件区仅 textarea + 提示，`MemoViews.tsx` 的表达式表单整体移除。

## 3. 语义边界

### 3.1 不进视图的东西（保存时在摘要区明示）

- **查询范围**：路由空间、创作者范围、"仅本人记录"开关——视图只在本人记录上生效，永远 NORMAL 状态。
- **`includeArchived`**：是 ListMemos 请求参数不是 CEL，视图无法表达；含此条件时提示"归档不包含在视图中"。
- **`visibility`**、`space ==` 等上游遗留形态：不进入可视化条件；旧视图含之 → residual，不静默改写。

### 3.2 动态时间的诚实边界

`filter/` 引擎现状：`now` 每次查询编译时冻结（`engine.go:68`，滚动窗口天然动态）；但 `created_ts.getMonth()` 等日历 accessor **只按 UTC 提取、显式拒绝时区参数**（`parser.go:652`）。

- **本期落地**：滚动档"最近 24 小时 / 7 天 / 30 天 / 90 天"（`now - duration`，精确、与时区无关）+"今年"（`getFullYear`，边界误差 ≤ 时区偏移，年仅一次，可接受并注明）。
- **本期不给**：日历语义的"今天/本周/本月"。UTC 日历日对 UTC+8 用户每天有半天错位——假精度比没有更糟。实现它需要引擎支持 `getXxx("Asia/Shanghai")` 时区重载（CEL stdlib 有此形态；三方言渲染：SQLite 仅固定偏移 DST-blind、MySQL `CONVERT_TZ` 依赖时区表、PG `AT TIME ZONE` 正确），属后端独立工作，另立 issue 跟踪。UI 档位结构预留。
- 固定日期选择器继续覆盖精确单日/单周/单月需求。

### 3.3 冲突与一致性

- `untagged` 与 `tagSearch` 互斥沿用 `SearchFacetPanel` 现有规则。
- 动态档与固定日期互斥（单选时间语义）。
- 分区被删后 `journal_partition` id 悬空：chip 显示原 id，保留条件不扩范围。
- 删除视图只删设置项不动记录；权限模型零改动（`requireCallerIs` 已限本人）。

## 4. i18n

新 UI 全部走 `t()`，新建顶层 `view.*` 命名空间（沿用 `journal.*` 先例）。en / zh-Hans / zh-Hant 写实译，其余 43 个 locale 以 en 兜底；`locale-resources.test.ts` 自动强制全量键与占位符一致。文案句式按设计系统 §3.3（动宾按钮、"动词+了" toast、"发生了什么+怎么办"失败）。

## 5. 改动地图

**新增**

- `web/src/lib/view-scope.ts` — `composeViewFilter` / `parseViewFilter` / 动态档注册表（facet 域发射委托 `buildSearchFacetConditions`，与实时筛选同一份真相）
- `web/src/components/ViewComposer/` — Dialog、条件摘要、预览编排、高级条件区
- `web/tests/view-scope.test.ts` — 往返不变量 + 旧表达式 fixtures + 动态档发射
- `web/tests/view-composer.test.tsx` — 入口预填、校验失败、重复检测、residual 保留、保存后激活

**修改**

- `contexts/MemoFilterContext.tsx` — `dateRange` factor
- `hooks/useMemoFilters.ts` — `dateRange` 发射分支
- `components/MemoFilters.tsx` — "存为视图"入口 + `dateRange` chip 文案
- `components/AppSidebar/QuickFindDialog.tsx` — 底部入口
- `components/AppSidebar/ViewsSection.tsx`、`pages/MemoViews.tsx` — 接 dialog；删表达式表单与示例墙
- `contexts/AppSidebarContext.tsx` — `viewComposer` 开关与初始条件（沿用 `quickFindOpen` 模式）
- `SearchFacetPanel` — 已是受控件，直接复用（日期草稿态留在面板内部）
- `web/src/locales/*.json` ×46 — `view.*` 命名空间

**不动**：proto（`MemoView` 三字段够用）、store、server（`validateOnly` 现成）、`filter/` 引擎（见 §3.2）。

## 6. 验收映射（#25 基线逐条）

- 当前筛选直接保存、只需命名 → 入口 1/2 + 条件摘要预填
- 独立创建无需表达式、按需展开 → 折叠的条件域 + residual 次级区
- 预览/列表/日历同条件 → 同一条 `buildMemoFilter` 发射路径、同一个 ListMemos 查询
- 动态范围随打开重算 → `now - duration()` 服务端每次编译冻结
- 空结果/加载/校验失败/请求失败分显；失败不丢输入 → 预览四态 + dialog 本地草稿
- 旧表达式往返无损、不伪装 → `parse` 分句识别 + residual 原文机制 + 往返测试
- 不扩权限、不删记录、回收站独立 → 视图仍是用户设置内 CEL，schema 零变更
- 桌面/窄屏/键盘/中文文案 → dialog 全屏移动端、`focus-visible` 全局环、`view.*` 全 i18n

## 7. 验证计划

- `cd web && pnpm lint && pnpm test` —— `locale-resources` 强制键完整；新增 `view-scope` 往返测试是核心质量门
- `pnpm build` 通过
- 真实浏览器（Ego Lite）：四入口走通；含子标签/动态档/排除标签组合保存后列表与预览一致；编辑上游遗留表达式验证 residual 保留与提示；窄屏完成同一流程
