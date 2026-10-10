# Kairos 本轮需求验收矩阵

目标：完成 #1–#11、#16–#19，并以证据更新总清单 #12。目标截止北京时间 2026-10-11 23:59。

基线：2026-10-10，main `2e931764ddef2df8d2a55ef8cc526794504e4b49`。历史验收来自 `personal-journal-validation.md`，仅用于覆盖范围，不作为当前验证通过证据。

## 范围变更与证据标准

- 用户已授权实施、并行子 Agent、PR/合并、现有 Dokploy 发布及 issue 更新；J15 真实社媒接入继续暂缓。
- 2026-10-10 用户指定“真机验收使用本机 ego lite 作为浏览器自动化测试”。本轮以本机实际 ego lite + 移动视口验收；实体手机软键盘/GPS/录音硬件未测，不作为本轮完成前置，也不宣称通过。以下源 issue 中手机条款按此最新指令执行。
- 每项保留场景、预期、实际、环境/时间、提交与证据。未执行、失败、阻塞不能写成通过；功能测试、生产核验与用户体验确认分别记录。
- 敏感生产记录、配置、备份明细留在受控私有证据目录；公开报告仅保留脱敏结果。
- 实现与浏览器/真实服务/发布验收全部满足后再关闭 issue；总清单最后关闭。


## 2026-10-10 23:50 集成证据说明

以下逐条映射的状态仍为“验证中”：局部通过不替代完整场景、最终 CI 或上线核验。提交暂为 `codex/kairos-complete-backlog` 工作树，候选提交建立后绑定；不将基线提交冒充实现提交。

- **G / DB**：本机 Go 1.27.0，完整 `go test -p 1 ./...`、广泛 race 通过；SQLite/MySQL/PostgreSQL 实際 fresh 与历史升级通过，Go tidy 无依赖变化；golangci-lint 2.13.1 无问题。
- **F / FE / E / I / C / T**：Node 24.16.0 / pnpm 11.0.1，最终 lint、226 个测试文件 / 2037 项测试、生产构建通过。各行所列测试名限定其断言范围；模拟网络、定位、DOM 测试不替代实际浏览器。
- **P**：发布/备份 Python 回归 86 项通过；真实 Docker 故障演练单列，尚未完成。新增隔离应用验收器另行验证。
- **B**：本机 ego lite，隔离合成账号；日期与未标签组合、父标签边界、置顶原日期、关联预览保存、原生 PNG 粘贴、聚焦及源码往返、断网冷刷新草稿恢复、图片预览/原件 hash/回收/恢复、公开地名查询与常用地点、日历 9 条一致性已留证。最新离线排队修复与其余跨功能浏览器场景仍继续验证。
- **M / M2 / R11**：真实 Codex 0.156.1，今天/指定日分页、两时期完整查询、全文及来源、事实与推测区分通过；HTTP/2 Connect、gRPC、gRPC-Web、旧 MCP 和文件入口权限回归通过。来源链接实际导航另记。
- **P-live**：真实现有 S3 临时对象读写/校验/删除、失败候选不改原配置、完整试备份通过；真实隔离恢复 712 条记录、55 个附件、110 个媒体文件校验通过，`applicationVerified=false`。管理页面已真实完成检测、试备份、启用原目的地，仍沿用原定时器。待下一次定时执行和恢复应用验收。
- **P0**：每项共同待办——最终提交及相关 CI、合并、1.1.0 正式标签发布、版本/digest、上线前新鲜可恢复备份及上线逐对象数据核对。此前未新发版、未关闭 issue。
- **U-AI**：现有实例无 AI 配置，已收集拟用服务、模型及受控密钥位置，尚待输入。已有模拟失败回归不能记为真实 AI 成功。

完整原始日志、浏览器事件与逐对象摘要保存在项目忽略的受控证据目录；公开内容仅列脱敏结果。没有声称 Evan 已亲自完成体验确认。

## #1 [P1] 分区切换与正文保存需统一提交，避免按旧分区安排外发

来源：https://github.com/EgoSay/kairos/issues/1

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 01-01 | 同时修改正文与归属时，新正文的投递授权只对应最终选择。 | 验证中 | 自动化：G/DB `TestAtomicPartitionSaveUsesOnlyCommittedDestination`：正文与最终映射同事务；F: journal-atomic-partition-save 同一请求；浏览器：切换正文+分区后实际保存/重开/目标提示；后续：P0 |
| 01-02 | 退出同步分区时不会为本次修改产生旧目标的投递授权。 | 验证中 | 自动化：G 同上：退出同步目标后旧目标不获授权；partition rechecks 系列；浏览器：UI 移出分区及最终同步提示；后续：P0 |
| 01-03 | 保存中断、重试和并发修改不会产生跨分区错误授权或重复发送。 | 验证中 | 自动化：G/DB `TestAtomicPartitionSaveRejectsStaleAndUnauthorizedSelection`；`TestPartitionPendingDeliverySurvivesServiceRestart`；`TestMemoRecordCASConcurrentMetadataWriters`；浏览器：保存超时重试、并发冲突比较与草稿继续；后续：P0；隔离接收器确认事件/重复数量 |
| 01-04 | 在隔离环境以合成记录验证以上状态转换；不接触真实社媒或私人记录。 | 验证中 | 自动化：G/DB 测试使用合成用户/隔离库；partition 测试本地 HTTP receiver；浏览器：浏览器也仅合成 QA 数据；后续：P0；保持社媒不触碰 |

## #2 [P1] 发布回滚应支持目标容器不存在的失败状态

来源：https://github.com/EgoSay/kairos/issues/2

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 02-01 | 容器不存在且数据未变时能够恢复旧服务和备份调度。 | 验证中 | 自动化：P `test_missing_container_restores_old_service_and_backup_schedule`；浏览器：不适用；后续：P0；真实隔离 Docker 容器消失演练尚无完整记录 |
| 02-02 | 数据已变化时保留新数据，给出明确的人工处理状态。 | 验证中 | 自动化：P `test_missing_container_with_new_writes_preserves_data_and_requires_intervention`；浏览器：不适用；后续：P0；隔离新写入阻断，不向生产制造故障 |
| 02-03 | Docker 不可用等其他错误不会被一概忽略。 | 验证中 | 自动化：P `test_docker_daemon_failure_is_not_treated_as_a_missing_container`；浏览器：不适用；后续：P0；故障注入仅隔离 |
| 02-04 | 服务健康确认、重复回滚和 pending 状态管理有隔离回归覆盖。 | 验证中 | 自动化：P `test_failed_health_verification_keeps_pending_and_never_records_success`、`test_retry_after_interrupted_health_check_restores_consistent_state`；浏览器：不适用；后续：P0；真实隔离健康失败/重试证据 |

