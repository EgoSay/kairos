# Kairos 本轮需求验收矩阵

目标：完成 #1–#11、#16–#19，并以证据更新总清单 #12。目标截止北京时间 2026-10-11 23:59。

基线：2026-10-10，main `2e931764ddef2df8d2a55ef8cc526794504e4b49`。历史验收来自 `personal-journal-validation.md`，仅用于覆盖范围，不作为当前验证通过证据。

## 范围变更与证据标准

- 用户已授权实施、并行子 Agent、PR/合并、现有 Dokploy 发布及 issue 更新；J15 真实社媒接入继续暂缓。
- 2026-10-11 最新 Goal 将 AI 洞察列为后续继续：AC10–AC14 的真实服务生命周期、AC23 中首次真实 AI 调用暂缓，不作为本轮发布前置，也不记为通过。AC23 的通用权限回归继续执行；现有 AI 自动测试与禁止隐式发送的保护继续保留。
- 2026-10-10 用户指定“真机验收使用本机 ego lite 作为浏览器自动化测试”。本轮以本机实际 ego lite + 移动视口验收；实体手机软键盘/GPS/录音硬件未测，不作为本轮完成前置，也不宣称通过。以下源 issue 中手机条款按此最新指令执行。
- 每项保留场景、预期、实际、环境/时间、提交与证据。未执行、失败、阻塞不能写成通过；功能测试、生产核验与用户体验确认分别记录。
- 敏感生产记录、配置、备份明细留在受控私有证据目录；公开报告仅保留脱敏结果。
- 实现与浏览器/真实服务/发布验收全部满足后再关闭 issue；总清单最后关闭。


## 2026-10-11 发布候选工程证据与剩余门槛

以下137行保留源issue/历史AC的精确条款。AC10–AC14、AC37 为“暂缓”，AC23 的 AI 调用部分暂缓；其它为“验证中”：本节所述场景通过不代表最终发布通过，也未关闭issue或宣称用户本人体验确认。

