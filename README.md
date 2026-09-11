# QinQuanQuan 的数字花园

基于 [Astro](https://astro.build) 与 Astro 官方免费主题 [Veka](https://astro.build/themes/details/veka/) 搭建的个人站点（数字花园 / 个人 Wiki）。

线上地址：<https://qinquanquan.com>

## 技术栈

- Astro 7（静态站点生成，Content Collections + Zod 校验）
- Tailwind CSS v4
- Pagefind（构建期生成本地全文搜索索引）
- GitHub Pages（GitHub Actions 自动部署）

## 本地开发

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动开发服务器 http://localhost:4321
pnpm build        # 构建静态站点到 dist/
pnpm preview      # 预览构建结果（搜索功能需先 build）
```

## 目录说明

```text
├── public/                     # 静态资源（favicon、robots.txt、CNAME、og-image）
├── src/
│   ├── assets/styles/          # 全局样式与正文排版
│   ├── components/             # 界面组件（header、搜索、卡片、UI 基础件）
│   ├── content/wiki/           # 全部 Markdown 笔记（目录即导航）
│   ├── layouts/                # BaseLayout / WikiLayout
│   ├── lib/
│   │   ├── site-config.ts      # 站点名称、域名、作者等元信息
│   │   └── wiki/labels.ts      # 目录与成长阶段的中文显示名
│   └── pages/                  # 首页、标签页与动态路由
├── astro.config.mjs
└── package.json
```

## 写一篇新笔记

1. 在 `src/content/wiki/` 下新建 `.md` 文件（可放在任意子目录，目录层级即 URL 层级）。
2. 填写 Frontmatter：

```yaml
---
title: "笔记标题"
description: "不超过 160 字的摘要"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["标签"]
isPinned: false
growthStage: "seedling"   # seedling | budding | evergreen
---
```

3. 正文用 Markdown 撰写，支持 `[[双链]]`、`==高亮==`、提示块与 KaTeX 公式。
4. 提交并推送到 `master`，GitHub Actions 会自动构建并发布。

## 常用配置位置

| 想改什么 | 改哪里 |
| --- | --- |
| 站点名称、描述、域名 | `src/lib/site-config.ts` |
| 目录中文名、成长阶段中文名 | `src/lib/wiki/labels.ts` |
| Frontmatter 字段规则 | `src/content.config.ts` |
| 构建、Markdown 插件 | `astro.config.mjs` |
| 部署流程 | `.github/workflows/deploy.yml` |

## 部署

推送到 `master` 分支后，`.github/workflows/deploy.yml` 会执行 `pnpm install --frozen-lockfile` 与 `pnpm build`，并把 `dist/` 发布到 GitHub Pages。

自定义域名由 `public/CNAME` 声明（`qinquanquan.com`），HTTPS 由 GitHub 自动签发。

## 许可

主题部分版权归 [Veka](https://github.com/masmuss/veka) 作者所有（MIT License）；站点内容版权归 QinQuanQuan 所有。