## #3 [P2] 编辑器仅修改分区时应正常保存

来源：https://github.com/EgoSay/kairos/issues/3

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 03-01 | 仅切换分区、移出分区、重新启用暂停分区均持久化成功。 | 验证中 | 自动化：G `TestAtomicPartitionSaveUsesOnlyCommittedDestination`；F: journal-atomic-partition-save、journal-partition-save 显式重启暂停映射；浏览器：仅切换/移出/显式重启分区三种保存重开；后续：P0 |
| 03-02 | 保存后重新打开，显示实际归属及同步状态。 | 验证中 | 自动化：F: journal-partition-picker suspended/selected metadata；服务端原子结果 G；浏览器：保存重开实际归属与同步状态逐一核对；后续：P0 |
| 03-03 | 分区保存失败不提示成功或静默丢弃选择；重试行为明确。 | 验证中 | 自动化：F: journal-atomic-partition-save `keeps the draft selection on failure and retries the same atomic request`；浏览器：网络错误提示/保留选择/重试；后续：P0 |
| 03-04 | 确实没有任何修改时仍维持原有无修改提示。 | 验证中 | 自动化：F 同文件 `keeps the no-change result for an unchanged selection`；浏览器：未修改保存提示；后续：P0 |
| 03-05 | 上述场景纳入前端回归测试。 | 验证中 | 自动化：G + FE：对应前端回归已实际全套执行；仍需最终候选检查绑定；浏览器：非独立 UI 场景；后续：P0/最终前端 CI |

## #4 [P2] 定时回滚完成后，流水线仍需恢复生产部署声明

来源：https://github.com/EgoSay/kairos/issues/4

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 04-01 | 定时保护先完成、流水线后处理时，最终恢复对应旧版本声明。 | 验证中 | 自动化：P `test_watchdog_then_matching_ci_request_does_not_restore_twice`；浏览器：不适用；后续：P0；隔离 watchdog→CI 对齐 old digest/声明 |
| 04-02 | 流水线先完成、请求重复或中断重试时，结果一致且无多余回退。 | 验证中 | 自动化：P `test_ci_then_watchdog_and_repeated_ci_leave_the_completed_release_unchanged`、lost response Dokploy 测试；浏览器：不适用；后续：P0；隔离中断/重试真实服务 |
| 04-03 | 回执缺失、属于其他发布或回滚被新写入阻止时，不盲目回退声明。 | 验证中 | 自动化：P missing/other/stale receipt、new writes 与 wrong image/template 测试；浏览器：不适用；后续：P0；最终应用/commit/digest/template identity |
| 04-04 | 隔离回归覆盖服务器状态与生产声明的一致性及发布标识校验。 | 验证中 | 自动化：P `test_safe_rollback_restores_declaration_checks_old_image_and_resumes_backups`；Compose 实解析；浏览器：不适用；后续：P0；实际回滚声明和旧运行配置一致性仍需隔离演练 |

## #5 [R02] 优化搜索：关键词、可视化筛选与未添加标签快捷入口

