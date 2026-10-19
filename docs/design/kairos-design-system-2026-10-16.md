# Kairos 设计系统规范

Status: Draft — 2026-10-16。本文档是尚未实现的新设计，实现完成前可持续修订。
依据：`BRAND.md`、`docs/design/prototypes/`（方向 A–D 实际体验对照，**B 松绿 + 文楷分层**已经本人选定）、`kairos-interaction-review-2026-10-11.md` 的七态契约、现有 `web/src/themes/` 与 `components/ui/` 实现。

本文档回答"Kairos 长什么样、为什么这么长"，并为后续开发提供可直接落地的 token 表与组件契约。文中所有数值均可直接在 `prototypes/shared.css` 中对照验证。

## 0. 设计语言一句话

**暖纸为底，松绿为墨，文楷记事，控件退后。**

- 参照系：Things / Linear 的控件精度 + flomo / Bear 的中文阅读温度。不做 SaaS 后台式的密集仪表感。
- 取舍顺序沿用 `BRAND.md`：数据与隐私 → 本人控制权 → 记录的低负担 → 找回与阅读 → 探索 → 装饰。
- 品牌三色（松绿 `#263a35` / 暖白 `#f5f0e6` / 琥珀 `#d7ab71`）中，松绿进入界面主色，琥珀只保留在"标记"语义位（logo、头像角标、可选的时刻标记），不做通用交互色。

## 1. 颜色体系

### 1.1 分层

| 层 | 内容 | 消费方式 |
| --- | --- | --- |
| L0 原始色 | 松绿阶、琥珀、暖灰、语义色阶的 OKLCH 值 | 只在主题文件中出现 |
| L1 语义 | `--bg` `--card` `--ink` `--line` `--primary` `--moment` 等 | 组件与 `@theme inline` 映射 |
| L2 派生 | `color-mix` 生成的 soft/line/hover 变体 | 组件内直接使用 |
| L3 模式 | 明 / 暗 / 纸 三套取值 | `:root[data-theme]` 覆写 |

现有 `web/src/themes/` 的"语义变量 + `@theme inline`"架构延续，**不换工具、不加运行时**。组件内禁止出现十六进制色值与调色板直写类（现有 35 处 hex、1 处 palette class 列入清理）。

### 1.2 亮色模式取值（已选定：松绿方向）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `oklch(0.9818 0.0054 95)` | 页面底（暖纸，沿用现状） |
| `--card` | `oklch(1 0 0)` | 记录卡/书写卡/浮层 |
| `--sidebar` | `oklch(0.9663 0.008 98.9)` | 侧栏底 |
| `--ink` | `oklch(0.2438 0.0269 95.7)` | 正文文字 |
| `--ink-2` | `oklch(0.4334 0.0177 98.6)` | 次级文字 |
| `--ink-3` | `oklch(0.5559 0.0075 97.4)` | 弱化/占位/图标 |
| `--line` | `oklch(0.8847 0.0069 97.4)` | 发丝边 |
| `--line-soft` | `color-mix(line 70%)` | 卡片默认边 |
| `--surface-2` | `oklch(0.9245 0.0138 93)` | 选中底、次表面 |
| `--hover` | `color-mix(ink 5%)` | 中性悬停 |
| `--primary` | `oklch(0.40 0.062 162)` | **松绿主色**：主按钮、链接、选中态 |
| `--primary-hover` | `oklch(0.35 0.062 162)` | 主色悬停 |
| `--primary-ink` | `oklch(0.96 0.018 95)` | 主色上的文字（暖白） |
| `--primary-soft` | `color-mix(primary 10%)` | 淡彩底：标签胶囊、聚焦环、选中字 |
| `--primary-line` | `color-mix(primary 30%)` | 主色描边：聚焦、强调边框 |
| `--moment` | `oklch(0.72 0.10 72)` | 琥珀"时刻"位：logo 点、头像角标 |
| `--moment-ink` | `oklch(0.28 0.05 70)` | 琥珀底上的文字 |
| `--ring` | `color-mix(primary 50%)` | focus-visible 环 |
| `--heat` | `var(--primary)` | 日历热力基色（与主色一致） |
| `--heat-1..4` | `color-mix(heat 12/22/34/42%)` | 小日历热力四档，搭配不透明正文色 |

