# Paper One Step — 开发文档

> 浏览器扩展：一键将 arXiv 论文剪藏为 Obsidian 可用的 Markdown 文件，自动下载 PDF。
> Chrome Extension Manifest V3。当前版本：**v1.3**。

---

## 1. 功能概述

在 `arxiv.org/abs/xxx` 页面点击扩展图标，自动提取论文元数据并弹出编辑窗口，用户确认后：

- 下载 PDF 到本地（文件名 = 论文标题 sanitize）
- 生成 Markdown 文件（文件名 = 论文标题 sanitize），包含：
  - YAML frontmatter（title, author, year, venue, tags, arxiv_id, doi, pdf wikilink, notes）
  - 正文顶部紧凑元数据（Authors / Year / Venue / arXiv / PDF / DOI）
  - Details 表格（Subjects, Journal Ref, License, Report No）
  - Submission History 表格
  - Editing tip callout（可折叠，引导非技术用户使用 Properties 面板）
  - 正文底部内联 `#tags`
- 在 Obsidian 中可直接打开、搜索标签、跳转 PDF
- Popup 展示下载路径预览

## 2. 项目结构

```
paper_one_step/
├── manifest.json              # Chrome MV3 扩展声明
├── content_script.js          # arXiv 页面解析 + 标签自动生成
├── background.js              # Service Worker（PDF/MD 下载编排 + 通知）
├── popup/
│   ├── popup.html             # 弹窗界面
│   ├── popup.css              # 样式 + Chip 标签组件
│   └── popup.js               # 弹窗交互逻辑
├── options/
│   ├── options.html           # 扩展设置页
│   ├── options.css            # 设置页样式
│   └── options.js             # 设置读写逻辑
├── icons/
│   ├── icon16.png             # 16x16 图标
│   ├── icon48.png             # 48x48 图标
│   └── icon128.png            # 128x128 图标
├── README.md                  # 项目文档（面向用户）
└── DEVELOPMENT.md             # 开发文档（面向开发者）
```

## 3. 数据流

```
arXiv 页面
  ↓ 解析 meta/DOM
content_script.js 返回 { title, authors, year, abstract, pdf_url,
                         html_url, web_url, arxiv_id, categories,
                         venue, suggested_tags, doi, journal_ref,
                         license, report_no, submission_history }
  ↓ chrome.tabs.sendMessage('extract')
popup.js 展示数据 + 合并用户预设标签 + 渲染下载路径
  ↓ 用户编辑 tags/venue → 点 Save & Close
  ↓ chrome.runtime.sendMessage('save')
background.js
  ├── 读取 chrome.storage 配置（saveSubdir）
  ├── 文件名生成：sanitizeFilename(title) → safeTitle
  ├── chrome.downloads.download(pdf)  →  {saveSubdir}/{safeTitle}.pdf
  ├── 生成 Markdown（frontmatter + 元数据 + Details + History + callout + #tags）
  └── chrome.downloads.download(md)   →  {saveSubdir}/{safeTitle}.md
  └── chrome.notifications 通知完成
```

## 4. 核心文件说明

### 4.1 manifest.json

- 权限：`activeTab`, `downloads`, `storage`, `scripting`, `notifications`
- Host 权限：`https://arxiv.org/*`
- Content script 匹配：`https://arxiv.org/abs/*`，`run_at: document_idle`
- Service worker：`background.js`
- 选项页：`options/options.html`（弹窗模式）

### 4.2 content_script.js

元数据提取来源：
| 字段 | 优先来源 | 后备方案 |
|------|----------|----------|
| title | `<meta name="citation_title">` | `h1.title` DOM |
| authors | `<meta name="citation_author">`（多个） | — |
| date/year | `citation_date` / `citation_online_date` | 取年份 |
| abstract | `<meta name="citation_abstract">` | `blockquote.abstract` DOM |
| pdf_url | `<meta name="citation_pdf_url">` | 拼接 `arxiv.org/pdf/{id}` |
| arxiv_id | URL path 正则 `/abs/(.+)` | — |
| categories | `.primary-subject` + `.subjects` | DOM 提取括号内分类 |
| comments | `.metatable td` / `.extra-ref` | DOM 提取 |
| venue | comments 正则匹配 | 默认 `arXiv preprint` |
| journal_ref | `<meta name="citation_journal_ref">` | — |
| doi | `<meta name="citation_doi">` | `.abs-license a[href*="doi.org"]` |
| license | `.abs-license` 文本 | 正则匹配 CC 协议 |
| report_no | `.metatable td` "Report number:" 行 | — |
| submission_history | `.dateline` 文本解析 | 分号分隔多位日期事件 |

标签自动生成规则：
1. arXiv 分类映射（`cs.CL` → `nlp`, `cs.CV` → `cv`, `cs.LG` → `ml` 等）
2. Comments 中检测会议名（`conf/neurips`, `conf/icml` 等 20+ 会议）
3. 检测年份拼接（`conf/neurips2024`）

### 4.3 popup（弹窗 UI）

**设计系统（v1.2 重构）：**
- 主色 `#2563eb`（Tailwind blue-600）；hover `#1d4ed8`
- 文字 `#1e293b`（slate-800）；辅助 `#64748b`（slate-500）
- 边框 `#e2e8f0`（slate-200）；背景 `#ffffff`
- 圆角统一 8px
- 所有图标使用内联 SVG，无 emoji

**布局元素：**
- Header：SVG 文档图标 + `PaperOneStep` 标题
- Title / Authors：灰色只读区（`#f8fafc` 背景）
- Year / Venue：白色可编辑输入框
- Tags：灰底蓝边 Chip 组件，`×` 删除，输入框回车添加
- Abstract：可折叠面板，SVG chevron 箭头旋转动画
- Inline tags checkbox
- **Save Path 卡片**：灰色底 Monospace 字体，展示 `{subdir}/{safeTitle}.md` + `.pdf` 文件路径
- Save & Close / Cancel 按钮