已推送代码候选为 `d902ac7463bea4f9edc385661b8f311349e78b27`，草稿 [PR #20](https://github.com/EgoSay/kairos/pull/20)，4 个 CI 工作流/14 项检查全部成功。包含 ZIP 文档、菜单弹窗、历史重试以及最后的长文聚焦滚动、短视口元数据、纯文本粘贴修复。此前 `1b8b2c251` 同提交镜像已完成新鲜 S3 快照隔离恢复，最终发布候选恢复证据需另行绑定。此后范围说明更新属于文档变更，新增 `memo-pin-failure.test.tsx` 补齐置顶/取消置顶失败后的状态恢复与重试证据，产品源码未变；完整前端229文件/2069项、lint与构建通过。当前尚未正式上线。

- **G / DB**：Go1.27，完整Go测试、race、tidy和lint通过；SQLite/MySQL/PostgreSQL真实事务、fresh/升级与精确标签派生索引回归通过。最新ZIP修复后API两包race通过，ZIP导入/历史文档在三数据库回归通过。旧1.0.1镜像读取升级数据、新写入再升级的12项演练保留正文/原件。
- **F / FE / E / I / C / T**：Node24.16/pnpm11.0.1，最新工作树lint、**229测试文件/2069项**及前端构建通过；分别覆盖组件、真实CodeMirror、离线队列、日历/搜索、标签。模拟网络/定位/DOM的结果不冒充实际设备行为。测试环境的`scrollTo`未实现警告不当作浏览器滚动证据。
- **P / P-Docker**：105项备份/发布Python回归通过；真实隔离Docker/Compose四场故障演练已完成，涵盖容器缺失、健康失败保留pending、定时/重复恢复与实际新写入阻止覆盖；Dokploy HTTP/systemd采用明确的本机适配，不是生产破坏性演练。
- **B**：本机ego lite、合成账户，证据截至2026-10-11T02:01:03Z。新增真实冲突/刷新/合并、复杂源码与关联往返、组合搜索跨视图、标签键盘与保存视图、详情取消置顶、回顾/漫步/排除、动态分享撤出、纯图片/音频、390px及24px字号格式/非空选区/聚焦子Esc、AI开始前告知均已留证。原生多图剪贴板、离线冷刷、各媒体特殊名/回收恢复、分区保存证据继续有效。
- **B34-corrected**：最初取消置顶/删除分区的直接fetch遗漏Authorization并返回401，旧字段比较无效。17:17Z后用授权HTTP200+精确记录名，并将先前独立ZIP审计SQLite快照与现行DB所有字段/附件/关系逐字节对比重新通过；以下只采用后证据，不沿用错误断言。
- **ZIP**：真实浏览器普通/含历史ZIP在应用外独立核对**138/138**通过；18条合成记录、12附件/原件、10/14可移植文档、0/4版本、正文/日期/关系/原件hash及脱敏字段匹配。此前`documents=[]`静默漏导已修复，并补防空循环的三DB roundtrip断言。历史专用已移除附件的保留由实DB回归补足。
- **P-live / R / R-receipt**：现有S3真实临时读写/hash/删除、配置失败保护、完整试备份和原timer自动调度/监控通过。最新真实定时`cbd5ac53…`快照在无网络隔离容器运行`1.1.0-dev.1b8b2c2513d6`；应用与授权核验均true，707正常/5回收、55原件/54预览、110保留文件、2451负向通过；712行仅派生标签索引变化，归一原始字段hash一致。非空关系由合成ZIP/三DB补证。可信状态回执与页面明确区分备份时版本、实际测试版本及独立副本未知；不是线上新版本已验收。
- **M / M2 / M3 / A / R11**：真实Codex今天/指定日期/两时期完整分页、全文、来源及事实/解读区分通过；source实际导航通过。设置创建同一只读凭据→复制配置/检测→真实Codex读取→UI撤销→再次客户端401已闭环；HTTP/2 Connect/gRPC/gRPC-Web、旧MCP和文件入口权限边界有精确回归。
- **GEO**：用户确认允许后已恢复同一ego空间；浏览器权限实际为`granted`，设备定位回调实际返回code2 `Position update is unavailable`，页面正确显示设备暂不可定位，不将默认地图中心选中或写入。选择已有合成地点可继续，取消不保存。授权等待已解除，不能把设备无坐标误写成权限拒绝，也不宣称硬件GPS成功/精度通过。
- **U-AI（用户暂缓）**：AC09开始前不发送已实际通过；AC10–14及AC23中的真实服务/衍生生命周期由最新 Goal 明确移至后续。现有 mock 回归不冒称真实服务通过；这一分支不再阻塞本轮发布。
- **P0（全部非暂缓行共同待办）**：确认最终候选所需检查有效→合并及main可达→新语义版本标签/版本匹配→上线前新鲜完整可恢复数据库和附件备份/旧digest与回滚路径→现有Dokploy固定digest发布→实际版本/commit/digest、健康/登录、逐对象正文/日期/关系/原件hash/权限/日志/调度核验→逐issue和总清单证据闭环。普通提交/构建不替代发布；现有真实恢复证明绑定其具体测试提交，不能改称未来commit。

**浏览器收尾结果与除共同P0外的剩余边界：**

- **当前位置环境边界**：授权已允许，真实无坐标回调与可恢复提示已验证；当前Ego设备定位源无法返回坐标，定位成功/硬件精度未验证。地名搜索、手动/常用位置主路径与自动定位边界测试继续有效。
- **纯文本粘贴**：当前Ego的带Shift快捷键未派发paste事件，不能记为通过。已提供显式一次性“纯文本粘贴”入口，真实原生Cmd+V已验证富文本剪贴板只取文字、选区替换、撤销及下一次恢复格式；图片-only原生粘贴已实际验证不删选区、不启动上传；URI-only链接另有精确回归，见19-04。
- **编辑器长文滚动**：原真实跳动已定位为flex高度链失效；修复后关联预览返回保持scrollTop=923.5和非空选区，最终树两次聚焦往返均保持454.5及同一非空选区。独立审查发现的多关联短视口裁剪也已修复：390×480/root24/9关联，正文144px，元数据96px独立滚动；外层滚到257后保存按钮395–449px且真实命中。极短视口需滚动到达保存，不冒称始终固定可见。
- **真实AI与衍生生命周期（用户暂缓）**：AC10–14、AC23 中 AI 调用移至后续，届时补服务与模型配置后恢复验收；AC09开始前不发送已通过。

精确数据库/并发/失败/权限排列已有自动化证据，不再自动新增人工gate；实际主路径与自动断言共同构成每行证据。仍缺的动作证据在对应行明列，未执行/待权限不能写成通过。实体手机硬件按已批准范围不作为前置，也不冒称通过。

### 受控证据相对索引

以下文件名均相对仓库根目录 `tmp/kairos-goal-20261010/`，该目录被Git忽略。此文只记录脱敏结果和可定位索引，不公开密钥、私人正文、完整备份或原始数据库。

| 代号 | 相对证据文件/定位 | 适用范围 |
| --- | --- | --- |
| G/DB | `final-candidate-local.json`、`review-final-go-all.log`、`recovery-guard-final-race.log`、`recovery-store-{sqlite,mysql,postgres}-final.log`、`final-zip-api-race.log` | 最终1f65基线及补丁相关测试；具体断言以行内测试名为准 |
| FE/E/I/C/T | `release-final-frontend-tests.log`、`release-final-frontend-lint.log`、`release-final-frontend-build.log`、`editor-followup-independent-review.md`、`offline-inline-review.md`、`search-independent-review.md` | 229/2069及编辑/离线/检索专项红绿；不是最终补丁CI |
| P/P-Docker | `python-final-with-verifier.log`、`real-docker-release-drill.json`、`real-docker-release-drill.md` | 隔离发布恢复、脚本锁/健康/声明/数据保护 |
| B | `browser-evidence.jsonl`行1–59（各行自带UTC时间；下表用B:行号） | ego实际操作；不复制合成正文或身份到公开文档 |
| H | `qa-http-boundaries.json` | 40场景/135请求逐对象边界；按scenario语义采用，早期matrixIds错位不沿用 |
| B1-proof | `b1-largefont-focus-proof.json`、`b1-largefont-focus.png`、`b1-prior-browser-action-proof.md`、`b1-prior-browser-action-proof.json` | 非空选区、源码、字号及原始动作/返回补链；HTML与补全通过，Shift-paste/after-scroll未通过；首次innerText失败保留 |
| B34-corrected | `b34-reverified-data.json`、`b3-unpin-authenticated.json`、`b4-after-delete-partition-authenticated.json` | 取代未授权401响应上的无效比较 |
| D | `menu-dialog-lifecycle-review.md`、`menu-dialog-mounted-after.log`、`menu-dialog-proxy-independent-review.json`、`history-error-retry-handoff.json` | 弹窗卸载/焦点修复、错误与空态区分、重试；已做独立review |
| ZIP/ZIP-DB | `qa-export-fixed-independent-audit/audit-result.json`、`zip-document-export-handoff.json`、`zip-document-export-{green,mysql,postgres}.log` | 实际ZIP外读138项和三数据库导入安全 |
| P-live/R/R-receipt | `backup-live-probe-evidence.jsonl`、`final-1b8-application-result.json`、`final-1b8-restore-postflight.json` | 真实S3、具体版本应用恢复/授权基线、调度/监控与可信回执 |
| M/M2/M3/A/R11 | `codex-mcp-{result,pagination-result,two-period-result,b6-ui-result,b6-revoked-result}.md`、对应events、`r11-independent-review.md` | 真实客户端与协议/凭据权限证据 |
| AI/U-AI | `acceptance-ai-failure-regression.log`、B:54 | 自动失败边界与实际未开始告知；真实服务分支按用户指令暂缓 |
| CI | `editor-final-pr-readiness.json`、`release-preflight-pr.json` | d902的4工作流/14检查；范围文档提交另记，实际发布由main/tag再次检查 |
| GEO | `browser-geolocation-granted.json`、B:55 | 真实granted和设备code2、可恢复状态；无硬件成功坐标 |
| B-new | `browser-longscroll-final.json`、`browser-relation-scroll.json`、`browser-native-plain-paste.json`、`native-plain-image-result.json`、`focus-many-relations-short-{before,after}.json` | 长文/关联滚动、原生纯文本与纯图选区保护、短视口多关联修复前后几何；B:56–59 |

## #1 [P1] 分区切换与正文保存需统一提交，避免按旧分区安排外发

来源：https://github.com/EgoSay/kairos/issues/1

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 01-01 | 同时修改正文与归属时，新正文的投递授权只对应最终选择。 | 验证中 | 自动化：G/DB `TestAtomicPartitionSaveUsesOnlyCommittedDestination`：正文与最终映射同事务；F: journal-atomic-partition-save 同一请求；实际：已实际完成正文与最终分区一起保存、移出失败后保留选择及重试；隔离接收器只收到成功提交后当前授权的两次签名事件。全部使用合成数据，未接入真实社媒。 证据：B:26–29,34–35；共同待办：P0 |
| 01-02 | 退出同步分区时不会为本次修改产生旧目标的投递授权。 | 验证中 | 自动化：G 同上：退出同步目标后旧目标不获授权；partition rechecks 系列；实际：已实际完成正文与最终分区一起保存、移出失败后保留选择及重试；隔离接收器只收到成功提交后当前授权的两次签名事件。全部使用合成数据，未接入真实社媒。 证据：B:26–29,34–35；共同待办：P0 |
| 01-03 | 保存中断、重试和并发修改不会产生跨分区错误授权或重复发送。 | 验证中 | 自动化：G/DB `TestAtomicPartitionSaveRejectsStaleAndUnauthorizedSelection`；`TestPartitionPendingDeliverySurvivesServiceRestart`；`TestMemoRecordCASConcurrentMetadataWriters`；实际：双客户端冲突展示两份完整正文与附件；刷新保留本机草稿，再保存仍冲突，显式比较并合并后只保留正确单条。事务、重试和断响应边界已有精确回归。 证据：B:36–37；H；G/DB；共同待办：P0 |
| 01-04 | 在隔离环境以合成记录验证以上状态转换；不接触真实社媒或私人记录。 | 验证中 | 自动化：G/DB 测试使用合成用户/隔离库；partition 测试本地 HTTP receiver；实际：已实际完成正文与最终分区一起保存、移出失败后保留选择及重试；隔离接收器只收到成功提交后当前授权的两次签名事件。全部使用合成数据，未接入真实社媒。 证据：B:26–29,34–35；共同待办：P0 |

## #2 [P1] 发布回滚应支持目标容器不存在的失败状态

来源：https://github.com/EgoSay/kairos/issues/2

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 02-01 | 容器不存在且数据未变时能够恢复旧服务和备份调度。 | 验证中 | 自动化：P `test_missing_container_restores_old_service_and_backup_schedule`；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 02-02 | 数据已变化时保留新数据，给出明确的人工处理状态。 | 验证中 | 自动化：P `test_missing_container_with_new_writes_preserves_data_and_requires_intervention`；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 02-03 | Docker 不可用等其他错误不会被一概忽略。 | 验证中 | 自动化：P `test_docker_daemon_failure_is_not_treated_as_a_missing_container`；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 02-04 | 服务健康确认、重复回滚和 pending 状态管理有隔离回归覆盖。 | 验证中 | 自动化：P `test_failed_health_verification_keeps_pending_and_never_records_success`、`test_retry_after_interrupted_health_check_restores_consistent_state`；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |

## #3 [P2] 编辑器仅修改分区时应正常保存

来源：https://github.com/EgoSay/kairos/issues/3

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 03-01 | 仅切换分区、移出分区、重新启用暂停分区均持久化成功。 | 验证中 | 自动化：G `TestAtomicPartitionSaveUsesOnlyCommittedDestination`；F: journal-atomic-partition-save、journal-partition-save 显式重启暂停映射；实际：仅分区、正文+分区保存重开均显示真实归属；旧版本恢复后明确暂停，普通编辑不发送；显式重选同分区才发送当前正文，UI行为与签名接收事件一致。 证据：B:26–29,34–35；D；共同待办：P0 |
| 03-02 | 保存后重新打开，显示实际归属及同步状态。 | 验证中 | 自动化：F: journal-partition-picker suspended/selected metadata；服务端原子结果 G；实际：仅分区、正文+分区保存重开均显示真实归属；旧版本恢复后明确暂停，普通编辑不发送；显式重选同分区才发送当前正文，UI行为与签名接收事件一致。 证据：B:26–29,34–35；D；共同待办：P0 |
| 03-03 | 分区保存失败不提示成功或静默丢弃选择；重试行为明确。 | 验证中 | 自动化：F: journal-atomic-partition-save `keeps the draft selection on failure and retries the same atomic request`；实际：真实无修改提示、断网保存失败保留编辑器和分区选择、恢复网络重试成功均已验证；相应前端回归已纳入229文件/2069项全套。 证据：B:28–29；FE；共同待办：P0 |
| 03-04 | 确实没有任何修改时仍维持原有无修改提示。 | 验证中 | 自动化：F 同文件 `keeps the no-change result for an unchanged selection`；实际：真实无修改提示、断网保存失败保留编辑器和分区选择、恢复网络重试成功均已验证；相应前端回归已纳入229文件/2069项全套。 证据：B:28–29；FE；共同待办：P0 |
| 03-05 | 上述场景纳入前端回归测试。 | 验证中 | 自动化：分区原子保存/失败重试/暂停显式重启前端回归；实际：真实无修改提示、断网保存失败保留编辑器和分区选择、恢复网络重试成功均已验证；相应前端回归已纳入229文件/2069项全套。 证据：B:28–29；FE；共同待办：P0 |

## #4 [P2] 定时回滚完成后，流水线仍需恢复生产部署声明

来源：https://github.com/EgoSay/kairos/issues/4

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 04-01 | 定时保护先完成、流水线后处理时，最终恢复对应旧版本声明。 | 验证中 | 自动化：P `test_watchdog_then_matching_ci_request_does_not_restore_twice`；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 04-02 | 流水线先完成、请求重复或中断重试时，结果一致且无多余回退。 | 验证中 | 自动化：P `test_ci_then_watchdog_and_repeated_ci_leave_the_completed_release_unchanged`、lost response Dokploy 测试；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 04-03 | 回执缺失、属于其他发布或回滚被新写入阻止时，不盲目回退声明。 | 验证中 | 自动化：P missing/other/stale receipt、new writes 与 wrong image/template 测试；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |
| 04-04 | 隔离回归覆盖服务器状态与生产声明的一致性及发布标识校验。 | 验证中 | 自动化：P `test_safe_rollback_restores_declaration_checks_old_image_and_resumes_backups`；Compose 实解析；实际：真实隔离 Docker/Compose 四场演练已完成：目标容器缺失、健康失败保留pending、watchdog/重复恢复、新写入阻止覆盖；旧digest与声明对应。Docker其他错误/丢回执等精确边界由脚本测试覆盖；没有在生产制造故障。 证据：P-Docker；P；共同待办：P0 |

## #5 [R02] 优化搜索：关键词、可视化筛选与未添加标签快捷入口

来源：https://github.com/EgoSay/kairos/issues/5

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 05-01 | 无需表达式即可查出“去年、未添加标签、带图片”的记录。 | 验证中 | 自动化：G/DB `TestMemoSearchFacetsAndPinnedPagination`；F: memo-search + QuickFind 组合 facets；实际：日期控件组合去年+未标签+图片，正确旧月份日历/日期面板与地图均匹配同条记录并保留条件；补嵌套标签后退出未标签。完整结果计数/分页由HTTP与三DB逐对象回归覆盖。 证据：B:40；H；G/DB；共同待办：P0 |
| 05-02 | 未标签筛选覆盖空数组/历史缺失字段，已打标签记录不会误入；补标签后及时退出结果。 | 验证中 | 自动化：DB 缺失/null/空 tags fixture；T 标签计数错误状态；实际：日期控件组合去年+未标签+图片，正确旧月份日历/日期面板与地图均匹配同条记录并保留条件；补嵌套标签后退出未标签。完整结果计数/分页由HTTP与三DB逐对象回归覆盖。 证据：B:40；H；G/DB；共同待办：P0 |
| 05-03 | 包含、排除、任一/全部、日期边界及当前范围与全部范围行为明确且一致。 | 验证中 | 自动化：F: memo-search/quick-find-navigation/memo-views；C 时区边界；实际：标签树与QuickFind、当前范围/全部本人范围、中文关键词、高级表达式和已保存视图往返已验证；空结果与范围可辨。特殊字面量、IME不误提交、失败重试和晚响应由已执行组件/HTTP测试覆盖，不新增逐排列手工gate。 证据：B:41；H；FE；共同待办：P0 |
| 05-04 | 分页与计数基于完整结果，不只过滤已加载的一页；三种视图保留同一筛选范围。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle`；DB 分页；C 三视图范围/时区；F map-memos 全页失败；实际：日期控件组合去年+未标签+图片，正确旧月份日历/日期面板与地图均匹配同条记录并保留条件；补嵌套标签后退出未标签。完整结果计数/分页由HTTP与三DB逐对象回归覆盖。 证据：B:40；H；G/DB；共同待办：P0 |
| 05-05 | 搜索关键词含引号、中文、空格等普通字符时正常工作；中文输入法确认不意外提交。 | 验证中 | 自动化：DB 中文及特殊字符；F memo-search literal；QuickFind中文composition提交边界回归；实际：标签树与QuickFind、当前范围/全部本人范围、中文关键词、高级表达式和已保存视图往返已验证；空结果与范围可辨。特殊字面量、IME不误提交、失败重试和晚响应由已执行组件/HTTP测试覆盖，不新增逐排列手工gate。 证据：B:41；H；FE；共同待办：P0 |
| 05-06 | 返回记录列表保留上下文；空态、失败重试、键盘及手机操作可用。 | 验证中 | 自动化：T 错误与重试；C 路由范围；F quick-find-navigation；实际：标签树与QuickFind、当前范围/全部本人范围、中文关键词、高级表达式和已保存视图往返已验证；空结果与范围可辨。特殊字面量、IME不误提交、失败重试和晚响应由已执行组件/HTTP测试覆盖，不新增逐排列手工gate。 证据：B:41；H；FE；共同待办：P0 |
| 05-07 | 原有高级表达式与已保存视图仍可使用。 | 验证中 | 自动化：C/F memo-views saved view；QuickFind 保留 CEL 草稿；实际：标签树与QuickFind、当前范围/全部本人范围、中文关键词、高级表达式和已保存视图往返已验证；空结果与范围可辨。特殊字面量、IME不误提交、失败重试和晚响应由已执行组件/HTTP测试覆盖，不新增逐排列手工gate。 证据：B:41；H；FE；共同待办：P0 |

## #6 [R03] 优化图片粘贴：直接插入、上传反馈与失败恢复

来源：https://github.com/EgoSay/kairos/issues/6

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 06-01 | 截图、复制本地图片以及浏览器提供的图片剪贴板数据可一次粘贴添加，无需额外点击上传。 | 验证中 | 自动化：E Editor paste+inline/file 分流；系统 clipboard 未由 jsdom 证明；实际：原生PNG及macOS双文件剪贴板直接粘贴并实际保存；手动添加与能力不足反馈有组件回归。系统剪贴板与模拟paste测试分开记录。 证据：B:6,20；E；共同待办：P0 |
| 06-02 | 多张、连续及文字图片混合粘贴不丢内容，位置和顺序正确。 | 验证中 | 自动化：E mixed HTML/local-vs-remote image 顺序；I pending anchor 映射；实际：真实原生单图/双文件图片及图文顺序已证；原始工具动作确认keyboard.paste的HTML strong/list/link转成Markdown，继续编辑的含图复杂正文仍保留。local/remote图片对应、混合顺序及并发锚点由CM/队列精确回归覆盖；纯文本入口已实际验证，详见19-04。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 06-03 | 上传中可继续输入，失败重试后图片只插入一次。 | 验证中 | 自动化：E/I 锚点、partial retry stable IDs、失败不重传完成部分；实际：断网冷刷新后图文草稿与Blob恢复，前插文字后锚点正确，联网续传最终只生成一条记录/同一个附件，原件hash一致。丢响应、稳定ID及失败重试不重复上传有精确持久队列/CM回归，不另手工制造全部故障排列。 证据：B:12–14,20；E/I；H；共同待办：P0 |
| 06-04 | 断网、刷新、重新打开编辑器后正文和本地图片仍可恢复，状态不误报服务器保存成功。 | 验证中 | 自动化：I 图文离线位置/重启恢复；E owner isolation；B-text 仅文字局部；实际：断网冷刷新后图文草稿与Blob恢复，前插文字后锚点正确，联网续传最终只生成一条记录/同一个附件，原件hash一致。丢响应、稳定ID及失败重试不重复上传有精确持久队列/CM回归，不另手工制造全部故障排列。 证据：B:12–14,20；E/I；H；共同待办：P0 |
| 06-05 | 保存后记录正文与附件库引用一致，能够预览及下载原件。 | 验证中 | 自动化：I resolve inline+attachment same object；G attachment APIs；实际：断网冷刷新后图文草稿与Blob恢复，前插文字后锚点正确，联网续传最终只生成一条记录/同一个附件，原件hash一致。丢响应、稳定ID及失败重试不重复上传有精确持久队列/CM回归，不另手工制造全部故障排列。 证据：B:12–14,20；E/I；H；共同待办：P0 |
| 06-06 | 主用桌面浏览器和手机实际验证支持路径；不支持时提供可理解的反馈和手动添加入口。 | 验证中 | 自动化：E insert-menu 手动添加/failure UI；模拟能力有限；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |

## #7 [R04] 优化位置添加：快捷入口、常用地点与定位纠错

来源：https://github.com/EgoSay/kairos/issues/7

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 07-01 | 在真实主用设备定位，区分地图显示偏移、设备精度不足和名称错误，并记录实际修复依据。 | 验证中 | 自动化：G provider/geocoding、地点坐标校验；F editor-location 低精度/晚响应；实际：真实地名搜索、常用/最近重开、手选保存和默认地图中心禁存已通过；用户允许后权限granted，实际定位回调code2无坐标，页面设备不可用提示正确且选择旧地点可恢复、取消不保存。未取得硬件坐标/精度证据；低精度/超时/晚响应等模拟边界与真实环境证据分开。 证据：B:9,15；GEO；E；共同待办：P0 |
| 07-02 | 快捷选择当前位置、已有常用位置和地图选点可用；地点搜索结果可预览确认。 | 验证中 | 自动化：G/FE：位置owner/CAS，search/selected map/保存；recent-location reopen新红绿在 location-reopen-after.log；实际：真实地名搜索、常用/最近重开、手选保存和默认地图中心禁存已通过；用户允许后权限granted，实际定位回调code2无坐标，页面设备不可用提示正确且选择旧地点可恢复、取消不保存。未取得硬件坐标/精度证据；低精度/超时/晚响应等模拟边界与真实环境证据分开。 证据：B:9,15；GEO；E；共同待办：P0 |
| 07-03 | 拒绝权限、超时、网络失败均有可恢复状态，不把默认地图中心保存为真实位置。 | 验证中 | 自动化：F editor-location denied/timeout/unavailable，location-dialog 默认中心不选中；实际：真实地名搜索、常用/最近重开、手选保存和默认地图中心禁存已通过；用户允许后权限granted，实际定位回调code2无坐标，页面设备不可用提示正确且选择旧地点可恢复、取消不保存。未取得硬件坐标/精度证据；低精度/超时/晚响应等模拟边界与真实环境证据分开。 证据：B:9,15；GEO；E；共同待办：P0 |
| 07-04 | 已手选位置或手填名称不会被旧异步响应覆盖；取消及重开不丢原值。 | 验证中 | 自动化：F editor-location late result/name/manual/cancel/reopen；实际：位置自动化精确覆盖手选/改名不被晚响应覆盖、取消重开保留值、反解失败仍可保存已确认坐标；实际手选、常用重开和既有地点保存亦通过，无需逐个手工伪造异步时序。 证据：B:9,15,38,52；E；共同待办：P0 |
| 07-05 | 地名解析不可用时，已确认坐标仍可保存。 | 验证中 | 自动化：F editor-location `allows saving verified coordinates when name lookup fails`；实际：位置自动化精确覆盖手选/改名不被晚响应覆盖、取消重开保留值、反解失败仍可保存已确认坐标；实际手选、常用重开和既有地点保存亦通过，无需逐个手工伪造异步时序。 证据：B:9,15,38,52；E；共同待办：P0 |
| 07-06 | 已有记录不会在编辑或打开页面时被自动改成当前位置。 | 验证中 | 自动化：F editor-location `preserves the original on open/cancel and never automatically locates...`；实际：复杂旧记录source/visual/focus往返后正文逐字节相等，位置/附件/原日期/关系未改变；保存重开成功，无自动定位或意外清理草稿。 证据：B:38,52；E/I；共同待办：P0 |
| 07-07 | 手机软键盘、点选和窄屏布局可用；不承诺设备无法提供的绝对 GPS 精度。 | 验证中 | 自动化：F layout不能证明实际视口；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |

## #8 [R05] 将聚焦模式设为编辑器直接可见入口

来源：https://github.com/EgoSay/kairos/issues/8

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 08-01 | 无需展开更多菜单即可进入和退出聚焦模式，入口支持键盘与触控。 | 验证中 | 自动化：E/insert-menu direct focus 及 host frame 测试；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |
| 08-02 | 多次切换后正文、光标、附件、位置、关联及未完成上传保持一致。 | 验证中 | 自动化：E memo-editor-paste-files same editor/pending image source/focus；focus viewport；实际：实际关联搜索预览后继续写作、正反向导航及复杂源码/元数据往返已过；原始动作核对child Esc后光标anchor/焦点保持，390px/24px后续证据补齐非空选区一致。raw cm-line的408字节与已保存后端基线匹配；该次无修改保存不冒称新增正文写入。后续真实长文进入/退出聚焦及关联预览返回scrollTop均923.5、非空选区一致；最终树长文两轮切换454.5与非空选区一致；多关联短视口已保留144px正文及可滚达保存，见B-new。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 08-03 | 切换不会意外提交、取消编辑或清理草稿。 | 验证中 | 自动化：E 同上无 editor remount；草稿恢复回归；实际：复杂旧记录source/visual/focus往返后正文逐字节相等，位置/附件/原日期/关系未改变；保存重开成功，无自动定位或意外清理草稿。 证据：B:38,52；E/I；共同待办：P0 |
| 08-04 | 关闭子对话框和退出聚焦的 Esc/焦点行为清楚且一致。 | 验证中 | 自动化：E `gives dialogs priority on Escape`；preview-image-dialog Esc hierarchy；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |
| 08-05 | 桌面、手机软键盘及大字号情况下核心动作可见可用。 | 验证中 | 自动化：E visual viewport frame 测试；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |
| 08-06 | 保存按钮继续正确展示普通保存或保存并同步的真实行为。 | 验证中 | 自动化：F journal-partition-picker enabled/suspended target labels；实际：仅分区、正文+分区保存重开均显示真实归属；旧版本恢复后明确暂停，普通编辑不发送；显式重选同分区才发送当前正文，UI行为与签名接收事件一致。 证据：B:26–29,34–35；D；共同待办：P0 |

## #9 [R06] 优化写作时关联已有记录：快捷搜索、预览与双向回看

来源：https://github.com/EgoSay/kairos/issues/9

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 09-01 | 从当前编辑器可快速找到、预览并关联旧记录，关闭选择器后继续原位置写作。 | 验证中 | 自动化：F link-memo-search delayed open；relation preview；E focus continuity；实际：实际关联搜索预览后继续写作、正反向导航及复杂源码/元数据往返已过；原始动作核对child Esc后光标anchor/焦点保持，390px/24px后续证据补齐非空选区一致。raw cm-line的408字节与已保存后端基线匹配；该次无修改保存不冒称新增正文写入。后续真实长文进入/退出聚焦及关联预览返回scrollTop均923.5、非空选区一致；最终树长文两轮切换454.5与非空选区一致；多关联短视口已保留144px正文及可滚达保存，见B-new。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 09-02 | 关键词搜索、后续页、空态和失败重试可用；特殊字符不导致查询失效。 | 验证中 | 自动化：F link-memo-search 后页失败/重试/晚响应；literal quoting 共用搜索；实际：搜索后页错误重试、特殊字符、晚响应、自关联/重复、失效目标和移除不丢正文均有精确组件/API/DB断言；实际搜索预览、保存与反向回看已通过，不新增每个错误的人工排列。 证据：B:5,39；H；G/DB；FE；共同待办：P0 |
| 09-03 | 保存后正向及反向关系一致，刷新仍可回看。 | 验证中 | 自动化：G `TestMemoRelationsHideTrashedEndpointsAndRestoreBidirectionally`；DB 事务；实际：真实保存关联后从来源跳到目标，再经反向入口返回同一来源；服务端刷新、回收与恢复双向一致由隔离HTTP/DB回归补足。 证据：B:39；H；G/DB；共同待办：P0 |
| 09-04 | 自关联、重复添加、移除关联及目标删除行为明确，不误删正文。 | 验证中 | 自动化：G `TestMemoSaveSkipsUnavailableReferencesWithoutLosingBody`；DB 并发 target 删除；F relation warns；实际：搜索后页错误重试、特殊字符、晚响应、自关联/重复、失效目标和移除不丢正文均有精确组件/API/DB断言；实际搜索预览、保存与反向回看已通过，不新增每个错误的人工排列。 证据：B:5,39；H；G/DB；FE；共同待办：P0 |
| 09-05 | 阅读关联记录并返回时草稿、光标和滚动位置保留。 | 验证中 | 自动化：E editor retained；F direct dialog focus pointer；实际：实际关联搜索预览后继续写作、正反向导航及复杂源码/元数据往返已过；原始动作核对child Esc后光标anchor/焦点保持，390px/24px后续证据补齐非空选区一致。raw cm-line的408字节与已保存后端基线匹配；该次无修改保存不冒称新增正文写入。后续真实长文进入/退出聚焦及关联预览返回scrollTop均923.5、非空选区一致；最终树长文两轮切换454.5与非空选区一致；多关联短视口已保留144px正文及可滚达保存，见B-new。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 09-06 | 键盘选择和手机操作可用，快速输入不会使用过期结果。 | 验证中 | 自动化：F link-memo-search `hides previous candidates...ignores late results`；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |
| 09-07 | 关系可随现有导出/恢复流程保留，权限与回收站语义一致。 | 验证中 | 自动化：G `TestJournalBackupNewInstanceRoundtripAndNoReplay` relation remap + R06 trash/restore；实际：浏览器下载普通/含历史ZIP，应用外独立对fresh SQLite快照核对138/138通过：18记录、12附件/原件、10/14可移植文档、0/4版本，正文/日期/关系/原件hash及脱敏字段一致。三DB导入回归证明组织关系保留且不重放。 证据：ZIP；ZIP-DB；共同待办：P0 |

## #10 [R07] 修复附件预览并让附件随记录进入和恢复回收站

来源：https://github.com/EgoSay/kairos/issues/10

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 10-01 | 先使用真实故障类型或等价合成样本复现，修复后同一路径可正常预览，并记录根因。 | 验证中 | 自动化：E preview-image-dialog load error；G special filename/trash reproducer；实际：图片解码、音频/视频播放、文档明确降级及原件读取通过，覆盖中文/空格/特殊符号文件名；视频播放时间前进和实际下载hash已记录。故障根因、红绿回归及授权范围见附件审查证据。 证据：B:8,21–25；G；E；共同待办：P0 |
| 10-02 | 图片、音频、视频及文档按支持能力正常预览或明确降级；中文、空格、#、? 等文件名不破坏访问。 | 验证中 | 自动化：G fileserver originals/Range/thumb/motion；F attachment-urls/media-loading；实际：图片解码、音频/视频播放、文档明确降级及原件读取通过，覆盖中文/空格/特殊符号文件名；视频播放时间前进和实际下载hash已记录。故障根因、红绿回归及授权范围见附件审查证据。 证据：B:8,21–25；G；E；共同待办：P0 |
| 10-03 | 删除记录后附件退出默认列表及计数，回收站可找到对应对象；正常归档附件保持原有可见性。 | 验证中 | 自动化：G `TestAttachmentLibraryTrashLifecycleAndPagination`；DB before pagination；实际：真实附件回收列表/类型过滤/计数和恢复后缓存刷新通过；正常归档与trash区分、过滤先于分页、全量计数、批量/失败重试由DB/组件精确回归覆盖，不要求手工逐页复造。 证据：B:8,22–23；H；G/DB；FE；共同待办：P0 |
| 10-04 | 恢复记录后原件、缩略图、播放和来源跳转恢复，旧分享不会被自动恢复。 | 验证中 | 自动化：G `TestTrashAttachmentExplicitOwnerPreviewAndSpecialFilename`、TrashRestoresPrivately；old share revoked；实际：回收预览/恢复原件、音视频、来源与旧分享撤回主路径通过；恢复PRIVATE，旧分享重新请求不再含被撤回记录。错误提取码拒绝/正确码读取已证；过期/轮换/媒体直链及期限/清理由隔离负向回归覆盖，未删除真实资料。 证据：B:21–25,30,34–35；R；G；共同待办：P0 |
| 10-05 | 30 天保留、永久清理、有效引用及历史版本引用得到一致处理。 | 验证中 | 自动化：G `TestPurgeRevisionRetainsOriginalReferencedElsewhere`、30天过期；P历史原件snapshot；实际：30天保留、永久清理、共享有效引用和历史版本原件保留有隔离数据库/API断言；含历史真实ZIP核对版本媒体与原件hash，history-only已移除附件由三DB回归补足。 证据：G/DB；ZIP；ZIP-DB；共同待办：P0 |
| 10-06 | 全量计数与分页一致；批量删除、恢复及网络重试后不留下过期界面状态。 | 验证中 | 自动化：G/DB library分页；F attachment-library-stats drains all pages；实际：真实附件回收列表/类型过滤/计数和恢复后缓存刷新通过；正常归档与trash区分、过滤先于分页、全量计数、批量/失败重试由DB/组件精确回归覆盖，不要求手工逐页复造。 证据：B:8,22–23；H；G/DB；FE；共同待办：P0 |
| 10-07 | 桌面和手机预览、关闭、缩放或播放均可操作；不可预览时提供错误信息与可用的原件下载。 | 验证中 | 自动化：E preview dialog zoom/wheel/Esc/mobile arrows、media fallback；实际：空正文纯图片及纯音频均能保存；390px/24px下图片100→120→100缩放、键盘下载/Esc通过，下载hash一致；音频实际播放至末尾且原件字节核对。未声称实际麦克风录制。 证据：B:50–51；E；共同待办：P0 |
| 10-08 | 现有已删除记录纳入新规则，不要求用户重新删除一次。 | 验证中 | 自动化：DB `TestAttachmentLifecycleFiltersBeforePagination` 老trash文档fixture；G无需重写逻辑；实际：历史墓碑fixture无需重复删除的DB回归通过；真实S3隔离恢复中5条既有trash和3个trash附件按权限排除，无需触碰生产历史资料再次删除。 证据：G/DB；R；共同待办：P0 |

## #11 [R08] 数据库与附件定时备份到 S3：配置检测、独立状态页与恢复验证

来源：https://github.com/EgoSay/kairos/issues/11

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 11-01 | 可配置至少一个实际 S3 兼容目的地，检测真实读写；错误凭据、无权限、无效目标和网络失败提示可操作。 | 验证中 | 自动化：P/G + P-live：真实错误候选不改原配置；真S3临时对象读写/hash/删除及restic访问通过；实际：现有S3真实临时对象读写/hash/删除、错误候选不改变原有效配置、完整试备份，以及浏览器检测→试备份→启用同目的地通过；网络/权限错误精确回归补足。 证据：P-live；B:11；P；共同待办：P0 |
| 11-02 | 数据库和附件定时备份实际完成，远端快照、保护时间点及本地成功回执一致。 | 验证中 | 自动化：P partial/receipt/upload断言；P-base真实旧备份恢复；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |
| 11-03 | 修改配置失败不破坏现有有效备份；暂停、启用、手动执行与自动调度不重复运行。 | 验证中 | 自动化：P connection/activation failure rollback；overlap locks；paused schedule preserved；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |
| 11-04 | 未完成或部分备份不能标成功；存在 S3 源附件或外链缺口时覆盖范围清楚。 | 验证中 | 自动化：P snapshot managedS3/外链/missing original/partial restic tests；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |
| 11-05 | 独立状态页准确展示各阶段、各目标和历史；失败、超时及回执过期不会显示正常。 | 验证中 | 自动化：P status redact/stale/latestfailure；F cloud-backup stale fetched success；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |
| 11-06 | 浏览器待同步草稿不被算作服务器已备份内容；独立副本的延迟单独展示。 | 验证中 | 自动化：F cloud-backup；代码文案不足以证明本地pending排除；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |
| 11-07 | 从明确快照进行隔离恢复，核对正文、关系、日期、附件原件与应用可用性。 | 验证中 | 自动化：P安全恢复/权限/源字段hash回归；G/DB完整导入与不重放；实际：真实0038d722快照在network-none隔离容器运行1f65候选，applicationVerified与authorizationVerified均true：707正常/5回收、55原件/54预览、110保留文件、2451负向；712行仅派生索引变化，归一原字段hash相同。非空关系由合成ZIP和三DBroundtrip补足；不覆盖线上数据，旧会话/分享撤销且外发暂停。 证据：R；R-receipt；ZIP-DB；B:31；共同待办：P0 |
| 11-08 | 恢复不意外激活旧分享、外部投递或重复历史记录；不覆盖正在写入的数据。 | 验证中 | 自动化：P安全恢复/权限/源字段hash回归；G/DB完整导入与不重放；实际：真实0038d722快照在network-none隔离容器运行1f65候选，applicationVerified与authorizationVerified均true：707正常/5回收、55原件/54预览、110保留文件、2451负向；712行仅派生索引变化，归一原字段hash相同。非空关系由合成ZIP和三DBroundtrip补足；不覆盖线上数据，旧会话/分享撤销且外发暂停。 证据：R；R-receipt；ZIP-DB；B:31；共同待办：P0 |
| 11-09 | 页面关闭不影响服务器定时备份；实际调度执行和独立监控有证据。 | 验证中 | 自动化：P independent report failure；P-agent unit/timer active局部；实际：原timer持续产生完整远端快照并有独立监控投递回执；状态页断网显未知、重连显示对应快照/保护时间/历史，2份本机草稿明确排除，独立副本状态与延迟均诚实显示未知。配置失败/部分备份/并发锁/启停调度边界由已执行回归覆盖。 证据：B:31；R-receipt；P；共同待办：P0 |

## #16 [R09] 完善嵌套标签：树形展示、折叠与父子级筛选

来源：https://github.com/EgoSay/kairos/issues/16

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 16-01 | 收起“人生修行”后子级隐藏；展开可访问多层分支，刷新后展开状态保留。 | 验证中 | 自动化：T/F tag-tree remount scope expansion；实际：真实标签展开/折叠不误导航、键盘独立展开、父4条/子3条及QuickFind同范围通过，刷新展开状态保持；树层级/窄屏入口/名称和箭头独立性有mounted组件回归。 证据：B:4,41；H；FE；共同待办：P0 |
| 16-02 | 点击父级可完整找回自身与后代记录，点击子级只缩小到该分支；结构性父级同样可筛选。 | 验证中 | 自动化：DB full path segment；G父count不重复；T结构父可点击；实际：真实标签展开/折叠不误导航、键盘独立展开、父4条/子3条及QuickFind同范围通过，刷新展开状态保持；树层级/窄屏入口/名称和箭头独立性有mounted组件回归。 证据：B:4,41；H；FE；共同待办：P0 |
| 16-03 | 箭头展开与名称筛选相互独立，手机不依赖鼠标悬停才能找到展开入口。 | 验证中 | 自动化：T label independent disclosure；实际：真实标签展开/折叠不误导航、键盘独立展开、父4条/子3条及QuickFind同范围通过，刷新展开状态保持；树层级/窄屏入口/名称和箭头独立性有mounted组件回归。 证据：B:4,41；H；FE；共同待办：P0 |
| 16-04 | 同一条记录带多个子标签时，父级计数与结果列表均不重复；分页覆盖完整结果，不只处理当前已加载的一页。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle`；DB分页；实际：多子标签单记录父计数去重、完整分页、相似前缀和不同父同叶均由逐对象HTTP/三DB测试核验；真实父子树与搜索结果对应，不重新手工遍历所有页。 证据：H；G/DB；B:4,41；共同待办：P0 |
| 16-05 | 相似前缀、不同父级下同名子标签不会混入结果；父级上下文清楚。 | 验证中 | 自动化：DB prefix边界fixture；F memo-search path；实际：多子标签单记录父计数去重、完整分页、相似前缀和不同父同叶均由逐对象HTTP/三DB测试核验；真实父子树与搜索结果对应，不重新手工遍历所有页。 证据：H；G/DB；B:4,41；共同待办：P0 |
| 16-06 | 编辑器能搜索、补全并保存完整嵌套路径；既有路径与平级标签均正常保留。 | 验证中 | 自动化：FE editor-tag-autocomplete/tag-grammar/tag-unicode-parity + E旧Markdown/标签roundtrip；实际：原始动作确认输入标签前缀、候选展示、ArrowDown→Enter选中完整嵌套路径，并通过源码断言；随后已保存内容的源码/可视化/聚焦往返仍保留完整路径。既有路径、平级标签和中文语法由精确编辑器回归补足。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 16-07 | 侧栏与 R02 搜索结果一致，键盘与手机操作完成实际验证。 | 验证中 | 自动化：C/T 查询范围/标签交互已测；实际：真实标签展开/折叠不误导航、键盘独立展开、父4条/子3条及QuickFind同范围通过，刷新展开状态保持；树层级/窄屏入口/名称和箭头独立性有mounted组件回归。 证据：B:4,41；H；FE；共同待办：P0 |

## #17 [R10] 完善记录置顶：统一入口、首页展示与状态规则

来源：https://github.com/EgoSay/kairos/issues/17

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 17-01 | 卡片与详情页均能置顶/取消置顶，桌面与手机入口可发现，成功和失败反馈明确。 | 验证中 | 自动化：F journal-memo-media/action menu、memo-pin-failure 四组合真实 hooks 验证错误反馈/缓存完整回滚/重试；G owner权限；实际：卡片旧记录置顶与刷新已过；详情取消后UI与另一客户端读取一致，授权HTTP200+exactName及独立预存SQLite快照复核原日期/正文/payload/visibility不变。早先缺Authorization的401字段比较无效，采用后续更正证据。 证据：B:3,42,49；B34-corrected；H；共同待办：P0 |
| 17-02 | 一年前的正常记录置顶后可在个人首页编辑区下方找到，并有置顶标记。 | 验证中 | 自动化：DB pinned old createdTs在查询头部；G时间不变；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |
| 17-03 | 多条置顶按记录时间倒序；跨分页不重复、不遗漏，不把仅当前页的数据当作全部置顶。 | 验证中 | 自动化：DB `TestMemoSearchFacetsAndPinnedPagination` oldpin顺序及分页；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |
| 17-04 | 刷新、重新登录和换设备后状态一致；取消后回到正常时间位置。 | 验证中 | 自动化：G服务端pin持久化；F cache mutation仅局部；实际：卡片旧记录置顶与刷新已过；详情取消后UI与另一客户端读取一致，授权HTTP200+exactName及独立预存SQLite快照复核原日期/正文/payload/visibility不变。早先缺Authorization的401字段比较无效，采用后续更正证据。 证据：B:3,42,49；B34-corrected；H；共同待办：P0 |
| 17-05 | 原始记录日期未改变，日历和某日回看的时间顺序保持正确。 | 验证中 | 自动化：G `TestJournalSearchScopeCountsAndPinLifecycle` create/update timestamp unchanged；C时区；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |
| 17-06 | 带关键词、标签、日期条件时，不出现无关置顶记录。 | 验证中 | 自动化：DB查询先filter后pin排序；F memo views composition；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |
| 17-07 | 归档/移入回收站立即退出首页置顶区，恢复后原置顶状态仍在。 | 验证中 | 自动化：G state恢复保留pin+trash排除；未组合真UI；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |
| 17-08 | 操作遵守本人记录权限，失败不会留下与服务器状态不一致的置顶展示。 | 验证中 | 自动化：G另一用户PermissionDenied；F memo-pin-failure 真实 useMemoPin/useUpdateMemo 挂载：延迟拒绝后详情/列表/无限列表/地图缓存完整恢复，只报error，明确重试成功；实际：旧记录置顶、日期筛选不被绕过及刷新持久化已证；排序/跨页不重复、归档/trash退出和恢复保留、其他用户拒绝及失败UI不伪成功由精确API/三DB/组件回归覆盖。原日期以授权复核为准。 证据：B:3–4,10,42,49；B34-corrected；H；G/DB；共同待办：P0 |

## #18 [R11] 完善 MCP 接入：只读授权、日期检索与可追溯回顾

来源：https://github.com/EgoSay/kairos/issues/18

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 18-01 | 从设置创建 Agent 专用只读凭证、复制配置并连接 Codex，完成一次真实读取；界面检测结果与实际连接一致。 | 验证中 | 自动化：A只读授权；M真实Codex已连接读取；F agent-access/config test；实际：设置创建7日命名只读凭据，实际复制配置、页面检测、同凭据Codex三次读取成功；UI撤销后真实客户端读取401。另一个凭据仍独立，过期/last-use/撤销边界有服务端和组件回归。 证据：B:32–33；M3；A/R11；共同待办：P0 |
| 18-02 | “今天”及指定日期查询遵守 Kairos 时区，跨午夜边界和历史导入日期正确，结果与产品内同范围一致。 | 验证中 | 自动化：A `TestAgentFilterUsesLocalOriginalDatesAndCalendarDST` + query test；M today/history；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-03 | 日期范围、关键词、父子标签、分区、置顶条件可组合；单条完整记录及其原文链接可用。 | 验证中 | 自动化：A `TestAgentQueryOwnArchiveTrashPagingAndOriginalDate`组合+全文；M单条返回source；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-04 | 正常与归档记录按约定纳入，回收站内容默认排除，权限边界不因 MCP 接入而扩大。 | 验证中 | 自动化：A owner/archive/trash/comment与fileserver边界；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-05 | 大结果集可连续分页；未读完明确标识；无结果、请求失败、部分结果可区分。 | 验证中 | 自动化：M 4页/2页明确覆盖；A tampered/query/owner cursor、partial label；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-06 | 只读凭证的写入尝试被服务端拒绝，不能通过其他接受该凭证的接口绕过限制。 | 验证中 | 自动化：A真Connect/gRPC/gRPC-Web/旧MCP写拒绝、fileserver专用prefix全拒绝；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-07 | 不同 Agent 凭证可独立撤销；过期/撤销立即按既定授权规则生效，最近使用时间可查看。 | 验证中 | 自动化：A expiry/revoke/lastUse/independent credential；F agent-access；实际：设置创建7日命名只读凭据，实际复制配置、页面检测、同凭据Codex三次读取成功；UI撤销后真实客户端读取401。另一个凭据仍独立，过期/last-use/撤销边界有服务端和组件回归。 证据：B:32–33；M3；A/R11；共同待办：P0 |
| 18-08 | 实际演示“今日回顾”和“两段时间对比”：Agent 可引用原文并回到记录，说明读取范围、区分事实与解读。 | 验证中 | 自动化：M2真Codex两时期+今日观察、8次读调用/全页、原文引用、事实/推测与合成边界均已留证；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |
| 18-09 | 未修改既有正文、时间、标签或附件；用户数据不因接入被改成公开。 | 验证中 | 自动化：A write-denial count unchanged；metadata只读；实际：Codex今天/历史/两期全页、全文、范围与来源回溯通过，产品source链接实际打开；HTTP逐对象查询及读取前后完整响应核对、时区/分页/只读跨协议/回收隔离/文件入口拒绝有实证。只读正文不含原始文件下载，未改变记录可见性。 证据：M/M2/M3；B:18；H；A/R11；共同待办：P0 |

## #19 [R12] 优化编辑体验：Markdown 即时渲染与可视化格式编辑

来源：https://github.com/EgoSay/kairos/issues/19

| ID | 验收条件 | 状态 | 证据 / 环境 / 提交 |
| --- | --- | --- | --- |
| 19-01 | 不懂 Markdown 的用户可用直接可见的按钮写出包含标题、加粗、列表等首期格式的记录。 | 验证中 | 自动化：E editor-formatting full command tests；insert-menu直接入口；实际：真实格式操作/撤销重做、Chromium中文composition、source/visual/focus及大字号非空选区已验证，保存复杂Markdown原文和附件/位置/关系一致。首期全格式、代码字面量与标题/嵌套标签边界由真实CM测试覆盖，不额外人工穷举语法。 证据：B:16,38,52；E；FE；共同待办：P0 |
| 19-02 | 直接输入 Markdown 后在编辑位置看到效果；列表、待办、引用、链接和代码等格式正确，代码内容不被误当作正文语法处理。 | 验证中 | 自动化：E editor-live-preview structure/code literal/task undo；真实CM实例测试；实际：真实格式操作/撤销重做、Chromium中文composition、source/visual/focus及大字号非空选区已验证，保存复杂Markdown原文和附件/位置/关系一致。首期全格式、代码字面量与标题/嵌套标签边界由真实CM测试覆盖，不额外人工穷举语法。 证据：B:16,38,52；E；FE；共同待办：P0 |
| 19-03 | 粘贴一段含列表、链接和图片的内容后可以继续编辑，保存并重新打开时结构和图片位置完整。 | 验证中 | 自动化：E mixed semantic paste+I inline completion；实际：已从原始工具调用与成功返回确认真实HTML strong/list/link语义粘贴，含图复杂记录继续编辑后源码结构与已保存原文一致；原生单图/多图剪贴板另有真实保存/原件hash，混合图片占位顺序由CM精确测试覆盖。首次innerText多空行比较失败保留，采用随后raw cm-line与后端匹配的证据。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 19-04 | 从网页或文档粘贴保留基础语义格式且不带入来源字体、颜色、背景；粘贴为纯文本可用。 | 验证中 | 自动化：E semantic/plain intents、HTML styles dropped、pre空行保留；实际：原始动作确认keyboard.paste({text,html})完成strong/list/link语义转换，CM测试覆盖去来源样式和代码空行。当前Ego带Shift快捷键只派发按键而不派发paste，未冒称通过；显式一次性纯文本入口+真实原生Cmd+V已通过HTML剪贴板文字提取、选区替换、撤销、下一次正常格式；纯图片原生剪贴板不删选中文字且不启动上传，URI-only另有精确回归。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 19-05 | 来回切换可视化与源码模式，正文、标签、附件、格式、草稿和编辑位置不丢失，不因只切换模式而静默改坏原文。 | 验证中 | 自动化：E source/focus unchanged doc/editor identity；undo state；实际：实际关联搜索预览后继续写作、正反向导航及复杂源码/元数据往返已过；原始动作核对child Esc后光标anchor/焦点保持，390px/24px后续证据补齐非空选区一致。raw cm-line的408字节与已保存后端基线匹配；该次无修改保存不冒称新增正文写入。后续真实长文进入/退出聚焦及关联预览返回scrollTop均923.5、非空选区一致；最终树长文两轮切换454.5与非空选区一致；多关联短视口已保留144px正文及可滚达保存，见B-new。 证据：B:5–6,20,38–39,52；B1-proof；E/I；共同待办：P0 |
| 19-06 | 正确区分 Markdown 标题与嵌套标签；关联记录、附件和已有复杂内容继续可用，必要时能切源码精确编辑。 | 验证中 | 自动化：E legacyMarkdown/tags/complex/code + R06关系保存；实际：真实格式操作/撤销重做、Chromium中文composition、source/visual/focus及大字号非空选区已验证，保存复杂Markdown原文和附件/位置/关系一致。首期全格式、代码字面量与标题/嵌套标签边界由真实CM测试覆盖，不额外人工穷举语法。 证据：B:16,38,52；E；FE；共同待办：P0 |
| 19-07 | 中文输入法组合输入、选择文字、撤销重做、草稿恢复完成验证；普通编辑与聚焦模式操作一致。 | 验证中 | 自动化：E IME deferral/undo/redo/anchor、I durable；jsdom非真实IME；实际：真实格式操作/撤销重做、Chromium中文composition、source/visual/focus及大字号非空选区已验证，保存复杂Markdown原文和附件/位置/关系一致。首期全格式、代码字面量与标题/嵌套标签边界由真实CM测试覆盖，不额外人工穷举语法。 证据：B:16,38,52；E；FE；共同待办：P0 |
| 19-08 | 编辑呈现与保存后的阅读结构一致，历史记录及导出内容保持可读 Markdown。 | 验证中 | 自动化：E exact Markdown doc；G export exact bytes；实际：旧复杂Markdown编辑/阅读及source切换后保存原文字节一致；实际导出ZIP在应用外逐正文/元数据/媒体核对通过，未将渲染DOM额外空行误当正文变化。 证据：B:38,52；ZIP；E；共同待办：P0 |
| 19-09 | 手机真机验证格式按钮、软键盘、选区和粘贴体验；桌面窄视口不替代真机验收。 | 验证中 | 自动化：E viewport工具只是模拟；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |

## 历史 AC 回归范围

历史已关闭不代表本轮通过。以下逐项已关联本轮证据，仍共享P0；真实AI分支按最新Goal暂缓，设备定位无坐标边界按上文如实保留，AC37真实社媒按用户指令暂缓。

| ID | 场景 | 预期 | 本轮状态 | 实际结果 / 环境与时间 / 提交 / 证据 |
| --- | --- | --- | --- | --- |
| AC01 | 写一句话并保存 | 无标题或标签门槛；原话保留；无后续任务 | 验证中 | 自动化：G CreateMemo/日期/无重复测试；F home-loading-boundary；实际：多条无标题/无标签记录实际保存；旧日期合成账户与纯记录首页无缺席/积压/streak/强制探索提示，探索入口保持可选。旧日期fixture不声称实际等待三个月；组件回归覆盖相应界面约束。 证据：B:1–6,53；FE；共同待办：P0 |
| AC02 | 只保存照片或录音 | 有效媒体可成条；原件及播放可验证；转写可不使用 | 验证中 | 自动化：G OriginalRetainsBytes、PhotoOriginalAndRevisionMediaRecovery；F journal-memo-media纯媒体；实际：空正文纯图片及纯音频均能保存；390px/24px下图片100→120→100缩放、键盘下载/Esc通过，下载hash一致；音频实际播放至末尾且原件字节核对。未声称实际麦克风录制。 证据：B:50–51；E；共同待办：P0 |
| AC03 | 三个月未使用后打开 | 无缺席、积压、连续天数或回归弹窗 | 验证中 | 自动化：F app-sidebar `keeps...without task prompts`仅当前渲染；实际：多条无标题/无标签记录实际保存；旧日期合成账户与纯记录首页无缺席/积压/streak/强制探索提示，探索入口保持可选。旧日期fixture不声称实际等待三个月；组件回归覆盖相应界面约束。 证据：B:1–6,53；FE；共同待办：P0 |
| AC04 | 一直只使用记录 | 三项探索不自动展开、不产生红点或通知 | 验证中 | 自动化：F sidebar optional exploration；不是长期副作用证明；实际：多条无标题/无标签记录实际保存；旧日期合成账户与纯记录首页无缺席/积压/streak/强制探索提示，探索入口保持可选。旧日期fixture不声称实际等待三个月；组件回归覆盖相应界面约束。 证据：B:1–6,53；FE；共同待办：P0 |
| AC05 | 主动进入每日回顾 | 少量原文；同日再进稳定；无往年今日也能自然退化 | 验证中 | 自动化：G `TestReviewFrozenSetRemovalAndCalendarTimezone`最多3/同日冻结/移除不补位；F journal.test eligible；实际：每日回顾同日再入集合一致，进入详情后浏览器返回原卡/阅读位置，scrollTop前后均234；无已读任务计数。冻结/退化/移除不补位由服务测试覆盖。 证据：B:43；FE/G；共同待办：P0 |
| AC06 | 从回顾详情返回 | 原位置和阅读状态恢复；无已读任务计数 | 验证中 | 自动化：F journal-session frozen review across detail；实际：每日回顾同日再入集合一致，进入详情后浏览器返回原卡/阅读位置，scrollTop前后均234；无已读任务计数。冻结/退化/移除不补位由服务测试覆盖。 证据：B:43；FE/G；共同待办：P0 |
| AC07 | 漫步换条并后退 | 纯随机、同次不重复；后退回到原条；随时离开 | 验证中 | 自动化：F journal.test shuffle/history/no repeat/forward after back；journal-queries全页失败；实际：漫步下一条→后退→前进返回对应同一记录；无重复与完整历史/退出规则由已有状态回归覆盖。 证据：B:44；FE；共同待办：P0 |
| AC08 | 没有旧记录 / 只有一条 | 无凑数、无虚构内容、无鼓励完成的提示 | 验证中 | 自动化：F journal.test empty+single archives；实际：实际零旧记录和仅一条旧记录账户UI已验证，无虚构填充；主Agent另确认单条漫步耗尽后不生成第二条。合成原日期不声称物理等待数月。 证据：B:53；FE/G；共同待办：P0 |
| AC09 | 进入 AI 页但未点开始 | 不向模型发送正文，不生成分析 | 验证中 | 自动化：G `TestJournalInsightConsentOwnerScopeSaveStaleAndDeletion` config GET/PUT 0 calls；实际：打开AI页只请求preferences/config，未开始没有generate请求；选中2条合成记录但未配置provider时按钮禁用并明确配置提示，未向模型发送正文。 证据：B:54；AI/G；共同待办：P0 |
| AC10 | 选两条记录生成洞察 | 只发送所选范围；来源可核；不读取全库或媒体 | 暂缓 | 自动化：G同上只选正文、不含foreign；provider insight selected input；mock边界；实际：开始前告知、显式选中2条合成记录和未配置服务禁用已实际验证；真实provider/model/受控凭据未到位，成功生成时只发送所选正文、来源回溯与不读媒体仍待真实服务核验。mock输入边界不代替此项。 证据：B:54；U-AI；AI/G；R；2026-10-11 用户暂缓 AI 洞察；保留上述真实验收缺口至后续，不作为本轮发布前置 |
| AC11 | AI 失败、取消或输入超限 | 原始记录不变；范围保留；无隐式截断或自动重发 | 暂缓 | 自动化：AI六场景新race+provider取消/redirect tests；不改原文/不保存/不retry；实际：mock HTTP六场景及服务端取消/超限回归通过，原文不变、范围保留、无隐式截断或重发；实际AI页可保留所选范围。真实服务成功链路未开始，其失败或安全取消的界面闭环仍待获准输入。 证据：B:54；U-AI；AI/G；R；2026-10-11 用户暂缓 AI 洞察；保留上述真实验收缺口至后续，不作为本轮发布前置 |
| AC12 | 看完 AI 直接离开 | 无保存、评价、反思要求；不自动写入时间线 | 暂缓 | 自动化：G generate后insights=[]；无隐式持久化；实际：自动测试确认生成不会隐式保存；真实provider尚未到位，实际结果页面直接离开且不写时间线的生命周期仍待真实服务结果验证。 证据：B:54；U-AI；AI/G；R；2026-10-11 用户暂缓 AI 洞察；保留上述真实验收缺口至后续，不作为本轮发布前置 |
| AC13 | 明确保存洞察 | 来源和 AI 标识保留；可找回、删除、导出；不默认进入回顾 | 暂缓 | 自动化：G insight显式save、来源/陈旧；Backup保存AI导出；F回顾排除derived；实际：显式保存的来源/AI标识、导出、不进入原文回顾有API/组件回归；真实provider尚未到位，真实结果保存→找回/删除/导出的界面生命周期仍待输入。 证据：B:54；U-AI；AI/G；R；2026-10-11 用户暂缓 AI 洞察；保留上述真实验收缺口至后续，不作为本轮发布前置 |
| AC14 | 修改或删除被分析的记录 | 修改使旧结果过时；删除清理可泄露原文的衍生结果 | 暂缓 | 自动化：G insight source edit=>stale，trash=>derived清理；实际：来源修改标陈旧、删除清除衍生泄露内容有API回归；真实provider尚未到位，真实生成结果后的修改/删除界面闭环仍待输入。 证据：B:54；U-AI；AI/G；R；2026-10-11 用户暂缓 AI 洞察；保留上述真实验收缺口至后续，不作为本轮发布前置 |
| AC15 | 排除某条回顾内容 | 立即退出回顾与漫步；仍可主动找到并恢复偏好 | 验证中 | 自动化：G frozen review exclusion；F journal-source-picker `restores only this record...`；实际：真实从漫步排除后卡片退出并出现中性文案，主动检索仍找到原文，再恢复偏好菜单状态正确；每日冻结集移除规则由精确服务测试补足。 证据：B:45；G/FE；共同待办：P0 |
| AC16 | 断网录入并重启应用 | 目标设备上验证实际持久化；未上传媒体不丢；状态真实 | 验证中 | 自动化：I/E offline/pending/blob/owner/QuotaExceeded；实际：断网冷刷新后图文草稿与Blob恢复，前插文字后锚点正确，联网续传最终只生成一条记录/同一个附件，原件hash一致。丢响应、稳定ID及失败重试不重复上传有精确持久队列/CM回归，不另手工制造全部故障排列。 证据：B:12–14,20；E/I；H；共同待办：P0 |
| AC17 | 网络超时后重复保存 | 不产生重复记录；附件失败不伪装完整成功 | 验证中 | 自动化：F journal-save-reliability lost creation response/stableID；E/I completed image retry；实际：断网冷刷新后图文草稿与Blob恢复，前插文字后锚点正确，联网续传最终只生成一条记录/同一个附件，原件hash一致。丢响应、稳定ID及失败重试不重复上传有精确持久队列/CM回归，不另手工制造全部故障排列。 证据：B:12–14,20；E/I；H；共同待办：P0 |
| AC18 | 多设备同时修改 | 保留冲突内容；不静默覆盖 | 验证中 | 自动化：G ConflictKeepsBothVersionsAndRevisionRestore、MetadataCAS与并发Store；F draft conflict保留独立baseline；实际：双客户端冲突展示两份完整正文与附件；刷新保留本机草稿，再保存仍冲突，显式比较并合并后只保留正确单条。事务、重试和断响应边界已有精确回归。 证据：B:36–37；H；G/DB；共同待办：P0 |
| AC19 | 删除再恢复 / 永久删除 | 可恢复范围与保留期限明确；隐私删除语义一致 | 验证中 | 自动化：G TrashRestoresPrivatelyWithoutSharesAndExpires+R07引用保留；P安全restore；实际：回收预览/恢复原件、音视频、来源与旧分享撤回主路径通过；恢复PRIVATE，旧分享重新请求不再含被撤回记录。错误提取码拒绝/正确码读取已证；过期/轮换/媒体直链及期限/清理由隔离负向回归覆盖，未删除真实资料。 证据：B:21–25,30,34–35；R；G；共同待办：P0 |
| AC20 | 导出并在应用外打开 | 正文可读、受管理媒体可用、外链缺口显式列出 | 验证中 | 自动化：G `TestJournalBackupNewInstanceRoundtripAndNoReplay` exactbody/关系/原件/AI/refs；archive exact bytes；实际：浏览器下载普通/含历史ZIP，应用外独立对fresh SQLite快照核对138/138通过：18记录、12附件/原件、10/14可移植文档、0/4版本，正文/日期/关系/原件hash及脱敏字段一致。三DB导入回归证明组织关系保留且不重放。 证据：ZIP；ZIP-DB；共同待办：P0 |
| AC21 | 从独立备份恢复 | 在干净环境核对恢复范围；结果可复现 | 验证中 | 自动化：P安全恢复/权限/源字段hash回归；G/DB完整导入与不重放；实际：真实0038d722快照在network-none隔离容器运行1f65候选，applicationVerified与authorizationVerified均true：707正常/5回收、55原件/54预览、110保留文件、2451负向；712行仅派生索引变化，归一原字段hash相同。非空关系由合成ZIP和三DBroundtrip补足；不覆盖线上数据，旧会话/分享撤销且外发暂停。 证据：R；R-receipt；ZIP-DB；B:31；共同待办：P0 |
| AC22 | 手机键盘 / 桌面键盘 / 大字体 | 保存可达、焦点可预测、触摸和键盘均可操作 | 验证中 | 自动化：E visual viewport；F home不自动唤键盘+sidebar触控入口；实际：ego桌面及390×844/390×480视口、24px根字号已实际验证：格式/保存可达、非空选区、聚焦及子弹窗Esc优先级和键盘操作；按用户变更范围验收，不宣称实体软键盘/触摸硬件。快速输入晚结果等边界由组件测试覆盖。 证据：B:16–17,50,52；E；D；共同待办：P0 |
| AC23 | 未授权访问与首次使用 AI | 私密内容不泄漏；服务与发送范围说明有效 | 验证中 | 自动化：G JournalReadRejectsFormerSpaceMember；A全面owner只读；G insight owner/selected；实际：匿名/其他owner/旧授权访问的私密正文与原件负向核验通过；实际开始前告知及不默认发送已证。首次真实AI配置/调用一致性按2026-10-11最新Goal暂缓；通用权限与实际开始前告知仍采用上述已执行证据。 证据：B:54；U-AI；AI/G；R；共同待办：P0 |
| AC24 | 日期、标签和手选范围分享 | 访客仅看到预览授权内容；组合筛选、子标签及排除语义清楚 | 验证中 | 自动化：G `TestShareSelectionAndSafeText` 日期/标签all/subtags；SharePreviewSnapshot；F journal-share preview digest；实际：真实动态分享日期+父/子标签+排除预览，访客只见授权集合；修改来源标签后重新读取退出该记录，无相似前缀/旧年泄漏。固定手选与筛选细节已有API/组件回归。 证据：B:47；G/FE；共同待办：P0 |
| AC25 | 固定分享后新增或编辑原记录 | 不自动追加记录或改写快照；主动更新有差异预览；删除/归档即时撤销 | 验证中 | 自动化：G SharePreviewSnapshotPauseRotateAndWithdrawal固定快照/摘要变化拒绝/归档；F journal-share；实际：真实固定分享创建/访客读取/撤销及恢复撤回通过；固定快照不追随新增/编辑、显式差异更新、归档退出有服务/API及mounted组件测试，不要求每分支另走人工流程。 证据：B:19,30,34–35；G/FE；共同待办：P0 |
| AC26 | 动态分享新增、改标签和移除条件 | 规则内内容按授权更新；不符规则或被排除内容退出；无其他记录元信息泄漏 | 验证中 | 自动化：G `TestJournalDynamicSharesDoNotBackfillImportedHistory`；分享filter测试；实际：真实动态分享日期+父/子标签+排除预览，访客只见授权集合；修改来源标签后重新读取退出该记录，无相似前缀/旧年泄漏。固定手选与筛选细节已有API/组件回归。 证据：B:47；G/FE；共同待办：P0 |
| AC27 | 到期、停用、错误提取码与附件直链 | 页面、数据、缩略图及媒体受同一授权；无绕过或泄漏 | 验证中 | 自动化：G journal_share + native/fileserver媒体share/owner；F visitor credentials omission/revocation；实际：回收预览/恢复原件、音视频、来源与旧分享撤回主路径通过；恢复PRIVATE，旧分享重新请求不再含被撤回记录。错误提取码拒绝/正确码读取已证；过期/轮换/媒体直链及期限/清理由隔离负向回归覆盖，未删除真实资料。 证据：B:21–25,30,34–35；R；G；共同待办：P0 |
| AC28 | 普通记录、同步分区及未完成附件 | 普通内容不外发；已启用分区内容完整保存后才外发；目标在保存前可见 | 验证中 | 自动化：G AtomicPartition final commit；PartitionHTTPCompleteSave；E/I pending image gate；F目标显示；实际：普通/未完成附件保存门槛和分区目标显示有组件/事务实证；实际旧版恢复后普通编辑仍暂停，显式重新选择才发送当前正文，receiver仅两次合法签名upsert。历史不补发、重试/乱序/多目标/取消/撤回由本地真实HTTP接收器精确回归补足，社媒平台暂缓。 证据：B:34–35；G/DB；E/I；共同待办：P0 |
| AC29 | 启用同步时分区已有历史内容 | 默认不补发；主动选择补发才产生对应任务 | 验证中 | 自动化：G `TestPartitionTargetsNeverReplayHistory`、ChangesRequireExplicitSendByDefault；实际：普通/未完成附件保存门槛和分区目标显示有组件/事务实证；实际旧版恢复后普通编辑仍暂停，显式重新选择才发送当前正文，receiver仅两次合法签名upsert。历史不补发、重试/乱序/多目标/取消/撤回由本地真实HTTP接收器精确回归补足，社媒平台暂缓。 证据：B:34–35；G/DB；E/I；共同待办：P0 |
| AC30 | Webhook 超时、重复投递、乱序和多目标失败 | 事件稳定可去重；成功目标不重复创建；旧版本不覆盖新版本；本地内容不丢 | 验证中 | 自动化：G TargetsRetryIndependently、RetryIsBounded、PendingSurvivesRestart、RechecksPauseRevision、PauseCancelsInflight；实际：普通/未完成附件保存门槛和分区目标显示有组件/事务实证；实际旧版恢复后普通编辑仍暂停，显式重新选择才发送当前正文，receiver仅两次合法签名upsert。历史不补发、重试/乱序/多目标/取消/撤回由本地真实HTTP接收器精确回归补足，社媒平台暂缓。 证据：B:34–35；G/DB；E/I；共同待办：P0 |
| AC31 | 暂停、移出、删除、归档及恢复 | 待发正文和重试停止；恢复不自动重发；外部撤回结果单独报告 | 验证中 | 自动化：G RechecksPauseRevisionAndDeletion、RestoreDoesNotReactivateMapping、RetractionHasNoDeletedContent；F partition-save普通编辑不复活；实际：普通/未完成附件保存门槛和分区目标显示有组件/事务实证；实际旧版恢复后普通编辑仍暂停，显式重新选择才发送当前正文，receiver仅两次合法签名upsert。历史不补发、重试/乱序/多目标/取消/撤回由本地真实HTTP接收器精确回归补足，社媒平台暂缓。 证据：B:34–35；G/DB；E/I；共同待办：P0 |
| AC32 | Webhook 已接收但没有平台发布回执 | 显示已送达或发布结果未知；只有核验回执才显示已发布 | 验证中 | 自动化：G `TestPartitionPublishedRequiresMatchingReceipt`；实际：页面显示Webhook已送达、发布结果未知，与隔离接收器事件吻合；仅匹配核验回执才标已发布的其他分支由服务测试验证，不把协议投递冒称社媒发布。 证据：B:48；G；共同待办：P0 |
| AC33 | 删除个人分区 | 保留记录并移至未分区；停止该分区外发，不连带删除生活资料 | 验证中 | 自动化：G `TestJournalPartitionHTTPCompleteSaveAndIsolation` 最后DELETE分区204并GetMemo断言原正文保留；外发停止由partition测试；实际：真实删除合成分区后编辑器归未分区；后续带授权HTTP200/exactName、独立预存SQLite快照对当前所有记录字段/附件/关系逐字节核验相同，mapping已不存在。早先401字段比较已作废，停止外发由服务回归补足。 证据：B:48–49；B34-corrected；G；共同待办：P0 |
| AC34 | 日历颜色及记录量 | 随数量变化；编辑、分享、AI 和同步副本不增量；导入归入原日期 | 验证中 | 自动化：G originaldates/provenance/Calendar；C full calendar zone/scope/stats；实际：列表/日期日历/地图同范围一致；关闭颜色后0/11/6数量样本背景均透明，计数仍可读；键盘折叠/显示/日期跳转通过。编辑/分享/AI/同步不重复计数和原日期导入有精确统计回归。 证据：B:10,40,46；C/G；共同待办：P0 |
| AC35 | 日历折叠、关闭颜色与键盘操作 | 主动设置有效；空白中性；非颜色方式可读；输入始终易达 | 验证中 | 自动化：F journal preference/calendar tests；C sidebar states；实际：列表/日期日历/地图同范围一致；关闭颜色后0/11/6数量样本背景均透明，计数仍可读；键盘折叠/显示/日期跳转通过。编辑/分享/AI/同步不重复计数和原日期导入有精确统计回归。 证据：B:10,40,46；C/G；共同待办：P0 |
| AC36 | 恢复旧备份 / 导入到启用同步的实例 | 不复活旧分享或重放外发；已发布映射可核查，规则经明确恢复才启动 | 验证中 | 自动化：G BackupNewInstanceRoundtripAndNoReplay、BackupExistingInstancePauseAndCollision；ImportSuspensionDoesNotRetractOrReplay；P pause_restored_permissions；实际：真实版本恢复PRIVATE且暂停，旧分享重新请求无已撤回记录，普通编辑不重放；新鲜S3隔离应用授权核验及真实ZIP组织/映射保留和三DB导入暂停/不重放均通过。规则需明确恢复才启动。 证据：B:34–35；R；ZIP/ZIP-DB；G；共同待办：P0 |
| AC37 | 首个社媒目标完整链路 | 所选平台上核实文字、媒体、更新/撤回能力及失败边界；只投递成功不替代发布验证 | 暂缓 | 实际：用户明确暂缓真实社媒接入与平台发布验证；本轮只验Webhook协议，不宣称旧J17整体全面通过。 证据：用户范围决定 |