语义色（`--destructive` `--success` `--warning`）沿用现有取值，色相不动；只校验对比度。

### 1.3 暗色模式取值

| Token | 值 | 说明 |
| --- | --- | --- |
| `--bg` | `oklch(0.235 0.008 255)` | 石墨底 |
| `--card` | `oklch(0.275 0.009 255)` | 卡片与底保持 ≥0.04 明度差 |
| `--sidebar` | `oklch(0.21 0.009 255)` | 比页面底更深，向内退 |
| `--ink` / `--ink-2` / `--ink-3` | `0.90` / `0.79` / `0.66` | 三级文字 |
| `--line` | `oklch(0.37 0.01 255)` | |
| `--surface-2` | `oklch(0.35 0.011 255)` | |
| `--primary` | `oklch(0.72 0.06 163)` | 松绿的暗色版本（提亮保识别） |
| `--primary-ink` | `oklch(0.20 0.02 165)` | 暗色下主色块上放深字 |
| `--primary-soft` / `--primary-line` | `color-mix(primary 16% / 35%)` | 暗色淡彩浓度上调 |
| `--moment` | `oklch(0.78 0.11 75)` | |
| `--ring` | `color-mix(primary 60%)` | |
| `--shadow-float` | 纯黑三层 `rgb(0 0 0 / .30/.40/.50)` | 暗色阴影加深 |

### 1.4 对比度基线

