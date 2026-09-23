---
title: 站点待办
description: 本站后续要做的功能与优化项清单，按优先级排列。
createdAt: '2026-09-11'
updatedAt: '2026-09-23'
tags: [项目, 待办, Astro]
isPinned: false
growthStage: seedling
---

## 待办

- [ ] 为笔记补充标签，让标签页有实际聚合效果。
- [ ] 增加「全部笔记」归档页，按更新时间排序。
- [ ] 检查移动端侧边栏抽屉的交互细节。
- [ ] 每个目录类别增加独立的汇总页，点开具体的文章后现在文章最上面的路径只能返回首页，显示的知识库、目录类别两个路径不能点击返回，需要完善功能。
- [ ] 后台管理系统增加功能，支持UI界面直接修改不能类别展示的顺序。
- [ ] 后台管理系统增加功能，支持UI界面进行管理员账号密码重命名，重置。
- [ ] 后台管理系统增加功能，支持浏览量、访客等相关信息的可视化查询与统计。

## 已完成

- [✅] 清空原有占位页面，改用 Astro + Veka 主题。
- [✅] 配置 GitHub Actions 自动构建并部署到 GitHub Pages。
- [✅] 绑定自定义域名 `qinquanquan.com` 并启用 HTTPS。
- [✅] 界面文案中文化。
- [✅] 增加后台管理系统，UI界面直接创作并发布文章，管理站点。

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