### 4.4 background.js（Service Worker）

- `sanitizeFilename(title)`: 移除非法字符 `<>:"/\|?*`、空格替换为下划线、截断至 150 字符
- PDF 下载：直接传入 arXiv URL，Chrome 自行 fetch
- Markdown 下载：`encodeURIComponent` → `data:text/markdown;charset=utf-8,...` URI
- 文件名：`{saveSubdir}/{safeTitle}.pdf` + `{saveSubdir}/{safeTitle}.md`
- 通知：`chrome.notifications` 弹出保存成功消息
- Markdown 模板新增：
  - `notes: ""` 空字段（用户可在 Obsidian Properties 面板填写）
  - 顶部元数据用紧凑 key-value 格式（非表格，便于手动编辑）
  - `> [!tip]- Editing this page` 折叠 callout（非技术用户引导）
  - 历史记录用表格展示

### 4.5 options（设置页）

可配置项（存储于 `chrome.storage.local`）：
- `saveSubdir`：保存子目录（默认 `Papers/arxiv`）
- `defaultTags`：默认标签列表（默认 `["status/read"]`）
- `tagMappings`：arXiv 分类 → 标签映射表（可增删行）

## 5. 生成的 Markdown 格式

```markdown
---
title: "Attention Is All You Need"
author: "Ashish Vaswani, Noam Shazeer, ..."
year: 2017
venue: "NeurIPS 2017"
tags: [nlp/transformer, conf/neurips2017, status/read]
arxiv_id: "1706.03762"
doi: "10.5555/3295222.3295349"
pdf: "[[Attention_Is_All_You_Need.pdf]]"
notes: ""
---

# Attention Is All You Need

**Authors**: Ashish Vaswani, Noam Shazeer, Niki Parmar, ...
**Year**: 2017
**Venue**: NeurIPS 2017
**arXiv**: [1706.03762](https://arxiv.org/abs/1706.03762)
**PDF**: [[Attention_Is_All_You_Need.pdf]]
**DOI**: [10.5555/3295222.3295349](https://doi.org/10.5555/3295222.3295349)

## Abstract

The dominant sequence transduction models are based on complex recurrent...

---

## Details

| | |
|---|---|
| Subjects | cs.CL, cs.LG |
| Journal Ref | Advances in Neural Information Processing Systems 30 |
| License | CC BY 4.0 |

## Submission History

| Date | Event |
|---|---|
| 12 Jun 2017 | Submitted |
| 6 Dec 2017 | Revised (v2) |

---

> [!tip]- Editing this page
> Use the **Properties** panel (above) to modify tags, year, venue, or add reading notes.
> The sections below are auto-generated from arXiv metadata — edit freely.

#nlp/transformer #conf/neurips2017 #status/read
```

## 6. 安装与使用

1. Chrome → `chrome://extensions/` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `paper_one_step/`
2. Chrome 设置中将下载目录改为 Obsidian vault 内 papers 文件夹
3. 右键扩展图标 → 选项，配置子目录和默认标签
4. 打开 `arxiv.org/abs/xxx` → 点击扩展图标 → 编辑标签 → Save & Close

## 7. 已知限制

- Chrome `downloads` API 不支持写入任意绝对路径，需将浏览器下载目录设为 Obsidian vault
- 仅适配 `arxiv.org/abs/*` 页面，不支持其他论文网站
- PDF 下载失败时静默跳过，不阻塞 Markdown 生成

## 8. 版本历史

### v1.3 (2026-05-07)
- **修复**: 自动生成标签含空格/特殊字符导致 Obsidian 红灯 — 新增 `sanitizeTagName()` 统一清洗
- **架构变更**: Popup → Side Panel（`manifest.json` + `sidePanel` 权限），网页与面板互不遮挡
- **UI 适配**: CSS `width: 100%` 适配侧边栏；`extractCategories` 跳过 `.primary-subject` 人类可读名称
- **文档**: Callout 改为 Obsidian 标签规则说明；README 新增 `## Tag Format` 小节

### v1.2 (2026-05-07)
- **UI 重构**: Popup 全新设计（Slate 配色，Tailwind 风格，内联 SVG 图标，零 emoji）
- **路径预览**: Popup 底部展示 Save Path 卡片（{subdir}/{title}.md + .pdf）
- **Markdown 美化**: 顶部元数据改为紧凑 key-value 格式；Submission History 表格化
- **用户友好**: 新增 `notes: ""` frontmatter 字段 + `[!tip]` 折叠 editing callout
- **按钮文案**: 移除所有 emoji，统一英文简洁风格

### v1.1 (2026-05-07)
- **修复**: Markdown 下载失败 — `URL.createObjectURL` 在 Service Worker 中不可用，改为 `data:` URI
- **改进**: PDF/MD 文件名从 arXiv ID 改为论文标题（sanitize 后）
- **增强**: 新增 DOI、Journal Ref、License、Report No、Submission History 提取与展示

### v1.0 (2026-05-07)
- 初始版本：arXiv 页面元数据提取、标签 Chip UI、PDF+MD 下载

## 9. 后续可扩展方向

- [ ] 支持更多论文网站（OpenReview, OpenAlex, Semantic Scholar）
- [ ] 自定义 Markdown 模板（字符串插值）
- [ ] 标签自动补全（基于历史记录）
- [ ] 批量导出（搜索结果页多篇论文）
- [ ] Native Messaging 实现真正任意路径下载
- [ ] 暗色模式 UI
- [ ] i18n 多语言
- [ ] 自动检测 PDF 链接是否可达（HEAD 请求）
