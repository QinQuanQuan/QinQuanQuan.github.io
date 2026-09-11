# 站点重建操作日志

- **时间**：2026-09-11（CST，UTC+08:00）
- **仓库**：`QinQuanQuan/QinQuanQuan.github.io`（用户站点仓库）
- **线上地址**：<https://qinquanquan.com>（`www.qinquanquan.com` → 301 跳转到主域名）
- **执行方式**：Hermes Agent 在本机完成搭建、构建、推送与部署验证

---

## 一、目标

把原本只有占位页的 GitHub Pages 用户站点，重建为基于 Astro 与 Astro 官方主题库中的免费主题
[Veka](https://astro.build/themes/details/veka/) 的个人站点，并放置适量的中文占位文章。

## 二、主题确认

| 项目 | 结果 |
| --- | --- |
| 主题名称 | Veka（"The Minimalist Digital Garden & Wiki Starter for Astro"） |
| 是否在 Astro 官方主题库 | 是，`https://astro.build/themes/details/veka/`（页面 200，作者 Khoirul） |
| 上游仓库 | `https://github.com/masmuss/veka` |
| 协议 | MIT |
| 上游版本 | 1.2.0（Astro 7 + Tailwind CSS v4 + Pagefind） |

## 三、环境准备

| 组件 | 版本 / 说明 |
| --- | --- |
| Node.js | v22.23.2（满足主题要求 `>=22.12.0`） |
| pnpm | 12.3.4（全局 npm 目录无写权限，改用 `npm config set prefix ~/.npm-global` 安装） |
| 系统 | Linux，Google Chrome 用于无头截图验收 |

### 环境层面的两个坑

1. 上游模板把 `packageManager` 锁定为 `pnpm@11.13.0`，而该版本被 pnpm 自身判定为
   损坏发布（`ERR_PNPM_BROKEN_PNPM_RELEASE`），无法安装。
   → 已把 `package.json` 的 `packageManager` 改为 `pnpm@12.3.4`，并新增 `.npmrc`
   （`manage-package-manager-versions=false`）避免再次被锁定版本劫持。
2. 本机到 `github.com` 的 git 传输层不稳定（`ls-remote` 正常，但 `fetch`/`push` 反复出现
   GnuTLS 断连；token 写入 URL 时同样被中断）。
   → 推送环节改用 **GitHub REST API**（blob → tree → commit → 更新 ref）完成，
   等价于一次普通 `git push`。

## 四、站点定制内容

### 4.1 元信息

`src/lib/site-config.ts`：

```ts
name: "QinQuanQuan"
title: "QinQuanQuan 的数字花园"
description: "一个持续生长的个人知识库：记录笔记、项目与随想。"
url: "https://qinquanquan.com"
author: "QinQuanQuan"
```

### 4.2 界面中文化

| 文件 | 改动 |
| --- | --- |
| `src/components/Header.astro` | 搜索按钮、移动端导航 aria 标签 |
| `src/components/search/Search.astro` | 搜索框占位符、提示文案 |
| `src/lib/search/search-client.ts` | 结果计数、无结果提示 |
| `src/components/wiki/WikiHeader.astro` | 面包屑「首页」、更新时间格式（zh-CN）、下载按钮、面包屑末级改为笔记标题 |
| `src/components/wiki/WikiSidebarRight.astro` | 「本页目录」「标签」 |
| `src/components/wiki/NoteCard.astro` | 成长阶段徽章中文化 |
| `src/components/wiki/WikiNav.astro` | 侧边栏目录名中文化 |
| `src/pages/index.astro` | 首页文案、分组标题「N 篇笔记」「浏览全部标签」 |
| `src/pages/tags/index.astro`、`src/pages/tag/[tag].astro` | 标签页文案 |
| `src/lib/wiki/labels.ts`（新增） | 目录名与成长阶段的中文映射表 |
| `src/lib/wiki/generate-breadcrumbs.ts` | 面包屑复用中文映射 |
| `src/lib/seo.ts` | 移除英文描述补全文案，改为中文，并把描述最小长度阈值从 120 调整为 60 |
| `src/layouts/BaseLayout.astro` | `lang="zh-CN"` |

目录名保持英文（决定 URL），仅在界面上映射为中文，便于以后迁移。

### 4.3 占位文章（9 篇）

```text
src/content/wiki/
├── index.md                        首页（置顶，常青）
├── about/about-me.md               关于本站
├── guides/writing-guide.md         写作与发布指南（置顶）
├── notes/astro-veka-setup.md       用 Astro + Veka 搭建本站（置顶）
├── notes/markdown-syntax.md        Markdown 速查
├── notes/git-cheatsheet.md         Git 常用命令速查
├── notes/reading-list.md           待读清单
├── projects/digital-garden.md      数字花园计划
└── projects/site-roadmap.md        站点待办
```

内容覆盖了主题的主要特性：双链 `[[…]]`、提示块、表格、代码高亮、KaTeX 公式、标签聚合、成长阶段徽章。
原主题自带的 21 篇演示笔记（Trak 项目、Go / React 相关）已全部删除。

### 4.4 其它

- 新增 `public/CNAME`（`qinquanquan.com`）、更新 `public/robots.txt` 的 Sitemap 地址。
- 新增 `public/og-image.png`（1200×630，社交分享图，脚本 `scripts/make-og-image.py` 可重新生成）。
- 删除主题自带的 3 张预览图与发布自动化（semantic-release / commitlint / lefthook / 原 `ci.yml`）。
- 重写 `README.md`，说明目录结构、写作流程、常用配置位置。

## 五、部署配置

1. 仓库 Pages 的构建方式由 `legacy`（master 分支根目录）改为 **`workflow`**：
   `PUT /repos/QinQuanQuan/QinQuanQuan.github.io/pages {"build_type":"workflow"}`
   自定义域名 `qinquanquan.com` 与 HTTPS 强制保持不变。
2. 新增 `.github/workflows/deploy.yml`：`master` 分支推送后自动
   `pnpm install --frozen-lockfile` → `pnpm build` → 上传 `dist/` → 发布到 GitHub Pages。
3. 发布流程：
   - 先把原 `master`（占位页提交 `d83a3dc1`）备份为分支 `backup/placeholder-site`；
   - 再以该提交为父提交创建新提交 `ca8ff49c`（tree 只含新站点文件，旧占位内容全部消失），
     因此**历史得以保留，且未做强制覆盖**。

## 六、验收记录

### 本地构建

- `pnpm build` 成功，产出 28 个页面，Pagefind 收录 28 个页面。
- 无头 Chrome 截图检查：首页、笔记页、标签页、知识库首页排版正常，无乱码、无残留英文文案。

### 线上验证（部署后）

| 检查项 | 结果 |
| --- | --- |
| `https://qinquanquan.com/` | 200，标题「QinQuanQuan 的数字花园 - 首页」，`lang="zh-CN"` |
| `https://www.qinquanquan.com/` | 301 → `https://qinquanquan.com/`（跟随跳转后 200） |
| `/wiki/`、`/wiki/notes/…/`、`/tags/` | 均 200 |
| `/pagefind/pagefind.js` | 200（搜索索引已部署） |
| `/robots.txt`、`/og-image.png`、`/sitemap-index.xml` | 均 200 |
| `/README.md`、`/.nojekyll`（旧占位文件） | 404，确认旧内容已清除 |
| Actions 运行 #1「Deploy to GitHub Pages」 | build 与 deploy 两个 job 全部成功 |
| 分支状态 | `master = ca8ff49c`，`backup/placeholder-site = d83a3dc1` |

## 七、遗留事项与建议

1. **请立即撤销本次使用的 GitHub Personal Access Token**：它在对话中以明文出现，
   且具备 `repo`、`workflow` 等写权限。撤销入口：GitHub → Settings → Developer settings → Tokens。
2. 站点名 `QinQuanQuan`、描述与作者名目前使用 GitHub 用户名占位，可在
   `src/lib/site-config.ts` 里替换为最终版本。
3. `public/favicon.svg`、`public/favicon.ico` 仍是主题自带的图标，建议替换为个人图标。
4. 后续只需在 `src/content/wiki/` 下增删 Markdown 文件并推送到 `master`，站点会自动重建。
5. 若确认不再需要旧的占位页，可删除 `backup/placeholder-site` 分支。
