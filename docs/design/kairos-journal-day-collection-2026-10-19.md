# Kairos 日期页 collection 上下文：day URL 回归 URL 语法

Status: Implemented — 2026-10-19。已实现并冻结；后续行为以源码与测试为准。
依据：#30（进入日期页后侧边栏丢失 collection 上下文）、7e7844930 的既有取舍、`web/src/router/routes.ts` 的 collection 语法、`web/src/contexts/SpaceContext.tsx`、`web/src/components/AppSidebar/`。

## 0. 一句话

**collection 身份只住在 URL 语法里：Space 在路径、creator 在 `?creator=`、收窄在 `?filter=`。日期页不再用 `scope`/`from` 旁路编码身份。**

## 1. 根因

`/journal/day/:date` 不在 `COLLECTION_ROUTE_PATTERNS` 里，`resolveCollectionRoute` 判 `isCollection === false`，于是一条链全断：

- `SpaceContext` 的 `creatorUsername`/`selectedSpaceName` 只在 collection 路由上解析 → `SpaceSwitcher` 的 `showBrand` 成立 → 头部退化为 Kairos 品牌。
- `collectionNavigationPath` 走非 collection 分支 → 「列表」pill 回 `/`，`from` 记住的原 collection（Space / Explore）被丢弃。
- 侧边栏内容走 `JournalDaySidebarContent` 窄壳，只剩日历，`ViewsSection`/`TagsSection` 不再渲染。

`scope`（编译后的 CEL 快照）是**数据**参数，`from` 是**导航**参数——它们都不是身份。给每个消费方补"从 `from` 反解"只是分支繁殖，不是修复。

## 2. URL 语法

新增 `JOURNAL_DAY_ROUTE_PATTERN = \`${ROUTES.JOURNAL}/day/:date\``，加入 `COLLECTION_ROUTE_PATTERNS`：

- `/spaces/:uid/journal/day/:date` 注册进 `SpaceRoute` 子树（其存在性守卫天然复用）。
- 全局 `/journal/day/:date` 自动成为 collection 路由；旧链接/bookmark 无 `?creator=` 时按无主 collection 处理，等价于现状，无回归。

三类参数的角色自此正交，各司其职：

| 参数 | 角色 |
| --- | --- |
| 路径 `/spaces/:uid` + `?creator=` | **身份**：chrome 渲染哪个 collection |
| `scope`/`scoped`/`state`/`archived` | **数据**：feed 的完整 CEL 快照（含 memoView 等 URL 不可重建的选择） |
| `from` | **导航**：「← 记录」的回跳目标 |

`scope` 快照必须保留：memoView 选择是 context 态而非 URL 态，feed 滤镜无法从身份参数重建。冗余是有意的——身份管 chrome，快照管数据。

### 2.1 `creator` 盖章规则（JournalCalendar 侧）

`creator` = "这个 scope 是否绑定单一作者"：

| 来源页 | day URL 的 creator |
| --- | --- |
| `/`、`/spaces/x`（本人默认）、`?creator=y` | `creatorUsername`（含本人，显式写入） |
| `/archived` | 当前用户（归档天然是个人 scope） |
| `/explore`、无 creator 的 space 集合页 | 不写（无主 collection） |

### 2.2 行为推演

| 来源 | day URL | 头部 | 「列表」pill 目标 |
| --- | --- | --- | --- |
| `/` | `/journal/day/d?…&creator=admin` | admin 头像+名 | `/`（self-creator 自动坍缩） |
| `/spaces/x?creator=a` | `/spaces/x/journal/day/d?…&creator=a` | a 头像 + Space x | `/spaces/x?creator=a` |
| `/spaces/x`（无主） | `/spaces/x/journal/day/d` | Space x 标记 | `/spaces/x` |
| `/explore` | `/journal/day/d` | Kairos 品牌（与 Explore 自身一致） | `/explore` |
| `/archived` | `/journal/day/d?…&creator=admin` | admin | `/` |

## 3. 消费方逐条

**零改动**（`resolveCollectionRoute` 一通车，全部自然正确）：
`SpaceContext`、`SpaceSwitcher`、`collectionNavigationPath`（creator + `?filter=` 随行带回）、`getCollectionHomePath`（无 creator → Explore，有 → Home）、`getSidebarRouteKind`（归一化后仍命中 journal-day）、`TimelineViewProvider`、`MemoFilterContext`、`JournalDay` 本体、`readJournalDayContext`。

**carve-out——`scope` 快照不可重定向**（快照里固化着旧 space/creator 的 CEL，换上下文后 scope 会撒谎，因此 day 页不做"原地换 collection"）：

- `getSpaceSwitchPath`：journal-day → `buildCollectionPath(ROUTES.HOME, spaceName)` + 仅携带 `?creator=`。
- `getCreatorSwitchPath`：journal-day 并入 `isMemoList` 分支 → 落到目标作者的列表。
- `getRouteActionPolicy`：journal-day 归入 `route-collection` + `searchDestination = getCollectionHomePath(...)`（QuickFind 留在来源 collection 透镜内，与 calendar/map 同族）。

## 4. 侧边栏组成