来源：https://github.com/EgoSay/kairos/issues/5

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 05-01 | 无需表达式即可查出“去年、未添加标签、带图片”的记录。 | 验证中 | 自动化：G/DB `TestMemoSearchFacetsAndPinnedPagination`；F: memo-search + QuickFind 组合 facets；浏览器：B 15:22 去年2025+未标签已过；仍补带图片三条件同测；后续：P0 |
| 05-02 | 未标签筛选覆盖空数组/历史缺失字段，已打标签记录不会误入；补标签后及时退出结果。 | 验证中 | 自动化：DB 缺失/null/空 tags fixture；T 标签计数错误状态；浏览器：现有结果补标签后立即退出；无错误空态；后续：P0 |
| 05-03 | 包含、排除、任一/全部、日期边界及当前范围与全部范围行为明确且一致。 | 验证中 | 自动化：F: memo-search/quick-find-navigation/memo-views；C 时区边界；浏览器：包含/排除/any/all/当前→全部组合逐项；后续：P0 |
| 05-04 | 分页与计数基于完整结果，不只过滤已加载的一页；三种视图保留同一筛选范围。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle`；DB 分页；C 三视图范围/时区；F map-memos 全页失败；浏览器：B 15:44 当天日回看9条且排除旧置顶；完整日历/地图同条件仍待；后续：P0 |
| 05-05 | 搜索关键词含引号、中文、空格等普通字符时正常工作；中文输入法确认不意外提交。 | 验证中 | 自动化：DB 中文及特殊字符；F memo-search literal；IME 需浏览器；浏览器：B 原生date输入需键盘事件已修测试方式；中文IME及特殊字符交互仍待；后续：P0 |
| 05-06 | 返回记录列表保留上下文；空态、失败重试、键盘及手机操作可用。 | 验证中 | 自动化：T 错误与重试；C 路由范围；F quick-find-navigation；浏览器：空/失败、返回上下文、键盘及窄屏；后续：P0 |
| 05-07 | 原有高级表达式与已保存视图仍可使用。 | 验证中 | 自动化：C/F memo-views saved view；QuickFind 保留 CEL 草稿；浏览器：旧表达式与已保存视图真实打开/返回；后续：P0 |

## #6 [R03] 优化图片粘贴：直接插入、上传反馈与失败恢复

来源：https://github.com/EgoSay/kairos/issues/6

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 06-01 | 截图、复制本地图片以及浏览器提供的图片剪贴板数据可一次粘贴添加，无需额外点击上传。 | 验证中 | 自动化：E Editor paste+inline/file 分流；系统 clipboard 未由 jsdom 证明；浏览器：B 15:32 原生PNG剪贴板已保存；复制本地/网页路径与降级仍补；后续：P0 |
| 06-02 | 多张、连续及文字图片混合粘贴不丢内容，位置和顺序正确。 | 验证中 | 自动化：E mixed HTML/local-vs-remote image 顺序；I pending anchor 映射；浏览器：B 单PNG+前后文字已保存；多张连续/HTML混合真实路径仍待；后续：P0 |
| 06-03 | 上传中可继续输入，失败重试后图片只插入一次。 | 验证中 | 自动化：E/I 锚点、partial retry stable IDs、失败不重传完成部分；浏览器：上传中继续输入/失败重试/只插一次；后续：P0 |
| 06-04 | 断网、刷新、重新打开编辑器后正文和本地图片仍可恢复，状态不误报服务器保存成功。 | 验证中 | 自动化：I 图文离线位置/重启恢复；E owner isolation；B-text 仅文字局部；浏览器：B 15:36 实际断网冷刷文字+图片恢复、联网上传续传已过；最终修复pending路径需再核原位/稳定ID/原件hash；后续：P0；实际同步后正文/附件核对 |
| 06-05 | 保存后记录正文与附件库引用一致，能够预览及下载原件。 | 验证中 | 自动化：I resolve inline+attachment same object；G attachment APIs；浏览器：B saved正文含managed attachment；R07后同原件可预览/恢复；仍需下载hash+库同对象；后续：P0 |
| 06-06 | 主用桌面浏览器和手机实际验证支持路径；不支持时提供可理解的反馈和手动添加入口。 | 验证中 | 自动化：E insert-menu 手动添加/failure UI；模拟能力有限；浏览器：ego desktop+手机视口，unsupported 可理解反馈；后续：P0；输入：真机条件已按用户改范围，不再索取设备 |

## #7 [R04] 优化位置添加：快捷入口、常用地点与定位纠错

来源：https://github.com/EgoSay/kairos/issues/7

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 07-01 | 在真实主用设备定位，区分地图显示偏移、设备精度不足和名称错误，并记录实际修复依据。 | 验证中 | 自动化：G provider/geocoding、地点坐标校验；F editor-location 低精度/晚响应；浏览器：B 15:43 实际公开地理搜索成功；未见真实设备定位精度回执，不能冒称GPS偏移实测；后续：P0；输入：若本机权限拒绝则保留拒绝/手选验收，必要 OS 授权由用户决定 |
| 07-02 | 快捷选择当前位置、已有常用位置和地图选点可用；地点搜索结果可预览确认。 | 验证中 | 自动化：G/FE：位置owner/CAS，search/selected map/保存；recent-location reopen新红绿在 location-reopen-after.log；浏览器：B 15:43 上海人民公园2结果+命名保存/默认中心禁存通过；recent reopen缺陷已FE修复待浏览器重验；后续：P0 |
| 07-03 | 拒绝权限、超时、网络失败均有可恢复状态，不把默认地图中心保存为真实位置。 | 验证中 | 自动化：F editor-location denied/timeout/unavailable，location-dialog 默认中心不选中；浏览器：B 默认中心不可保存已证；拒绝/超时/网络失败实际恢复仍待；后续：P0 |
| 07-04 | 已手选位置或手填名称不会被旧异步响应覆盖；取消及重开不丢原值。 | 验证中 | 自动化：F editor-location late result/name/manual/cancel/reopen；浏览器：打开原位置→手选改名→迟到响应→重开；后续：P0 |
| 07-05 | 地名解析不可用时，已确认坐标仍可保存。 | 验证中 | 自动化：F editor-location `allows saving verified coordinates when name lookup fails`；浏览器：名称服务失败仍保存已确认坐标；后续：P0 |
| 07-06 | 已有记录不会在编辑或打开页面时被自动改成当前位置。 | 验证中 | 自动化：F editor-location `preserves the original on open/cancel and never automatically locates...`；浏览器：旧记录打开/取消前后位置核对；后续：P0 |
| 07-07 | 手机软键盘、点选和窄屏布局可用；不承诺设备无法提供的绝对 GPS 精度。 | 验证中 | 自动化：F layout不能证明实际视口；浏览器：ego 窄屏/字号/点选/键盘可达；不声称绝对 GPS 精度；后续：P0；输入：用户已换验收范围，无实体手机前置 |

## #8 [R05] 将聚焦模式设为编辑器直接可见入口

来源：https://github.com/EgoSay/kairos/issues/8

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 08-01 | 无需展开更多菜单即可进入和退出聚焦模式，入口支持键盘与触控。 | 验证中 | 自动化：E/insert-menu direct focus 及 host frame 测试；浏览器：B 15:32 直接聚焦切换已过；Tab/Enter/窄屏发现性仍待；后续：P0 |
| 08-02 | 多次切换后正文、光标、附件、位置、关联及未完成上传保持一致。 | 验证中 | 自动化：E memo-editor-paste-files same editor/pending image source/focus；focus viewport；浏览器：B 单PNG+正文source/focus往返已过；全部metadata/选区/长文scroll多次组合待；后续：P0 |
| 08-03 | 切换不会意外提交、取消编辑或清理草稿。 | 验证中 | 自动化：E 同上无 editor remount；草稿恢复回归；浏览器：B 往返后source相等且实际保存成功；草稿未清验证局部，取消路径待；后续：P0 |
| 08-04 | 关闭子对话框和退出聚焦的 Esc/焦点行为清楚且一致。 | 验证中 | 自动化：E `gives dialogs priority on Escape`；preview-image-dialog Esc hierarchy；浏览器：Esc 先关位置/关联/媒体，再退出聚焦/原焦点；后续：P0 |
| 08-05 | 桌面、手机软键盘及大字号情况下核心动作可见可用。 | 验证中 | 自动化：E visual viewport frame 测试；浏览器：ego 桌面/手机视口/150%字号核心动作可达；后续：P0；输入：实体软键盘不冒称通过 |
| 08-06 | 保存按钮继续正确展示普通保存或保存并同步的真实行为。 | 验证中 | 自动化：F journal-partition-picker enabled/suspended target labels；浏览器：普通保存/同步保存实际标签与结果；后续：P0 |

## #9 [R06] 优化写作时关联已有记录：快捷搜索、预览与双向回看

来源：https://github.com/EgoSay/kairos/issues/9

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 09-01 | 从当前编辑器可快速找到、预览并关联旧记录，关闭选择器后继续原位置写作。 | 验证中 | 自动化：F link-memo-search delayed open；relation preview；E focus continuity；浏览器：B 15:25 真搜索/预览/关联后继续写并保存；精确caret可补截图/selection；后续：P0 |
| 09-02 | 关键词搜索、后续页、空态和失败重试可用；特殊字符不导致查询失效。 | 验证中 | 自动化：F link-memo-search 后页失败/重试/晚响应；literal quoting 共用搜索；浏览器：特殊字符、空/错、后页真实 UI；后续：P0 |
| 09-03 | 保存后正向及反向关系一致，刷新仍可回看。 | 验证中 | 自动化：G `TestMemoRelationsHideTrashedEndpointsAndRestoreBidirectionally`；DB 事务；浏览器：B 正向关系已写入DB；反向刷新/回看仍需明确证据；后续：P0 |
| 09-04 | 自关联、重复添加、移除关联及目标删除行为明确，不误删正文。 | 验证中 | 自动化：G `TestMemoSaveSkipsUnavailableReferencesWithoutLosingBody`；DB 并发 target 删除；F relation warns；浏览器：自关联/重复/移除/目标删除的提示和正文不丢；后续：P0 |
| 09-05 | 阅读关联记录并返回时草稿、光标和滚动位置保留。 | 验证中 | 自动化：E editor retained；F direct dialog focus pointer；浏览器：B 关联后继续写已过；原长文滚动与选区未记录；后续：P0 |
| 09-06 | 键盘选择和手机操作可用，快速输入不会使用过期结果。 | 验证中 | 自动化：F link-memo-search `hides previous candidates...ignores late results`；浏览器：Tab/Enter 与窄屏；快速输入竞态 UI；后续：P0 |
| 09-07 | 关系可随现有导出/恢复流程保留，权限与回收站语义一致。 | 验证中 | 自动化：G `TestJournalBackupNewInstanceRoundtripAndNoReplay` relation remap + R06 trash/restore；浏览器：导出恢复后可双向回看/权限提示；后续：P0；新备份隔离应用恢复关系检查 |

## #10 [R07] 修复附件预览并让附件随记录进入和恢复回收站

来源：https://github.com/EgoSay/kairos/issues/10

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 10-01 | 先使用真实故障类型或等价合成样本复现，修复后同一路径可正常预览，并记录根因。 | 验证中 | 自动化：E preview-image-dialog load error；G special filename/trash reproducer；浏览器：B 15:40 原生图片预览/trash恢复路径通过；媒体失败fallback/故障根因仍需对应记录；后续：P0 |
| 10-02 | 图片、音频、视频及文档按支持能力正常预览或明确降级；中文、空格、#、? 等文件名不破坏访问。 | 验证中 | 自动化：G fileserver originals/Range/thumb/motion；F attachment-urls/media-loading；浏览器：B PNG decode与原件200；音频/视频播放、文档和特殊名实际路径仍待；后续：P0 |
| 10-03 | 删除记录后附件退出默认列表及计数，回收站可找到对应对象；正常归档附件保持原有可见性。 | 验证中 | 自动化：G `TestAttachmentLibraryTrashLifecycleAndPagination`；DB before pagination；浏览器：B 15:40计数3→2→3/正常URL trash时404；归档区别浏览器仍补；后续：P0 |
| 10-04 | 恢复记录后原件、缩略图、播放和来源跳转恢复，旧分享不会被自动恢复。 | 验证中 | 自动化：G `TestTrashAttachmentExplicitOwnerPreviewAndSpecialFilename`、TrashRestoresPrivately；old share revoked；浏览器：B 本人trash decode、restore原件200已过；音视频/来源/旧share拒绝另补；后续：P0 |
| 10-05 | 30 天保留、永久清理、有效引用及历史版本引用得到一致处理。 | 验证中 | 自动化：G `TestPurgeRevisionRetainsOriginalReferencedElsewhere`、30天过期；P历史原件snapshot；浏览器：保留期/永久清理提示可理解，勿删真实资料；后续：P0；隔离清理/恢复核对 |
| 10-06 | 全量计数与分页一致；批量删除、恢复及网络重试后不留下过期界面状态。 | 验证中 | 自动化：G/DB library分页；F attachment-library-stats drains all pages；浏览器：B 单条删除恢复计数已过；批量/失败重试/分页总量仍待；后续：P0 |
| 10-07 | 桌面和手机预览、关闭、缩放或播放均可操作；不可预览时提供错误信息与可用的原件下载。 | 验证中 | 自动化：E preview dialog zoom/wheel/Esc/mobile arrows、media fallback；浏览器：ego 窄屏预览关闭缩放/实际播放时间前进/原件下载；后续：P0 |
| 10-08 | 现有已删除记录纳入新规则，不要求用户重新删除一次。 | 验证中 | 自动化：DB `TestAttachmentLifecycleFiltersBeforePagination` 老trash文档fixture；G无需重写逻辑；浏览器：已有墓碑样本无需再删即进入附件回收站；后续：P0；现有历史数据只读核验 |

## #11 [R08] 数据库与附件定时备份到 S3：配置检测、独立状态页与恢复验证

来源：https://github.com/EgoSay/kairos/issues/11

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 11-01 | 可配置至少一个实际 S3 兼容目的地，检测真实读写；错误凭据、无权限、无效目标和网络失败提示可操作。 | 验证中 | 自动化：P/G + P-live：真实错误候选不改原配置；真S3临时对象读写/hash/删除及restic访问通过；浏览器：服务器动作已证；设置UI触发/错误反馈闭环待；后续：P0；已用获准真实目的地，不重复制造无关检测；输入：S3已授权设施，原则上无新输入 |
| 11-02 | 数据库和附件定时备份实际完成，远端快照、保护时间点及本地成功回执一致。 | 验证中 | 自动化：P partial/receipt/upload断言；P-base真实旧备份恢复；浏览器：状态页保护时间/远端快照一致；后续：P0；新版本真实timer执行及snapshot receipt对应 |
| 11-03 | 修改配置失败不破坏现有有效备份；暂停、启用、手动执行与自动调度不重复运行。 | 验证中 | 自动化：P connection/activation failure rollback；overlap locks；paused schedule preserved；浏览器：失败编辑保留原配置；启停/手动/auto状态；后续：P0；P-live错误配置保持原有效config；真实启停/激活/互斥与timer行为仍待 |
| 11-04 | 未完成或部分备份不能标成功；存在 S3 源附件或外链缺口时覆盖范围清楚。 | 验证中 | 自动化：P snapshot managedS3/外链/missing original/partial restic tests；浏览器：部分失败coverage展示不冒成功；后续：P0；受管S3真实源覆盖/缺口核对 |
| 11-05 | 独立状态页准确展示各阶段、各目标和历史；失败、超时及回执过期不会显示正常。 | 验证中 | 自动化：P status redact/stale/latestfailure；F cloud-backup stale fetched success；浏览器：完整状态页/错误/历史/目标切换/超时；后续：P0；宿主真实job/monitor receipt对应 |
| 11-06 | 浏览器待同步草稿不被算作服务器已备份内容；独立副本的延迟单独展示。 | 验证中 | 自动化：F cloud-backup；代码文案不足以证明本地pending排除；浏览器：带本地待同步草稿查看状态，不算server成功；后续：P0；独立副本delay与server时间分别核对 |
| 11-07 | 从明确快照进行隔离恢复，核对正文、关系、日期、附件原件与应用可用性。 | 验证中 | 自动化：P/G + P-live：明确abc65快照恢复712记录/55附件/110媒体核验，applicationVerified=false；浏览器：待隔离应用登录/关系/原件播放与权限核验；后续：P0；文件恢复已证，真实运行应用验证仍不能省 |
| 11-08 | 恢复不意外激活旧分享、外部投递或重复历史记录；不覆盖正在写入的数据。 | 验证中 | 自动化：P/G + P-live：restore报告sessions撤销/external暂停/storage隔离；仍需应用负向验证；浏览器：真实恢复实例旧share/session/外发暂停可见性待；后续：P0；隔离恢复无旧授权/无外发/不覆盖当前源 |
| 11-09 | 页面关闭不影响服务器定时备份；实际调度执行和独立监控有证据。 | 验证中 | 自动化：P independent report failure；P-agent unit/timer active局部；浏览器：关闭页面后不需要browser维持job；后续：P0；至少实际自动周期+独立monitor与副本证据 |

## #16 [R09] 完善嵌套标签：树形展示、折叠与父子级筛选

来源：https://github.com/EgoSay/kairos/issues/16

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 16-01 | 收起“人生修行”后子级隐藏；展开可访问多层分支，刷新后展开状态保留。 | 验证中 | 自动化：T/F tag-tree remount scope expansion；浏览器：B 15:24父级展开持久状态已过；多层分支/清空再选可补；后续：P0 |
| 16-02 | 点击父级可完整找回自身与后代记录，点击子级只缩小到该分支；结构性父级同样可筛选。 | 验证中 | 自动化：DB full path segment；G父count不重复；T结构父可点击；浏览器：B父人生修行只返回3条且排除相似前缀已过；结构父/子支完整结果待；后续：P0 |
| 16-03 | 箭头展开与名称筛选相互独立，手机不依赖鼠标悬停才能找到展开入口。 | 验证中 | 自动化：T label independent disclosure；浏览器：窄屏始终可见展开箭头，键盘区分操作；后续：P0 |
| 16-04 | 同一条记录带多个子标签时，父级计数与结果列表均不重复；分页覆盖完整结果，不只处理当前已加载的一页。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle`；DB分页；浏览器：多子标签单record父计数=1且完整多页；后续：P0 |
| 16-05 | 相似前缀、不同父级下同名子标签不会混入结果；父级上下文清楚。 | 验证中 | 自动化：DB prefix边界fixture；F memo-search path；浏览器：B 人生修行 vs 人生修行者边界已过；不同父同子仍补；后续：P0 |
| 16-06 | 编辑器能搜索、补全并保存完整嵌套路径；既有路径与平级标签均正常保留。 | 验证中 | 自动化：FE editor-tag-autocomplete/tag-grammar/tag-unicode-parity + E旧Markdown/标签roundtrip；浏览器：真实搜索补全完整嵌套路径/保存重开；后续：P0 |
| 16-07 | 侧栏与 R02 搜索结果一致，键盘与手机操作完成实际验证。 | 验证中 | 自动化：C/T 查询范围/标签交互已测；浏览器：sidebar与QuickFind同条件+键盘/窄屏；后续：P0 |

