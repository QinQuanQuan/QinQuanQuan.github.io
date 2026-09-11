---
title: "写作与发布指南"
description: "笔记的目录约定、Frontmatter 字段说明，以及从本地预览到线上发布的完整流程。"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["指南", "写作", "流程"]
isPinned: true
growthStage: "budding"
---

这篇笔记记录本站的写作规范，避免时间久了以后忘了自己当初怎么定的规矩。

## 一、文件放哪儿

所有内容都在 `src/content/wiki/` 目录下，**文件夹层级就是 URL 层级**：

```text
src/content/wiki/
├── index.md                  →  /wiki
├── about/about-me.md         →  /wiki/about/about-me
├── guides/writing-guide.md   →  /wiki/guides/writing-guide
├── notes/astro-veka-setup.md →  /wiki/notes/astro-veka-setup
└── projects/site-roadmap.md  →  /wiki/projects/site-roadmap
```

新增目录不需要修改任何配置文件，侧边栏会自动出现对应分组。

## 二、Frontmatter 字段

每篇笔记开头必须包含以下字段（缺失会导致构建失败）：

```yaml
---
title: "笔记标题"
description: "一句话摘要，不超过 160 字，用于 SEO 与卡片描述"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["标签一", "标签二"]
isPinned: false
growthStage: "seedling"   # seedling | budding | evergreen
---
```

## 三、写作时常用语法

- 双链：`[[git-cheatsheet]]` → [[git-cheatsheet]]
- 高亮：`==重点内容==` → ==重点内容==
- 提示块：

> [!NOTE]
> 这是普通提示。

> [!WARNING]
> 这是需要小心的内容。

- 行内公式：$E = mc^2$

## 四、本地预览与发布

```bash
# 本地开发（搜索功能需要 build + preview 才有索引）
pnpm dev

# 构建静态站点到 dist/
pnpm build

# 预览构建结果
pnpm preview
```

发布流程：

1. 在 `src/content/wiki/` 下新增或修改 Markdown 文件。
2. 本地 `pnpm dev` 检查排版。
3. 提交并推送到 `master` 分支。
4. GitHub Actions 自动构建并部署到 GitHub Pages，约 1~2 分钟后线上生效。

## 相关笔记

- [[astro-veka-setup]]
- [[markdown-syntax]]
- [[site-roadmap]]
