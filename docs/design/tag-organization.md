# 记录多选批量调整标签与统一标签管理（R13）

> Status: Draft（方向已评审，未实施）。
> 需求基线：[EgoSay/kairos#24](https://github.com/EgoSay/kairos/issues/24)；关联 R02、R09（#5、#16），总清单 #12。

## 背景

整理已有记录时一次选中多条调整标签，并集中管理已有标签（查找、计数、重命名、合并、层级整理），避免逐条打开编辑。不改变"日常记录无需先整理"的低负担原则。

## 决定设计形态的现有事实

- **标签不是实体**。标签是正文里的 `#tag` token；`payload.Tags`（含祖先路径）与 `payload.ExplicitTags`（仅显式书写）是从 content 派生的索引，store 层拒绝脱离 content 伪造（`store/db/*/memo_attachment.go` 的 `applyMemoUpdate` 用 `json_set` 保护派生字段）。**一切标签增删改都是正文改写。**
- **已有改写原语**：`markdown.Service.RenameTag` 按 AST 源区间精确替换标签 token，跳过代码块/链接等非合法位置，`FormatTag` 自动处理引号拼写。删除、追加、子树改名需要同风格扩展。
- **UpdateMemo 的副作用面**：`captureJournalRevision` 版本快照、`markJournalRecordModified`、mention diff 通知、`enqueuePartitionMemo` → `Commit` 分区投递、SSE 广播。直接拿 UpdateMemo 循环做批量整理，每一条都会触发分区投递——**这正是"不能因批量整理意外触发外发"的来源**。
- **显示规则与已保存视图是引用方**：`UserSetting_TagsSetting` 的 key 是 regex（精确命中是特例）；`MemoView.filter` 是含标签字面量的 CEL 串。标签改名/删除会让它们静默失效，需要显式处理。
- **`Memo.tags` 输出含祖先**，无法区分"显式写了 `#a`"与"写了 `#a/b` 隐含 `a`"。批量对话框的共同/部分拥有分类需要显式标签集。

## 已评审决策

1. 服务端新增批量与管理 RPC，不用 UpdateMemo 逐条循环（外发、SSE、失败语义都不可控）。
2. **标签整理不算内容改动**：不入队新投递、不标 `local_changed`；但已 `pending`/`delivering` 的 upsert 投递必须把 `Revision` 刷新到新值保活——否则 `ProcessDue` 的 `authorize` 校验 revision 失配会静默取消用户已排队的发送。
3. 多选只在**本人记录流（Home own feed）与 Archived** 开放；Explore/他人主页不出选择入口。
4. 标签管理双入口：侧边栏 TagTree 头部"管理" + Settings 新 section。
5. 改名/删除时，引用旧标签的已保存视图 filter 与精确命中的显示规则键**默认同步改写**，预览中列出受影响清单并允许跳过。

## 语义模型

所有标签操作归约为对正文 token 的 AST 改写，三类原语：

- **add**：文末追加独立段落 `\n\n#tag`（`FormatTag` 生成规范拼写）。该 memo 显式已有此标签 → 幂等跳过。若末尾恰好落在未闭合代码块内导致标签未被识别 → 该项如实报失败，不假装成功。
- **remove**：删除精确显式 token（不含仅由子孙隐含的祖先），并折叠空白：token 两侧皆空白删其一；token 独占的行清空后连行删除；不产生残留空行。
- **rename**：token 值替换为新名。`include_descendants` 时按前缀匹配，`a → b` 同步改写 `a/x → b/x`。

由此派生全部管理能力：**合并** = rename 到已存在目标；**换父级** = rename `a → p/a`（带子树）；**删除标签** = remove（可含子树）。改名目标已存在即合并语义，预览必须明示。

## API 草案（`proto/api/v1/memo_service.proto`）

标签不是独立资源，挂在 MemoService 集合方法上：

```proto
rpc BatchUpdateMemoTags(BatchUpdateMemoTagsRequest) returns (BatchUpdateMemoTagsResponse) {
  post: "/api/v1/memos:batchUpdateTags"   // body: "*"
}
rpc RenameTag(RenameTagRequest) returns (RenameTagResponse) {
  post: "/api/v1/memos:renameTag"
}
rpc DeleteTag(DeleteTagRequest) returns (DeleteTagResponse) {
  post: "/api/v1/memos:deleteTag"
}
```

```proto
message BatchUpdateMemoTagsRequest {
  repeated string names = 1;        // memos/{memo}，上限 200
  repeated string add_tags = 2;
  repeated string remove_tags = 3;  // 与 add_tags 至少一非空
}

message TagOperationFailure {
  string name = 1;    // memos/{memo}
  string code = 2;    // 规范 code 名：NOT_FOUND | PERMISSION_DENIED | FAILED_PRECONDITION | ABORTED | INVALID_ARGUMENT
  string message = 3;
}

message BatchUpdateMemoTagsResponse {
  repeated Memo memos = 1;                   // 成功项（含改写后内容）
  repeated TagOperationFailure failures = 2; // 失败项，可定位可重试
}

message RenameTagRequest {
  string tag = 1;
  string new_tag = 2;
  bool include_descendants = 3;
  bool validate_only = 4;           // 预览：只统计不写入
  bool update_views = 5;            // 默认 true：同步改写已保存视图/精确规则键
}
message RenameTagResponse {
  int32 affected_memo_count = 1;
  repeated string affected_tags = 2;      // 命中的子树标签
  repeated string affected_views = 3;     // 将改写的已保存视图名
  repeated string affected_rules = 4;     // 将改写的精确显示规则键
  bool merges_into_existing = 5;          // 目标标签已存在 → 合并语义
  repeated Memo memos = 6;
  repeated TagOperationFailure failures = 7;
}
// DeleteTag 同构：tag、include_descendants、validate_only、update_views
```

行为约定：

- **幂等**：add 已有 / remove 不存在 / rename 到相同值 = 成功 no-op；重试结果相同，不重复添加。
- **逐项隔离**：单项失败不影响其它项；失败项带 code+message 返回。
- **预览**：`validate_only` 用 `ExcludeContent` + `explicit_tags` 过滤统计，不解析正文；返回受影响 memo 数、子树标签、受影响视图与规则、是否合并。

## 服务端执行管线

逐条 memo（`server/api/v1/memo_service_tags.go`，纯改写规划放 `core/memotag`）：

1. 读最新 memo → `access.CanManageMemo`（批量）/ `creator_id == caller`（管理操作，不动他人在 space 里的记录）→ 垃圾箱检查（`FAILED_PRECONDITION`）。
2. markdown 服务执行原语；无变化 → 成功 no-op。
3. `captureJournalRevision` 快照（历史只增不改，整理可回溯）。
4. `ApplyMemoMutation` + `ExpectedMemoContent = 读到的正文` 做 CAS；冲突 → 重读重算（≤3 次），仍冲突 → 该项 `ABORTED`「记录已在别处修改」。
5. `markJournalRecordModified` 记 provenance（备份 manifest、历史对话框消费它）；`memo.updated_ts` 正常推进。
6. `partition.Service.RefreshDeliveryRevisions(owner, uid, newRevision)`：CAS 更新 pending/delivering upsert 投递的 Revision；delivered/published/local_changed/failed/cancelled 一律不动；in-flight 投递因 doc.Version 上移自然作废、下轮以新 revision 重投。**不写 `partition-pending` outbox，不调 `Commit`。**
7. 不做 mention diff（标签改写不产生新 mention）；整个 RPC 结束后 SSE `publishMemoChanged` 广播一次。

## 前端

### 多选（`contexts/MemoSelectionContext.tsx` 新增）

- 会话态：`{ active, selected: Set<memoName>, scope }`；scope = `manual`（逐条/全选已加载）| `filter`（当前组合筛选的全部结果，进入时快照 filter 串并显式标注范围）。
- 入口：MemoActionMenu「选择多条记录」+ 列表工具区「选择」；Esc、路由切换、批量操作完成后退出。
- 选择态下 MemoView 卡片：点击切换选中（不跳详情），左上角 checkbox，选中 ring 高亮。注入点在 `PagedMemoList` 的 `renderer` options 扩展（`{ compact, selection }`），消费者仅 Home/Archived。
- 选择栏（sticky bottom）：已选 N 条 · 全选已加载 N · 全选当前筛选全部结果（分页拉取 names，上限 500，截断明示）· 取消 · [添加/移除标签]。

### 批量标签对话框

- 列出选中记录的**显式标签** union（`Memo` 增加 output-only `explicit_tags` 字段，单一事实来自服务端，不复用前端 tag-grammar 猜）。
- 每标签 chip 三态：全部共有 / 部分拥有（N/M）/ 勾选移除。
- 添加输入框复用 tagAutocomplete 候选排序与 `formatTag` 序列化。
- 提交 → 逐项结果；失败列表可定位并仅对失败 names 重试。

### 标签管理

- Settings 新 section（`setting.tagManager`）+ TagTree 头部「管理」图标直达。
- 列表：搜索 + 全部标签路径及计数（`useTagCounts(true)`）；仅有显示规则而无使用的项标「仅规则」。
- 行操作：重命名 / 合并到… / 移到父级下 / 从记录移除——先 `validate_only` 预览（影响记录数、子树范围、是否合并、受影响视图与规则，可勾选跳过视图同步）→ 确认 → 结果与失败项。
- 删除语义三义区分：「从记录移除标签」改正文 token；「删除显示规则」改 TAGS setting；「删除记录」走原路径——UI 文案明确分开。

### 失效与一致性

RPC 成功后失效 `memoKeys.lists/details`、`userKeys.stats`（标签树与计数）、memo views 查询；SSE 驱动的其它端自动刷新。TagTree 展开态按旧路径持久化，改名分支可能收起——可接受。

## 验收映射

| Issue 验收基线 | 机制 |
| --- | --- |
| 多选、数量、取消、范围明示 | SelectionContext + 选择栏；filter-scope 快照当前条件 |
| 批量增删、保留其它标签、共同/部分区分 | explicit_tags 输出 + 三态 chip + 服务端精确改写 |
| 管理入口、查找、计数、重命名/合并/层级 | Settings section + TagTree 入口 + RenameTag/DeleteTag |
| 删除标签≠删记录、规则删除区分、预览影响范围 | validate_only + 受影响视图/规则清单 |
| 树/计数/搜索/视图一致，冲突反馈 | 派生索引自动重建 + 视图 filter 改写 + merge 提示 |
| 进行中/成功/失败、定位重试、不重复 | 逐项 results + 幂等原语 |
| 并发不覆盖正文与元数据 | ExpectedMemoContent CAS + 重读重算 |
| 不意外外发、不改写历史 | 跳 Commit + 投递 revision 保活 + 快照只增 |
| 无权限/归档/垃圾箱/重复提交 | 逐项 code + 幂等 + 垃圾箱拒绝 |
| 窄屏可用、不需表达式 | 底部选择栏 + 对话框模式 |

## 实现落点

| 层 | 文件 | 内容 |
| --- | --- | --- |
| proto | `proto/api/v1/memo_service.proto` | 3 RPC + 消息；`buf generate` 重出 Go/gateway/Connect/OpenAPI/TS 五份生成物 |
| markdown | `markdown/markdown.go` | 接口新增 `RemoveTags(content, tags, descendants)`、`AppendTags(content, tags)`、`RenameTagTree(content, old, new)`（前缀匹配）；AST 区间改写 + 空白折叠 |
| core | `core/memotag/`（新包） | 纯规划：校验 tag 名（`FormatTag` 可序列化）、子树匹配集合运算、add/remove 交集拒绝、幂等判定。只 import `markdown`/`internal`，不碰 store 与 partition（depguard 禁 core 互导） |
| core | `core/partition/delivery.go` | `RefreshDeliveryRevisions(owner, memoUID)`：pending/delivering upsert 投递 CAS 刷 Revision |
| server | `server/api/v1/memo_service_tags.go`（新） | 3 handler + 共享 `applyTagRewrite` 管线；`memo_service_tags_views.go` 放视图/规则同步改写 |
| server | `server/api/v1/connect_services.go` | 3 个薄委托方法（生成接口编译强制） |
| server | `acl_config.go` | **不动**：新方法默认需认证 |
| web | `web/src/types/proto/`（生成）、`contexts/MemoSelectionContext.tsx`、`components/MemoSelection/*`、`Settings/TagManagerSection.tsx` | 见前端节 |

### 关键实现细节

- **预览**用 `FindMemo{ExcludeContent: true, Filters: explicit_tags CEL}`：不读正文，从 payload 统计命中 memo 数与子树标签；`merges_into_existing` 查 `tag_count` 即得。
- **影响集**：管理操作先按 CEL 过滤（`"a" in explicit_tags || explicit_tags.exists(t, t.startsWith("a/"))`）拿 memo 列表，再逐条走 `applyTagRewrite`。
- **CAS 循环**：每次 attempt 内重读 → 改写 → `captureJournalRevision` → `ApplyMemoMutation{ExpectedMemoContent, MemoUpdate{Content, Payload}}`；`ErrMemoMutationConflict` → 最多 3 次，超出该项 `ABORTED`。
- **视图改写**：扫 filter 串中的 JSON 字符串字面量，值等于 `old`（或 descendants 时前缀 `old/`）→ 换成新名的 JSON 引用形式，改写后必须过 `s.validateFilter` 重新编译校验；delete 用 `"/"` 作"永不命中"字面量（`/ `不是合法 tag，`"/" in tags` 与 `startsWith("/")` 恒假，否定子句自然变真）。
- **规则键**：只有与受影响 tag **字面量相等**的 key 改名/列出；regex pattern 键不动但在预览中提示。
- **限流**：`throttleAndCharge(ScopeWriteUser, userKey, len(names))`；batch names 上限 200，管理操作单次处理上限 1000（超出返回 `remaining_count`，幂等重调即可继续）。
- **add ∩ remove = ∅**：同 tag 同时出现在增删两列 → `INVALID_ARGUMENT` 拒绝整请求（客户端 bug，不猜语义）。
- **合并后正文**：memo 同时有 `#a` `#b` 且 rename a→b → 正文出现两个 `#b` token，索引层去重；如实保留，不偷偷删文本。

## 实施拆分

1. **服务端**：markdown 原语扩展（remove/add/subtree-rename）→ proto + `buf generate` → `core/memotag` 改写规划 → `memo_service_tags.go` 三 RPC + `partition.RefreshDeliveryRevisions` + 视图/规则同步改写 → 测试覆盖幂等、CAS 冲突、descendants、投递保活、预览。
2. **前端选择**：`MemoSelectionContext` + PagedMemoList/MemoView 接入 + 选择栏。
3. **前端批量对话框** + hook + 结果/重试 UI。
4. **标签管理 section** + TagTree 入口 + 预览对话框。
5. **i18n**（en.json 新增 `memo.bulk-*`/`setting.tagmanager.*`）+ 验收走查。

## 部署影响评估

- **无 DB schema 变更**：标签改写只动 `memo.content`/`memo.payload`，不需要 migration，三驱动（SQLite/MySQL/PostgreSQL）均无 DDL 变化。
- **生成物入库**：`buf generate` 重新产出 `proto/gen`（Go、gRPC、Connect、gateway、gnostic OpenAPI 经 `openapi_embed.go` 嵌入二进制）与 `web/src/types/proto`，需 buf.build 远端插件网络；CI 跑 `buf lint`/`buf format`。
- **认证与路由零配置**：新方法默认认证（不入 `PublicMethods`）；gateway 路由表由 proto 注解运行时派生，自定义动词自动生效。
- **纯增量 API**：旧客户端不调用新方法即不受影响，无版本协商、无开关、无滚动顺序要求。
- **前端改动需 `pnpm release`** 才会进 `server/frontend/dist` 的 go:embed；本地 Docker 构建按 AGENTS.md 传 `VERSION`/`COMMIT` build-arg。
- **CI 对应面**：`go test -race ./server/... ./core/... ./markdown/...`（store 未动）、`golangci-lint`（注意 core 禁止互导的分层规则）、proto lint/format、`pnpm lint/test/build`。
- **发布门禁**：与现有 tag 发版/Dokploy 流程完全无交互，不涉及 compose 模板与 `/opt/memos-backup` 组件。

## 不做

- 不引入标签实体表/独立存储；标签继续以正文为唯一事实。
- 不批量改 `space`/visibility/pinned 等其它字段（后续如需单独设计）。
- 不自动整理：无"建议合并""自动清理未使用标签"等主动行为。
- MCP/导出格式不变——内容即标签，随既有通道自然同步。