## #17 [R10] 完善记录置顶：统一入口、首页展示与状态规则

来源：https://github.com/EgoSay/kairos/issues/17

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 17-01 | 卡片与详情页均能置顶/取消置顶，桌面与手机入口可发现，成功和失败反馈明确。 | 验证中 | 自动化：F journal-memo-media/action menu；G owner权限；浏览器：卡片/详情 pin/unpin 成功失败可发现；后续：P0 |
| 17-02 | 一年前的正常记录置顶后可在个人首页编辑区下方找到，并有置顶标记。 | 验证中 | 自动化：DB pinned old createdTs在查询头部；G时间不变；浏览器：B 15:23去年样本置顶排第一、显示已置顶；编辑区具体位置可截图；后续：P0 |
| 17-03 | 多条置顶按记录时间倒序；跨分页不重复、不遗漏，不把仅当前页的数据当作全部置顶。 | 验证中 | 自动化：DB `TestMemoSearchFacetsAndPinnedPagination` oldpin顺序及分页；浏览器：多置顶跨页去重+取消后顺序；后续：P0 |
| 17-04 | 刷新、重新登录和换设备后状态一致；取消后回到正常时间位置。 | 验证中 | 自动化：G服务端pin持久化；F cache mutation仅局部；浏览器：B pin后刷新状态一致；登出重登/第二会话/取消顺序待；后续：P0 |
| 17-05 | 原始记录日期未改变，日历和某日回看的时间顺序保持正确。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle` create/update timestamp unchanged；C时区；浏览器：B 15:44今日日回看不含去年置顶；pin前后时间须结合qa-pin-before/after核对；后续：P0 |
| 17-06 | 带关键词、标签、日期条件时，不出现无关置顶记录。 | 验证中 | 自动化：DB查询先filter后pin排序；F memo views composition；浏览器：B父标签过滤与今日date都没有无关旧pin通过；keyword场景待；后续：P0 |
| 17-07 | 归档/移入回收站立即退出首页置顶区，恢复后原置顶状态仍在。 | 验证中 | 自动化：G state恢复保留pin+trash排除；未组合真UI；浏览器：归档/trash立即退出pin区，恢复原pin仍在；后续：P0 |
| 17-08 | 操作遵守本人记录权限，失败不会留下与服务器状态不一致的置顶展示。 | 验证中 | 自动化：G另一用户PermissionDenied；F useMemoPin关联cache待FE；浏览器：失败UI不假置顶/不丢原状态；后续：P0 |

## #18 [R11] 完善 MCP 接入：只读授权、日期检索与可追溯回顾

来源：https://github.com/EgoSay/kairos/issues/18

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 18-01 | 从设置创建 Agent 专用只读凭证、复制配置并连接 Codex，完成一次真实读取；界面检测结果与实际连接一致。 | 验证中 | 自动化：A只读授权；M真实Codex已连接读取；F agent-access/config test；浏览器：设置创建/复制/检测必须与同一实际凭据连接对应；后续：P0；上线endpoint/token真实读确认 |
| 18-02 | “今天”及指定日期查询遵守 Kairos 时区，跨午夜边界和历史导入日期正确，结果与产品内同范围一致。 | 验证中 | 自动化：A `TestAgentFilterUsesLocalOriginalDatesAndCalendarDST` + query test；M today/history；浏览器：产品同范围对照、跨午夜结果；后续：P0 |
| 18-03 | 日期范围、关键词、父子标签、分区、置顶条件可组合；单条完整记录及其原文链接可用。 | 验证中 | 自动化：A `TestAgentQueryOwnArchiveTrashPagingAndOriginalDate`组合+全文；M单条返回source；浏览器：真实浏览器打开source URL；多条件查询UI对照；后续：P0 |
| 18-04 | 正常与归档记录按约定纳入，回收站内容默认排除，权限边界不因 MCP 接入而扩大。 | 验证中 | 自动化：A owner/archive/trash/comment与fileserver边界；浏览器：回收站排除与可见范围对应；后续：P0 |
| 18-05 | 大结果集可连续分页；未读完明确标识；无结果、请求失败、部分结果可区分。 | 验证中 | 自动化：M 4页/2页明确覆盖；A tampered/query/owner cursor、partial label；浏览器：失败/空态展示与取全指引；后续：P0 |
| 18-06 | 只读凭证的写入尝试被服务端拒绝，不能通过其他接受该凭证的接口绕过限制。 | 验证中 | 自动化：A真Connect/gRPC/gRPC-Web/旧MCP写拒绝、fileserver专用prefix全拒绝；浏览器：设置说明“只读正文，不含文件下载”；后续：P0；公开与私密入口负向 smoke |
| 18-07 | 不同 Agent 凭证可独立撤销；过期/撤销立即按既定授权规则生效，最近使用时间可查看。 | 验证中 | 自动化：A expiry/revoke/lastUse/independent credential；F agent-access；浏览器：命名/到期/撤销/最近使用显示；后续：P0；线上新合成凭据验证后撤销 |
| 18-08 | 实际演示“今日回顾”和“两段时间对比”：Agent 可引用原文并回到记录，说明读取范围、区分事实与解读。 | 验证中 | 自动化：M2真Codex两时期+今日观察、8次读调用/全页、原文引用、事实/推测与合成边界均已留证；浏览器：完整分析演示已通过；至少sourceUrl实际打开回到对应记录仍待；后续：P0；上线source链接核验；输入：不需新权限，合成记录+已获准Codex即可 |
| 18-09 | 未修改既有正文、时间、标签或附件；用户数据不因接入被改成公开。 | 验证中 | 自动化：A write-denial count unchanged；metadata只读；仍需整体前后digest；浏览器：读取前后记录/附件/标签/时间不变；后续：P0；实际只读演示前后指纹核对 |

## #19 [R12] 优化编辑体验：Markdown 即时渲染与可视化格式编辑

来源：https://github.com/EgoSay/kairos/issues/19

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 19-01 | 不懂 Markdown 的用户可用直接可见的按钮写出包含标题、加粗、列表等首期格式的记录。 | 验证中 | 自动化：E editor-formatting full command tests；insert-menu直接入口；浏览器：非Markdown操作路径标题/粗体/列表等全格式；后续：P0 |
| 19-02 | 直接输入 Markdown 后在编辑位置看到效果；列表、待办、引用、链接和代码等格式正确，代码内容不被误当作正文语法处理。 | 验证中 | 自动化：E editor-live-preview structure/code literal/task undo；真实CM实例测试；浏览器：输入即显，active line语法/代码样式，长文；后续：P0 |
| 19-03 | 粘贴一段含列表、链接和图片的内容后可以继续编辑，保存并重新打开时结构和图片位置完整。 | 验证中 | 自动化：E mixed semantic paste+I inline completion；浏览器：B 原生单PNG+前后文本保存通过；列表链接HTML混合paste保存重开仍待；后续：P0 |
| 19-04 | 从网页或文档粘贴保留基础语义格式且不带入来源字体、颜色、背景；粘贴为纯文本可用。 | 验证中 | 自动化：E semantic/plain intents、HTML styles dropped、pre空行保留；浏览器：系统paste与Shift+Cmd/Ctrl+V基础格式对比；后续：P0 |
| 19-05 | 来回切换可视化与源码模式，正文、标签、附件、格式、草稿和编辑位置不丢失，不因只切换模式而静默改坏原文。 | 验证中 | 自动化：E source/focus unchanged doc/editor identity；undo state；浏览器：B 15:32 visual/source原文相等+focus后保存已过；复杂选区/scroll/metadata组合待；后续：P0 |
| 19-06 | 正确区分 Markdown 标题与嵌套标签；关联记录、附件和已有复杂内容继续可用，必要时能切源码精确编辑。 | 验证中 | 自动化：E legacyMarkdown/tags/complex/code + R06关系保存；浏览器：标题与#嵌套标签、关联附件旧复杂文本往返；后续：P0 |
| 19-07 | 中文输入法组合输入、选择文字、撤销重做、草稿恢复完成验证；普通编辑与聚焦模式操作一致。 | 验证中 | 自动化：E IME deferral/undo/redo/anchor、I durable；jsdom非真实IME；浏览器：ego中文输入法组合+选区+undo/redo+focus一致；后续：P0 |
| 19-08 | 编辑呈现与保存后的阅读结构一致，历史记录及导出内容保持可读 Markdown。 | 验证中 | 自动化：E exact Markdown doc；G export exact bytes；渲染视觉仍待；浏览器：旧记录编辑/阅读结构对照+导出Markdown应用外打开；后续：P0 |
| 19-09 | 手机真机验证格式按钮、软键盘、选区和粘贴体验；桌面窄视口不替代真机验收。 | 验证中 | 自动化：E viewport工具只是模拟；浏览器：按用户改范围做ego手机视口/格式/选区/粘贴；不冒真机；后续：P0；输入：实体手机已豁免，个人体验另记 |

## 本轮工程进展（仍待最终提交与上线核验）

- 2026-10-10 本机：保存与分区事务、稳定 ID 重试、持久投递意图已通过定向 Go race 与三数据库事务测试；仍待浏览器和生产验证。
- 发布恢复：53 项脚本测试通过，覆盖目标容器缺失、定时恢复部署声明、新写入保护及重复恢复；仍待最终隔离演练。
- 搜索：SQLite / MySQL / PostgreSQL 实际查询测试通过，覆盖历史空标签、标签分支边界、媒体与分区组合、中文特殊字符、分页和置顶顺序；83 项前端定向回归通过。浏览器和最终候选 CI 尚未完成。
- 集成回归发现“包含归档”也会返回回收站记录，已增加数据库层 `ExcludeTrashed` 并在列表与统计入口启用；列表/统计/MCP 联合 race 回归通过。
- 线上基线：服务 1.0.1 健康，数据库完整性正常，备份定时器活动。最新真实备份恢复到服务器隔离目录，712 条记录、55 个附件、111 个清单文件全部校验通过；此时 `applicationVerified=false`，尚不声明应用恢复验收完成。私有清单留在受控服务器目录。

## 历史 AC 回归范围

历史已关闭不代表本轮通过。以下逐项需要新证据；AC37 真实社媒按用户指令暂缓。

| ID | 场景 | 预期 | 本轮状态 | 实际结果 / 环境与时间 / 提交 / 证据 |
| --- | --- | --- | --- | --- |
| AC01 | 写一句话并保存 | 无标题或标签门槛；原话保留；无后续任务 | 验证中 | 自动化：G CreateMemo/日期/无重复测试；F home-loading-boundary；浏览器：B多条合成正文实际保存已证；无额外任务界面仍补简短检查；后续：P0 |
| AC02 | 只保存照片或录音 | 有效媒体可成条；原件及播放可验证；转写可不使用 | 验证中 | 自动化：G OriginalRetainsBytes、PhotoOriginalAndRevisionMediaRecovery；F journal-memo-media纯媒体；浏览器：B PNG文字混合已过；纯图片/纯音频及真实播放/原件hash仍待；后续：P0；输入：设备录音硬件未测不作前置；转写可不用 |
| AC03 | 三个月未使用后打开 | 无缺席、积压、连续天数或回归弹窗 | 验证中 | 自动化：F app-sidebar `keeps...without task prompts`仅当前渲染；浏览器：三月前合成账户进入首页，无缺席/积压/streak/弹窗；后续：P0 |
| AC04 | 一直只使用记录 | 三项探索不自动展开、不产生红点或通知 | 验证中 | 自动化：F sidebar optional exploration；不是长期副作用证明；浏览器：一直写记录场景，无自动展开/红点/推送；后续：P0 |
| AC05 | 主动进入每日回顾 | 少量原文；同日再进稳定；无往年今日也能自然退化 | 验证中 | 自动化：G `TestReviewFrozenSetRemovalAndCalendarTimezone`最多3/同日冻结/移除不补位；F journal.test eligible；浏览器：主动回顾再入稳定，无往年今日退化；后续：P0 |
| AC06 | 从回顾详情返回 | 原位置和阅读状态恢复；无已读任务计数 | 验证中 | 自动化：F journal-session frozen review across detail；状态不等于scroll；浏览器：长文进入详情返回原卡/阅读滚动，无已读任务；后续：P0 |
| AC07 | 漫步换条并后退 | 纯随机、同次不重复；后退回到原条；随时离开 | 验证中 | 自动化：F journal.test shuffle/history/no repeat/forward after back；journal-queries全页失败；浏览器：真实漫步数次后退再前进/随时离开；后续：P0 |
| AC08 | 没有旧记录 / 只有一条 | 无凑数、无虚构内容、无鼓励完成的提示 | 验证中 | 自动化：F journal.test empty+single archives；浏览器：0条/1条样本真实空态，无凑数/鼓励任务；后续：P0 |
| AC09 | 进入 AI 页但未点开始 | 不向模型发送正文，不生成分析 | 验证中 | 自动化：G `TestJournalInsightConsentOwnerScopeSaveStaleAndDeletion` config GET/PUT 0 calls；浏览器：开AI页未开始，network无generate/无正文请求至模型；后续：P0 |
| AC10 | 选两条记录生成洞察 | 只发送所选范围；来源可核；不读取全库或媒体 | 验证中 | 自动化：G同上只选正文、不含foreign；provider insight selected input；mock边界；浏览器：UI选两条生成，来源可点回/发送预览；真实服务必须另证；后续：P0/真实AI仅合成记录；输入：U-AI |
| AC11 | AI 失败、取消或输入超限 | 原始记录不变；范围保留；无隐式截断或自动重发 | 验证中 | 自动化：AI六场景新race+provider取消/redirect tests；不改原文/不保存/不retry；浏览器：失败/取消后范围与draft保留；输入超限明确；后续：P0/实际服务失败或安全取消验证；输入：U-AI |
| AC12 | 看完 AI 直接离开 | 无保存、评价、反思要求；不自动写入时间线 | 验证中 | 自动化：G generate后insights=[]；无隐式持久化；浏览器：结果直接离开，无保存/评价/反思强制动作；后续：P0 |
| AC13 | 明确保存洞察 | 来源和 AI 标识保留；可找回、删除、导出；不默认进入回顾 | 验证中 | 自动化：G insight显式save、来源/陈旧；Backup保存AI导出；F回顾排除derived；浏览器：保存洞察→找回/删除/导出，AI标记；不入普通回顾；后续：P0 |
| AC14 | 修改或删除被分析的记录 | 修改使旧结果过时；删除清理可泄露原文的衍生结果 | 验证中 | 自动化：G insight source edit=>stale，trash=>derived清理；浏览器：修改/删除后旧洞察状态真实更新；后续：P0 |
| AC15 | 排除某条回顾内容 | 立即退出回顾与漫步；仍可主动找到并恢复偏好 | 验证中 | 自动化：G frozen review exclusion；F journal-source-picker `restores only this record...`；浏览器：排除立刻退出回顾/漫步，主动找回恢复偏好；后续：P0 |
| AC16 | 断网录入并重启应用 | 目标设备上验证实际持久化；未上传媒体不丢；状态真实 | 验证中 | 自动化：I/E offline/pending/blob/owner/QuotaExceeded；B-text局部；浏览器：B 15:36真断网冷刷图文恢复+联网续传已过；最终pending修复需稳定ID/原件hash及恰好一条核对；后续：P0；输入：ego+手机视口为已批准设备边界 |
| AC17 | 网络超时后重复保存 | 不产生重复记录；附件失败不伪装完整成功 | 验证中 | 自动化：F journal-save-reliability lost creation response/stableID；E/I completed image retry；浏览器：断响应重复保存不重复、失败附件不假完整；后续：P0 |
| AC18 | 多设备同时修改 | 保留冲突内容；不静默覆盖 | 验证中 | 自动化：G ConflictKeepsBothVersionsAndRevisionRestore、MetadataCAS与并发Store；F draft conflict保留独立baseline；浏览器：两会话同时改，冲突比较/继续保留本地远端；后续：P0 |
| AC19 | 删除再恢复 / 永久删除 | 可恢复范围与保留期限明确；隐私删除语义一致 | 验证中 | 自动化：G TrashRestoresPrivatelyWithoutSharesAndExpires+R07引用保留；P安全restore；浏览器：trash→restore及隔离永久删除/30天提示；后续：P0；输入：不可逆删除真实资料未授权，使用合成 |
| AC20 | 导出并在应用外打开 | 正文可读、受管理媒体可用、外链缺口显式列出 | 验证中 | 自动化：G `TestJournalBackupNewInstanceRoundtripAndNoReplay` exactbody/关系/原件/AI/refs；archive exact bytes；浏览器：下载ZIP→应用外解压Markdown/媒体可读/缺口报告；后续：P0 |
| AC21 | 从独立备份恢复 | 在干净环境核对恢复范围；结果可复现 | 验证中 | 自动化：P-base + P-live两个真实备份的文件/db恢复已证；最新abc65有110媒体校验且storageIsolated；applicationVerified=false；浏览器：待恢复应用运行/登录/媒体/关系/权限；后续：P0；真实已恢复目录后续应用验收，独立副本证据另核 |
| AC22 | 手机键盘 / 桌面键盘 / 大字体 | 保存可达、焦点可预测、触摸和键盘均可操作 | 验证中 | 自动化：E visual viewport；F home不自动唤键盘+sidebar触控入口；浏览器：ego desktop/390/320px/大字号Tab和保存可达；后续：P0；输入：不宣称实体软键盘验收 |
| AC23 | 未授权访问与首次使用 AI | 私密内容不泄漏；服务与发送范围说明有效 | 验证中 | 自动化：G JournalReadRejectsFormerSpaceMember；A全面owner只读；G insight owner/selected；浏览器：访客无私密/AI首次发送范围说明/不默认发；后续：P0；匿名正文与原件拒绝；输入：U-AI 仅真实AI部分 |
| AC24 | 日期、标签和手选范围分享 | 访客仅看到预览授权内容；组合筛选、子标签及排除语义清楚 | 验证中 | 自动化：G `TestShareSelectionAndSafeText` 日期/标签all/subtags；SharePreviewSnapshot；F journal-share preview digest；浏览器：日期/标签/手选+排除预览→访客仅授权记录；后续：P0 |
| AC25 | 固定分享后新增或编辑原记录 | 不自动追加记录或改写快照；主动更新有差异预览；删除/归档即时撤销 | 验证中 | 自动化：G SharePreviewSnapshotPauseRotateAndWithdrawal固定快照/摘要变化拒绝/归档；F journal-share；浏览器：固定后新增/编辑不变，主动diff，删/归档撤销；后续：P0 |
| AC26 | 动态分享新增、改标签和移除条件 | 规则内内容按授权更新；不符规则或被排除内容退出；无其他记录元信息泄漏 | 验证中 | 自动化：G `TestJournalDynamicSharesDoNotBackfillImportedHistory`；分享filter测试；浏览器：动态新增/改标签/排除/移出条件，不泄露无关metadata；后续：P0 |
| AC27 | 到期、停用、错误提取码与附件直链 | 页面、数据、缩略图及媒体受同一授权；无绕过或泄漏 | 验证中 | 自动化：G journal_share + native/fileserver媒体share/owner；F visitor credentials omission/revocation；浏览器：到期/停用/错码/rotate/撤销+原件缩略图媒体直链；后续：P0；合成授权链接生命周期 |
| AC28 | 普通记录、同步分区及未完成附件 | 普通内容不外发；已启用分区内容完整保存后才外发；目标在保存前可见 | 验证中 | 自动化：G AtomicPartition final commit；PartitionHTTPCompleteSave；E/I pending image gate；F目标显示；浏览器：普通/同步/未完成附件3类真实按钮与payload；后续：P0；隔离receiver，不调用社媒 |
| AC29 | 启用同步时分区已有历史内容 | 默认不补发；主动选择补发才产生对应任务 | 验证中 | 自动化：G `TestPartitionTargetsNeverReplayHistory`、ChangesRequireExplicitSendByDefault；浏览器：已有历史→启用目标无补发，显式选中才任务；后续：P0；隔离receiver事件数 |
| AC30 | Webhook 超时、重复投递、乱序和多目标失败 | 事件稳定可去重；成功目标不重复创建；旧版本不覆盖新版本；本地内容不丢 | 验证中 | 自动化：G TargetsRetryIndependently、RetryIsBounded、PendingSurvivesRestart、RechecksPauseRevision、PauseCancelsInflight；浏览器：UI多目标失败/送达状态与本地内容；后续：P0；本地HTTP协议可通过，平台幂等暂缓；输入：J15平台外部接入不纳入本轮 |
| AC31 | 暂停、移出、删除、归档及恢复 | 待发正文和重试停止；恢复不自动重发；外部撤回结果单独报告 | 验证中 | 自动化：G RechecksPauseRevisionAndDeletion、RestoreDoesNotReactivateMapping、RetractionHasNoDeletedContent；F partition-save普通编辑不复活；浏览器：暂停/移出/删/归档/恢复状态与撤回结果独立显示；后续：P0；隔离receiver确认无旧正文重试 |
| AC32 | Webhook 已接收但没有平台发布回执 | 显示已送达或发布结果未知；只有核验回执才显示已发布 | 验证中 | 自动化：G `TestPartitionPublishedRequiresMatchingReceipt`；浏览器：已送达/结果未知/核验已发布三种UI状态；后续：P0；仅协议验收，真实平台暂缓 |
| AC33 | 删除个人分区 | 保留记录并移至未分区；停止该分区外发，不连带删除生活资料 | 验证中 | 自动化：G `TestJournalPartitionHTTPCompleteSaveAndIsolation` 最后DELETE分区204并GetMemo断言原正文保留；外发停止由partition测试；浏览器：删除合成分区，内容归未分区/任务停止；后续：P0 |
| AC34 | 日历颜色及记录量 | 随数量变化；编辑、分享、AI 和同步副本不增量；导入归入原日期 | 验证中 | 自动化：G originaldates/provenance/Calendar；C full calendar zone/scope/stats；浏览器：B 15:44今日9条与列表一致/旧pin排除；编辑/分享/AI不增量与导入复合操作仍待；后续：P0 |
| AC35 | 日历折叠、关闭颜色与键盘操作 | 主动设置有效；空白中性；非颜色方式可读；输入始终易达 | 验证中 | 自动化：F journal preference/calendar tests；C sidebar states；浏览器：折叠/关颜色/keyboard/非颜色计数/空白中性；后续：P0 |
| AC36 | 恢复旧备份 / 导入到启用同步的实例 | 不复活旧分享或重放外发；已发布映射可核查，规则经明确恢复才启动 | 验证中 | 自动化：G BackupNewInstanceRoundtripAndNoReplay、BackupExistingInstancePauseAndCollision；ImportSuspensionDoesNotRetractOrReplay；P pause_restored_permissions；浏览器：恢复可见sync暂停/旧share无效/外发映射可查；后续：P0；真实隔离恢复无外发（不要用生产接收器） |
| AC37 | 首个社媒目标完整链路 | 所选平台上核实文字、媒体、更新/撤回能力及失败边界；只投递成功不替代发布验证 | 暂缓 | 用户明确暂缓真实社媒平台接入与发布验证。 |
