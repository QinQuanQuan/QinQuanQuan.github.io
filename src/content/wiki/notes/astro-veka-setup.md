---
title: "用 Astro + Veka 搭建本站"
description: "记录本站的技术选型与搭建过程：Astro 静态站点、Veka 主题、GitHub Pages 自动化部署。"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["Astro", "Veka", "建站"]
isPinned: true
growthStage: "budding"
---

## 为什么是 Astro

挑框架的时候只看了三条：构建产物要纯静态、默认不带客户端 JavaScript、Markdown 支持要好。Astro 三条都满足，而且内容集合（Content Collections）自带 Zod 校验，写错 Frontmatter 会直接在构建时报错，而不是悄悄生成一个坏页面。

## 为什么是 Veka

[Veka](https://astro.build/themes/details/veka/) 是 Astro 官方主题库里的免费模板，定位是「极简数字花园 / 个人 Wiki」：

- **零配置路由**：目录即导航。
- **本地搜索**：基于 Pagefind，构建期生成索引。
- **双链语法**：`[[笔记名]]` 在构建期解析成站内链接。
- **成长阶段**：每篇笔记可以标记 `seedling / budding / evergreen`。

对个人站点来说，这些功能刚好够用，而且没有多余的东西。

## 项目结构

```text
├── public/                  # 静态资源（favicon、CNAME、robots.txt）
├── src/
│   ├── components/          # 组件（header、搜索、卡片、UI 基础件）
│   ├── content/wiki/        # 所有 Markdown 笔记
│   ├── layouts/             # BaseLayout / WikiLayout
│   ├── lib/
│   │   ├── site-config.ts   # 站点名称、域名、作者等配置
│   │   └── wiki/labels.ts   # 中文显示名映射
│   └── pages/               # 首页、标签页、动态路由
├── astro.config.mjs
└── package.json
```

## 部署到 GitHub Pages

因为仓库名是 `<用户名>.github.io`，它天然就是 GitHub Pages 的**用户站点**仓库。部署方式为 GitHub Actions：推送到 `master` 后自动执行 `pnpm build`，把 `dist/` 目录发布到 Pages。

自定义域名通过 `public/CNAME` 文件声明，DNS 侧把 `qinquanquan.com` 与 `www.qinquanquan.com` 都解析到 GitHub Pages，证书由 GitHub 自动签发并强制 HTTPS。

> [!NOTE]
> 站点名、域名、作者等元信息统一在 `src/lib/site-config.ts` 中修改，改完重新构建即可，不需要动模板代码。

## 踩坑记录

1. 主题模板把包管理器锁定为某个特定 pnpm 版本，本地安装时需要换成可用版本（已在 `package.json` 中更新 `packageManager` 字段）。
2. 构建产物必须包含 `.nojekyll` 或使用 Actions 部署，否则以下划线开头的资源目录会被 Jekyll 忽略。

## 相关笔记

- [[writing-guide]]
- [[site-roadmap]]
- [[about-me]]
