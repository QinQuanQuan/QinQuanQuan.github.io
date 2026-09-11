---
title: "站点待办"
description: "本站后续要做的功能与优化项清单，按优先级排列。"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["项目", "待办", "Astro"]
isPinned: false
growthStage: "seedling"
---

## 待办

- [ ] 替换站点图标与社交分享图（`public/favicon.svg`、`public/og-image.png`）。
- [ ] 在 `src/lib/site-config.ts` 中把站点名和描述改成最终版本。
- [ ] 为笔记补充标签，让标签页有实际聚合效果。
- [ ] 增加「全部笔记」归档页，按更新时间排序。
- [ ] 检查移动端侧边栏抽屉的交互细节。

## 已完成

- [x] 清空原有占位页面，改用 Astro + Veka 主题。
- [x] 配置 GitHub Actions 自动构建并部署到 GitHub Pages。
- [x] 绑定自定义域名 `qinquanquan.com` 并启用 HTTPS。
- [x] 界面文案中文化。

## 备注

主题升级时要留意的文件：

- `astro.config.mjs`：集成与 Markdown 插件配置。
- `src/content.config.ts`：Frontmatter 的 Zod 校验规则，改动会导致旧笔记构建失败。
- `src/lib/wiki/labels.ts`：目录与成长阶段的中文显示名映射。

> [!NOTE]
> 部署相关的问题优先看仓库的 Actions 运行记录：构建失败会直接在日志里指出是哪一篇笔记的 Frontmatter 不合法。

## 相关笔记

- [[astro-veka-setup]]
- [[digital-garden]]
- [[writing-guide]]
