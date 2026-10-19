# Color System Guide

Kairos 的颜色系统建立在 OKLCH 色彩空间与语义化 CSS 变量之上。
本文是**事实文档**：以 `default.css` / `default-dark.css` / `paper.css` / `paper-dark.css` 的实际定义为准；
设计意图与完整规范见 `docs/design/kairos-design-system-2026-10-16.md`。

## 工作方式

- 每个主题是一个 CSS 文件，只定义 `:root` 下的语义变量。
- `default.css` 末尾的 `@theme inline` 块把这些变量一次性映射成 Tailwind
  颜色（`bg-card`、`text-primary` 等），所有主题共享这一份映射。
- 主题切换发生在运行时：`utils/theme.ts` 把所选主题文件的 `:root` 覆写注入
  `<style id="instance-theme">`，**不是** `.dark` class 开关。
- 组件只消费语义 token，不写十六进制色值、不写调色板直写类（`blue-500`）、
  不手动加 `dark:` 覆写——换一个主题文件即可。

## Token 清单

### 表面

| Token | 用途 |
| --- | --- |
| `--background` | 页面底（亮色为暖纸色） |
| `--card` | 记录卡、书写卡、浮层底 |
| `--popover` | 弹窗/下拉浮层底 |
| `--overlay` | 遮罩基色（恒为黑，透明度由工具类给出，如 `bg-overlay/50`） |
| `--secondary` / `--muted` / `--accent` | 次级表面、弱化表面、悬停表面 |
| `--sidebar` / `--sidebar-accent` | 侧栏底与侧栏悬停底 |

### 文字

| Token | 用途 |
| --- | --- |
| `--foreground` | 正文 |
| `--muted-foreground` | 次级文字、占位、弱化说明 |
| `*-foreground` 系列 | 与同名底色配对的前景（如 `primary-foreground` 用在 `primary` 底上） |

### 品牌与交互

| Token | 用途 |
| --- | --- |
| `--primary` | **松绿**主色：主按钮、链接、选中态、日历热力。亮色 `oklch(0.40 0.062 162)`，暗色提亮为 `oklch(0.72 0.06 163)` |
| `--ring` | focus-visible 环色，与 primary 同色相 |
| `--moment` / `--moment-ink` | 品牌琥珀点。**仅限标识位**：logo、头像角标、可选的时刻标记；禁止用作通用交互色 |

琥珀不是第二个主色：小面积是"标记"，大面积就成了警告色。

### 反馈

| Token | 用途 |
| --- | --- |
| `--destructive` | 删除、危险操作 |
| `--success` | 完成确认（已复制、已保存） |
| `--warning` | 非关键提醒（未使用资源等）；正文内搜索高亮也用 `warning` |

淡彩处理统一用透明度修饰：`border-warning/30 bg-warning/10 text-warning`，
不写死 `amber-*`/`green-*` 调色板类，也不为反馈色手动加 `dark:`。

## 配对规则

```css
/* 对：前景与同名底色成对 */
background: var(--primary);
color: var(--primary-foreground);

/* 错：跨对混用导致对比度失控 */
background: var(--primary);
color: var(--foreground);
```

```css
/* 对：语义 token */
color: var(--muted-foreground);

/* 错：硬编码 */
color: #555;
```

## 对比度与交互状态

- 普通字号文字（包括占位、次要说明和日历日期）至少 **4.5:1**；大号文字与必要的非文字状态指示至少 **3:1**。正文以 **7:1** 为目标。
- 透明度会改变最终对比度；按实际表面合成后校验，不能只比较原始 token。覆盖普通/纸面 × 浅色/深色四套主题，以及侧栏、页面和卡片背景。
- `Button` 的主按钮和危险按钮保留 2px 内描焦点，分别使用 `primary-foreground` / `destructive-foreground`，保证焦点与按钮填充有对比；不要让内描焦点与底色同色。
- `JournalCalendar` 与 `ActivityCalendar` 的小格热力样式共用 `ActivityCalendar/cellStyles.ts` 中的 `ACTIVITY_LEVEL_STYLES`：主色透明度为 12% / 22% / 34% / 42%，搭配不透明 `foreground`。无记录日期保持无热力填充，选中日期仍用完整 `primary` / `primary-foreground` 配对。
- 标准依据：[WCAG 2.2 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)与[非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

## Z-Index 分层

| 层 | Utility | 值 | 用途 |
| --- | --- | --- | --- |
| 基础内容 | `z-0` | 0 | 普通页面内容 |
| 遮罩与弹窗 | `z-overlay` | 50 | Dialog/Sheet 遮罩与内容 |
| 下拉 | `z-dropdown` | 60 | Select/Menu/Popover |
| 提示 | `z-tooltip` | 70 | Tooltip（最高） |

`ui/` 原语已内置这些层级；对话框内的下拉无需额外处理。禁止 `z-[60]` 字面量。

## 已知偏差与清理方向

- `--chart-*`、`--sidebar-primary`、`--sidebar-border` 等 token **不存在**于本仓库——旧指南记载有误，勿再引用。
- 组件中仍可见少量十六进制色值、任意 px 值与 inline style，按设计系统规范第 8 节逐步收口。
- `rounded` 与 `rounded-lg` 在当前半径定义下同值（0.5rem），按规范归一为语义化圆角层级。