- 正文 `--ink` on `--bg`/`--card`：≥ 7:1（AAA 目标）。
- 普通字号文字（包括 `--ink-2`、`--ink-3`、占位与辅助说明）：≥ 4.5:1；不能因信息次要而降至 3:1。
- 大号文字（至少 18pt，或至少 14pt 且粗体）：≥ 3:1；用于识别控件及状态的非文字图形、焦点指示与相邻颜色：≥ 3:1。
- `--primary` on `--card`：≥ 4.5:1；`--primary-ink` on `--primary`：≥ 4.5:1。
- 半透明热力底和文字按实际背景合成后测量，覆盖明暗 × 普通/纸面四种主题、侧栏和手机页面。小日历日期不继承弱化侧栏文字色。
- 内描焦点必须与控件自身底色形成对比；实心按钮使用其配套前景色，不使用与填充相同的 `--ring`。
- 以实际渲染结果为准，当前实现约定维护在 `web/src/themes/COLOR_GUIDE.md`。标准依据：[WCAG 2.2 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)与[非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

### 1.5 琥珀使用边界

琥珀 `--moment` **不是**第二个主色。允许出现的位置：logo/头像角标、空态插画点睛、"随便看看"等探索语义的图标可选位。禁止：主按钮、链接、表单态、选中态、批量出现的装饰。理由：琥珀小面积是"标记"，大面积是"警告色"，会稀释语义。

## 2. 字体与排版

### 2.1 字体分层（铁律）

| 层 | 字体 | 用在哪 | 为什么 |
| --- | --- | --- | --- |
| **内容层** | 文楷栈 | 页标题、正文、引文、书写区、空态引语 | "你写下的东西"才配手写温度 |
| **界面层** | 系统黑体栈 | 侧栏、按钮、标签名、时间戳、数字、表单 | 手写体污染控件会降精度感 |
| **代码层** | 等宽栈 | 行内代码、代码块、技术值 | 不变 |

```css
--font-content: "LXGW WenKai Screen", "LXGW WenKai",
  "Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif;
--font-ui: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "SF Pro", "PingFang SC", "MiSans", "HarmonyOS Sans SC",
  "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

实现要点：

- 文楷做成**内容字体偏好项**（设置 → 外观：文楷 / 系统黑体），默认文楷；不全局写死——长时间阅读疲劳度需真实使用验证。
- 生产环境**自托管字体子集**（仅常用字 + 西文数字，约 <2MB woff2，`font-display: swap`），不走 CDN——私密工具不发第三方请求。原型里的 jsdelivr 引用仅作演示。
- **文楷无粗体**：内容层所有标题字重收敛 500，靠字号与颜色分层；禁止对文楷应用 `font-weight ≥600`（合成粗体会糊）。
- 界面层字体栈按平台择优：Apple → 苹方，装 MiSans/鸿蒙黑体的机器自动升级，思源黑体/雅黑兜底。不下载 UI 字体。

### 2.2 具名文字角色（消灭裸 `text-xs`/`text-sm`）

| 角色 | Token | 值 | 用在哪 |
| --- | --- | --- | --- |
| 页面标题 | `--fs-page-title` | 1.5rem / w500-600 / ls 0.01em | "记录"等页面 H1 |
| 记录内 H1 | `--fs-memo-h1` | 1.875rem / w500 | markdown h1 |
| 记录内 H2 | `--fs-memo-h2` | 1.5rem / w500 | |
| 记录内 H3 | `--fs-memo-h3` | 1.25rem / w500 | |
| 正文 | `--fs-body` | 1rem / w400 | memo 正文、书写区 |
| 界面 | `--fs-ui` | 0.8125rem(13px) | 控件、标签、按钮、侧栏行 |
| 说明 | `--fs-caption` | 0.75rem(12px) | 时间戳、辅助说明 |
| 微标签 | `--fs-micro` | 0.6875rem(11px) | 计数、节标题（+0.04em 字距） |
| 长读行高 | `--lh-reading` | 1.75 | 中文正文统一值 |
| 界面行高 | `--lh-ui` | 1.125rem | 控件单行 |

规则：禁止在组件里裸写 `text-xs`/`text-sm`/`text-base`，按角色选 token。现有 ~600 处 `text-sm`/`text-xs` 在改造时归并到 ui/caption/micro 三档。`leading-6`（1.5）与 `leading-7`（1.75）在正文并存的分裂统一为 `--lh-reading`。

### 2.3 中文排版规则

- 中文标题**不收紧字距**（`tracking-tight` 禁用于 CJK）；标题用 0–0.01em，节标题/微标签 0.04em。
- 阅读面（正文、书写区、引语）启用渐进增强：`text-autospace: normal`（中西文自动空距）+ `hanging-punctuation: first`（首行标点悬挂）。不支持的浏览器静默回退，无损失。
- 数字、日期、计数一律 `font-variant-numeric: tabular-nums` 且走界面层字体——文楷的手写数字不进表格型数据。
- `html lang` 修正为 `zh-Hans`（现状 `en` + 运行时纠正，首屏有误报窗口）。
- 引号用直角引号「」或弯引号“”，同一篇内统一；markdown 渲染不篡改用户原字符。

## 3. 文案规范

### 3.1 术语表（收口）

| 规范词 | 废止/注意 | 场景 |
| --- | --- | --- |
| 记录 | ~~备忘录~~（zh-Hans 现存 54 处需替换） | 所有用户可见文案 |
| 标签 | `#标签` 写法在正文内保留 `#` | 标签功能 |
| 分区 | Space 的用户可见名 | 协作边界 |
| 分享 | | 共享能力 |
| 归档 / 最近删除 | | 状态目的地 |
| 随便看看 | | 探索入口（保留） |

### 3.2 语气

- 敬称统一"**你**"（非"您"，非无主语客服腔）。现存"您确定要删除此条备忘录吗"类全部改写。
- 语气：平实、具体、温和。参考 `BRAND.md`："留下此刻，日后重逢"——可以有一点点诗意，但只在空态/引语，不在操作路径上。
- 禁止：打卡/连续/成就/排行等游戏化词；夸大 AI 能力（"智能总结你的生活"）；技术黑话外露（Markdown、表达式、UID、同步冲突码）。

### 3.3 句式模板

| 场景 | 模板 | 例 |
| --- | --- | --- |
| 主按钮 | 动宾，≤4 字 | 保存 / 归档 / 恢复 |
| 危险确认 | "动词 + 对象 + ？后果一句" | "删除这条记录？删除后可在最近删除中找回。" |
| Toast 成功 | 动词 + 了 | "已保存" |
| Toast 失败 | 发生了什么 + 怎么办 | "保存失败，内容还在，稍后自动重试" |
| 空态 | 一句陪伴 + 一个动作 | "记录留在这里，什么时候想写都可以。" |
| 占位符 | 轻邀请 | "写点什么……" |
| 权限被拒 | 说人话 + 出口 | "没拿到位置权限。可以手动输入地名。" |

### 3.4 i18n 策略

中文是设计基准语言，但**所有字符串走 i18n**（zh-Hans.json / en.json 对齐）。现状 ~550 处 tsx 硬编码中文（侧栏底部、journal 侧栏、"随便看看"等）回流 locale 文件——这是 P0 清理项，同时让文案规范获得单一审计入口。

## 4. 布局与空间

### 4.1 内容宽度三档（成文）

| 档 | 值 | 页面 |
| --- | --- | --- |
| 阅读档 | `max-w-2xl`(672px) | 记录流、记录详情、回顾、漫步 |
| 工具档 | `max-w-5xl`(1024px) | 收件箱、视图、设置表单 |
| 陈列档 | `max-w-7xl`(1280px) | 附件库、地图等网格陈列 |

理由按任务而非习惯：读的窄、管的中、看的宽。`max-w-3xl`（回收站/备份）视密度归入工具档或阅读档，迁移时逐页定，目标消灭第四档。

### 4.2 空间规则

- 页面顶距统一为一个 token（现有 `pt-2/3/5` + `sm:pt-6/7/10` 混用，收口为一个响应式值）。
- 间距一律用 Tailwind 原生刻度（4px 基数）；**任意值 `p-[13px]`、`w-[234px]` 类禁止新增**，存量 95 处 px 任意值分类处理：侧栏轨距等有语义的入 token，一次性布局偏差就地消除。
- 侧栏轨距沿用现有文档化值（内缩 12 / 图标位 20 / 行高 28 / 标签轨 44），推广为全局 spacing 语义的范例。
- `inline style` 只保留真正数据驱动的一次性值（如热力图动态色），存量 20 处审计。

## 5. 形状与层次

### 5.1 圆角三级 + 胶囊

| Token | 值 | 用在哪 |
| --- | --- | --- |
| `--r-ctl` | 0.375rem (6px) | 按钮、输入框、图标按钮、日历格 |
| `--r-card` | 0.625rem (10px) | 记录卡、书写卡、面板 |
| `--r-pop` | 0.75rem (12px) | 对话框、浮层、下拉 |
| `--r-pill` | 999px | 标签胶囊、头像、分段控件 |

卡片比控件软一档是"笔记本感"的来源。消灭 `rounded`/`rounded-lg` 别名重复（现状 56 处 `rounded` 与 80 处 `rounded-lg` 同为 0.5rem）：迁移映射 `rounded-md → r-ctl`、`rounded/lg → r-card`、`rounded-xl → r-pop`、`rounded-full → r-pill`。

### 5.2 阴影法则（一句话）

**静止面只用发丝边，浮层才用暖色分层影。**

- 静止面（卡片、书写卡）：`border: 1px solid var(--line-soft)`，**无阴影**。悬停只加深边框，不升海拔。
- 唯一例外：书写卡聚焦态——`border-primary-line` + `0 0 0 3px var(--primary-soft)`，是静止面里唯一"抬起来"的组件（表达"现在在这里写"）。
- 浮层（菜单、弹窗、下拉、toast）：统一 `--shadow-float` 暖色分层：
  `0 1px 2px rgb(35 32 24/.05), 0 8px 24px -6px /.09, 0 24px 56px -16px /.12`（暗色改纯黑加深）。
- 阴影梯度现状 `xs/sm/md` 三档几乎不可分，收口为"无 / float"两档真用；`--shadow-float` 现只被消费 1 次，推广为浮层标准。

### 5.3 层级秩序

从静到动：`line-soft 边 < surface-2 选中底 < primary-soft 淡彩 < primary-line 描边 < primary 实心`。语义越"可操作/在焦点"，色彩浓度越高；静态内容永远停在前两档。

## 6. 设计 Token 规范

### 6.1 命名与分层

```text
L0 原始色板     --pine-500 等（仅主题文件内部）
L1 语义角色     --bg --card --ink --line --primary --moment
L2 派生变体     --primary-soft --primary-line --heat-1..4 --line-soft
L3 组件别名     --composer-focus --nav-active（需要时再开，不预建）
```

- 命名用**语义角色**不用色名（`primary` 不叫 `green`）；组件别名只在模式重复 ≥3 处时建立。
- 文字角色、圆角、阴影、宽度档、行高、轨距全部是 token；新增样式先看有没有对应角色。
- Tailwind 消费方式不变：`@theme inline` 一次映射，组件用 `bg-card text-ink-2 rounded-[var(--r-card)]` 或封装后的 utility 名。

### 6.2 新增 token 清单

字体栈 3 个、文字角色 9 个、圆角 4 个、`--shadow-float`（已有，提级为标准）、`--moment`/`--moment-ink`、`--heat`/`--heat-1..4`、`--line-soft`/`--hover`/`--surface-2`（形式化已有隐式用法）、内容宽档 3 个、页顶距 1 个、侧栏轨距 4 个。

### 6.3 `COLOR_GUIDE.md` 重写

现文档描述"primary 是金黄"、记载了不存在的 `--chart-*`/`--sidebar-primary`，属上游 Memos 遗留。重写为事实文档：以本规范第 1、6 节为准，删除虚构 token，对比度改为实测值。

## 7. 组件与状态

### 7.1 状态全集（沿用 10-11 评审七态，视觉化）

`default / hover / focus-visible / selected / disabled / loading / error`，外加内容型 `empty`。所有状态不得只靠颜色区分（配图标、文案或形状）。

全局规则：

- `:focus-visible` = `outline 2px var(--ring), offset 2px`，全组件统一（现有 `FOCUS_VISIBLE_OUTLINE_CLASSES` 实现正确，推广为规范）。
- `hover` 过渡 `background/color/border-color .12s ease`；`prefers-reduced-motion` 时全部归零。
- `::selection` = `var(--primary-soft)`。
- `disabled` = `opacity .5` + `pointer-events:none`（现有做法，成文）。
- 滚动条：细胶囊 `line` 色，悬停 `ink-3`。

### 7.2 关键组件契约

**Button**

| 状态 | 规则 |
| --- | --- |
| default | `bg-primary color-primary-ink` + 内高光 `inset 0 1px rgb(255 255 255/.10)` + 底边 `inset 0 -1.5px rgb(0 0 0/.14)` + 接触影 `0 1px 1.5px /.10` |
| hover | `bg-primary-hover` |
| active | `translateY(0.5px)`，底边减薄 |
| focus-visible | 全局环 |
| disabled | .5 透明度 |
| loading | 文案位换 spinner，宽度锁定不跳动 |

变体沿用现有 `default/destructive/outline/secondary/ghost/link/quiet`；新增样式先进 variant 不进 className（`ui/README.md` 纪律）。

**记录卡（MemoCard）**

| 状态 | 规则 |
| --- | --- |
| default | `bg-card` + `r-card` + `border-line-soft`，无阴影 |
| hover | 边框 → `line`，不升海拔 |
| 内容 | 文楷正文 lh 1.75；时间戳 `fs-caption ink-3` 黑体 |
| 编辑中 | 同书写卡聚焦态 |

**书写卡（Composer）**

| 状态 | 规则 |
| --- | --- |
| default | 同记录卡 + 占位符 `ink-3` 文楷"写点什么……" |
| focus-within | `border-primary-line` + `0 0 0 3px primary-soft`（唯一"抬升"的静止面） |
| 保存中/失败 | 按 10-11 评审的保存态契约：保存中/已保存/失败重试/离线明示，不静默 |

**标签胶囊（Tag）**

| 状态 | 规则 |
| --- | --- |
| default | `primary-soft` 底 + `primary` 字 + `r-pill`，**无边框** |
| hover | 底加深一档（16%） |
| 正文内 | 文楷；侧栏标签名 | 黑体 |

**侧栏行（NavRow/NavPill）**

| 状态 | 规则 |
| --- | --- |
| default | `r-ctl`，`ink-2` 字，`ink-3` 图标 |
| hover | `hover` 底 |
| active | `surface-2` 底 + `ink` 字 + w500 |
| 节标题 | `fs-micro` + `ink-3` + `ls .04em` |

**浮层（Dialog/Sheet/Menu/Toast）**

统一 `r-pop` + `shadow-float` + `bg-card`；z 序沿用现有 `z-overlay/dropdown/tooltip` 分层；进出动效 ≤200ms，reduced-motion 归零。

**空态（EmptyState）**

`fs-caption` 级灰字引语文案 + 至多一个引导动作；可有琥珀点睛的小图形（品牌点缀合法位）。

**表单（Input/Textarea/Select）**

`r-ctl` + `border-line` + `bg-card`；hover 边框加深；focus-visible 全局环；error `destructive` 描边 + `fs-caption` 错误文，错误文句式按 3.3。

### 7.3 组件矩阵页（验收载体）

新增 dev-only 设计系统页（路由进现有导航的 dev 区），陈列上述组件 × 全部状态 × 三个主题，作为每次改动的视觉回归基准与"规范是否被消费"的审计面。

## 8. 与现状的差异清单与迁移优先级

| # | 差异 | 动作 | 优先级 |
| --- | --- | --- | --- |
| 1 | primary 蓝 `oklch(0.45 0.08 250)` → 松绿 `oklch(0.40 0.062 162)` | 改 `default.css`/`default-dark.css` 取值；语义名不变，消费侧零改动 | P0 |
| 2 | zh-Hans "备忘录"×54 | 全文替换"记录"，走 i18n | P0 |
| 3 | 正文行高 1.5/1.75 分裂 | 统一 `--lh-reading: 1.75`（MemoContent 与 JournalMemo 对齐） | P0 |
| 4 | 敬称"您/你/无主语"并存 | 统一"你" | P0 |
| 5 | `COLOR_GUIDE.md` 虚构内容 | 重写 | P0 |
| 6 | `html lang="en"` | 改 `zh-Hans` | P0 |
| 7 | 文楷内容字体偏好项 | 自托管子集 + 外观设置项 + 回退栈 | P1 |
| 8 | `rounded`/`rounded-lg` 别名 | 按 5.1 映射表批量归一 | P1 |
| 9 | 标签胶囊去描边 | Tag 组件样式更新 | P1 |
| 10 | 主题模型 system/light/dark/paper 平铺 | 拆"明暗模式 × 饰面"两轴，选项文案本地化 | P1（另立小设计） |
| 11 | ~550 处硬编码中文 | 回流 i18n | P1 分批 |
| 12 | 任意 px 值 / inline style / hex 色值 | 分类收口 | P2 持续 |
| 13 | 组件矩阵页 | dev-only 路由 | P2 |
| 14 | 内容宽度第四档 `max-w-3xl` | 归并 | P2 |

## 9. 验收基线

- **对比度**：1.4 节各对实测写入表格后才算完成。
- **字体疲劳度**：文楷为偏好项上线后，以"连续回读 20 条记录"为本人体验验收动作；不适则默认回退系统黑体，保留偏好。
- **原型 ≠ 验收**：`prototypes/` 已验证方向与气质；真实粘贴、IME、移动端、弱网保存态仍按 10-11 评审的 X01–X10 清单在真机验收。
- **规范执行审计**：组件矩阵页 + `components/ui/README.md` 纪律为消费端审计；`rounded`/hex/inline-style 计数纳入每次设计改动的 diff 自查。

## 附：原型对照

- 入口 `docs/design/prototypes/index.html`；方向 B（松绿）= 本规范第 1 节，文楷分层 = 第 2 节，组件细节 = 第 5、7 节。
- 方向 A（墨蓝）/ C（青墨+琥珀）/ D（夜读）保留作对照资产；D 的取值即第 1.3 节暗色规范。
