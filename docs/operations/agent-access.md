# Kairos Agent / MCP

在「设置 → Agent / MCP」为每个客户端创建独立的只读凭据，设置用途和有效期。
密钥只在创建时返回；复制并保存在客户端的受控环境，勿提交到仓库或公开对话。
页面可检测实际 MCP 读工具是否可达以及凭据是否为专用只读权限，也可查看最后
使用时间、有效期和撤销凭据。这里的检测不替代外部客户端验收。

## Codex

在启动 Codex 的环境中安全设置 `KAIROS_MCP_TOKEN`。将页面显示的真实地址加入
Codex 的 MCP 配置（使用你的实例地址替换下面的例子）：

```toml
[mcp_servers.kairos]
url = "https://your-kairos.example/mcp/journal"
bearer_token_env_var = "KAIROS_MCP_TOKEN"
```

也可使用 CLI 注册，不把密钥写入命令：

```sh
codex mcp add kairos --url "https://your-kairos.example/mcp/journal" --bearer-token-env-var KAIROS_MCP_TOKEN
```

配置格式来自 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)。
实例应配置 `MEMOS_INSTANCE_URL` 为浏览器可打开的地址，以便返回绝对来源链接；
未配置时返回 `/memos/{uid}` 相对路径，可相对于 MCP 服务的 origin 打开。

## 读工具

- `journal_get_context`：确认当前身份、只读范围、Kairos 时区、今天日期、分区 ID。
- `journal_query_records`：`today` / `date` / `from` + `to` 三种日期方式；可组合
  `keyword`、`tag`、`includeSubtags`、`partitionId`、`pinned`。日期格式为
  `YYYY-MM-DD`，范围两端均包含。结果使用记录原始日期，而非导入时间。
- `journal_get_record`：以查询返回的 `name` 读取单条全文和来源。

默认仅含自己的正常、归档记录，排除评论与回收站；其他人的记录不可读。
专用 Agent 凭据不包含附件原件、缩略图、音视频或头像下载权限。正文中的普通
附件路径不是下载授权；文件入口不会因附带浏览器 Cookie 或分享链接而扩大该凭据权限。
正文不截断，每页 1–100 条。保留同一查询参数，传入上页 `nextPageToken` 直到
`coverage.hasMore=false`。`completeInThisResponse` 仅在首次查询一页涵盖全部结果时
为真；最后一页不代表单页涵盖全部历史。游标绑定用户、查询条件、时区和页大小，
24 小时失效；查询期间数据可变，并非冻结快照，有变动时重新读取。

## 验收与回顾

使用合成记录，在真实 Codex 客户端验证连接、今天/指定日期、跨时区边界、
两页以上查询与原文链接。对原文、引用标识和数量逐项核对。没有记录与认证失败
必须分别显示，不能把错误当成空历史。比较两个时期前先读取全部分页，输出中
区分记录中的事实、原文引用与 Agent 的推测，不回写分析。

只读凭据不能创建/编辑/删除记录、附件、关联、分享、凭据或设置，也不能执行
备份管理；改用旧 `/mcp` 或直接 API 仍被服务端拒绝。撤销/过期后下一次读取失败，
其他独立凭据继续有效。新凭据使用独立 `kairos_agent_` 前缀，回滚旧版本时
会失效，不会变成全权凭据；如果旧版本重写设置导致权限字段丢失，升级回来后
也需重新创建。旧全权 PAT 的兼容行为不变，不要将其用作新的 Agent 凭据。