`JournalDaySidebarContent` = `JournalCalendar`（scope 快照 + `selectedDate` + `returnTo`）+ `ViewsSection` + `TagsSection`：

- 标签统计：`useFilteredMemoStats({ context: scope.state === ARCHIVED ? "archived" : "collection", filter: scope.filter, includeArchived: scope.includeArchived })`。与日历共用同一快照，计数必然一致；hook 增加 `includeArchived` 覆盖参数。
- `TagsSection` 的 `scope` 键沿用 collection 规则（`${creator ?? "all"}:${space ?? ""}`，`SpaceContext` 已能解析），archived 用 `"archived"`——树展开状态与来源 collection 共享命名空间。
- 收窄语义：day 页不是 memo 列表，点标签 = 写 `?filter=` 随行带回（`MemoFilterContext` 原生于 URL 的通道）；点视图沿用 `handleView` 的"非列表页 → 落到 collection 首页"分支，但 `search` 需清洗为仅 `creator`+`filter`（剥掉 `scoped`/`scope`/`state`/`archived`/`from`）。
- 「列表」pill：删除 `routeKind !== "journal-day"` 特例，恢复 `MemoDisplaySettingMenu`——它配置的是列表显示偏好，回到列表即生效，语义自洽。
- `MobileAppHeader` 的「记录」链接改走 `collectionNavigationPath(ROUTES.HOME, ...)`（同类丢上下文 bug，顺手修）。

## 5. 选中态与 aria

- `cellStyles.ts` 导出共享选中 chip（`bg-primary font-medium text-primary-foreground`，即 `SELECTED_CHIP` 字面量），`JournalCalendar` 选中日改用它并**独占填充**（替换热力底色而非叠加 ring）；`hover:ring-1` 只留给非选中日。符合 `COLOR_GUIDE.md` 已写明的"选中日期用完整 primary/primary-foreground 配对"。
- `aria-current`：`day.isToday` 恒为 `"date"`（它就是今天）；命中 `selectedDate` 的为 `"page"`（它是当前页，优先于 date）。视觉（下划线=今天、实心=在读）与 aria 不再分叉。
- `CalendarView` 的 `OPEN_BADGE` 是"打开的面板日"语义，不在本次统一范围。

## 6. 改动地图

| 文件 | 改动 |
| --- | --- |
| `web/src/router/routes.ts` | `JOURNAL_DAY_ROUTE_PATTERN` 入 `COLLECTION_ROUTE_PATTERNS`；`getSpaceSwitchPath`/`getCreatorSwitchPath` 的 journal-day carve-out |
| `web/src/router/index.tsx` | Space 子路由注册 `journal/day/:date` → `JournalDay` |
| `web/src/components/JournalCalendar.tsx` | day 链接走 `buildCollectionPath` + `creator` 盖章；选中态用共享 chip；aria-current 修正 |
| `web/src/components/ActivityCalendar/cellStyles.ts` | 导出共享选中 chip 常量 |
| `web/src/components/AppSidebar/AppSidebar.tsx` | `JournalDaySidebarContent` 恢复 Views/Tags；删除 `▾` 特例；`MobileAppHeader` 链接 |
| `web/src/components/AppSidebar/routes.ts` | `getRouteActionPolicy`：journal-day → `route-collection` |
| `web/src/components/AppSidebar/ViewsSection.tsx` | `handleView` 导航 search 清洗为 `creator`+`filter` |
| `web/src/hooks/useFilteredMemoStats.ts` | `includeArchived` 覆盖参数 |

## 7. 验收映射（#30 表格逐条）

| issue 现象 | 修复 |
| --- | --- |
| 头部退化为 Kairos 品牌 | `?creator=` + space 路径 → `SpaceContext` 解析出身份 → `SpaceSwitcher` 显示原 collection |
| 「列表」pill 半激活（active 无 `▾`） | collection 导航目标正确 + `▾` 特例删除 |
| 日历下方区块消失 | `JournalDaySidebarContent` 恢复 Views/Tags，统计与日历共用 scope 快照 |
| 被点日期与 hover 不可区分 | 实心 primary chip 独占填充；today 下划线、`aria-current` 各自归位 |

## 8. 验证计划

- `cd web && pnpm lint && pnpm test`。
- 更新 `web/tests/journal-calendar-scope.test.tsx`：`aria-current` 断言 `"date"` → `"page"`；新增 space 路径 + `creator` 透传用例。
- 更新 `web/tests/app-sidebar-logo.test.tsx`：day 页头部身份、pill 目标、Views/Tags 挂载、`▾` 存在。
- 更新 `web/tests/app-sidebar-routes.test.ts`：`/spaces/p/journal/day/…` → `journal-day`；policy 断言改 `route-collection`。
- 手测：`/`、Space、Explore、Archived 四个来源点日期 → 头部/pill/区块/选中态逐项核对。

## 9. 明确不做

- 不改 `JournalDay` 页面本体与 `readJournalDayContext`——`scope` 快照仍是 feed 的唯一契约，day 页信息流不响应 `?filter=`。
- 不统一 `CalendarView` 的 `OPEN_BADGE`（"打开面板" ≠ "选中筛选"）。
- 不动 `from` 语义与校验（`/` 开头、禁 `//` 与 `\`）。
