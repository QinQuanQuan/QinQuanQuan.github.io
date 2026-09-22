# 写作与发布指南（站内文档，不对外发布）

> 这份文档只存在于仓库里，供自己参考，**不会被构建到站点上**。
> 当初它作为一篇笔记发布过（`/wiki/guides/writing-guide`），
> 因为包含目录约定、部署细节等内部信息，已从站点下架并移到 `docs/` 目录。

## 一、文件放哪儿

对外发布的笔记全部在 `src/content/wiki/` 下，**文件夹层级就是 URL 层级**：

```text
src/content/wiki/
├── index.md                    →  /wiki（知识库首页 /「关于本站」）
├── notes/astro-veka-setup.md   →  /wiki/notes/astro-veka-setup
├── notes/git-cheatsheet.md     →  /wiki/notes/git-cheatsheet
└── projects/site-roadmap.md    →  /wiki/projects/site-roadmap
```

新增目录不需要改任何配置文件，站点侧边栏会自动出现对应分组。

不对外发布的内容（如本文件）放在 `docs/` 或仓库根目录，不会进入构建产物。

## 二、Frontmatter 字段

每篇笔记开头必须包含以下字段（缺失或格式不对会导致站点构建失败）：

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

- 双链：`[[git-cheatsheet]]`（按文件名解析，同名文件会冲突）
- 高亮：`==重点内容==`、上标 `^x^`、下标 `,,x,,`
- 提示块：

```markdown
> [!NOTE]
> 补充说明。

> [!TIP]
> 小技巧。

> [!WARNING]
> 需要注意的坑。
```

- 表格、代码块（构建期 Shiki 高亮）、KaTeX 公式（`$E = mc^2$` 或 `$$...$$`）

## 四、本地预览

```bash
cd /home/ubuntu/qinquanquan.github.io
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm install --frozen-lockfile
pnpm dev            # 开发服务器
pnpm build          # 构建到 dist/（搜索索引需要 build + preview）
pnpm preview
```

## 五、两种发布方式

### 1. 后台管理系统（日常推荐）

打开 <https://blogmanage.quanquantest.bond>（待 DNS 修正后为 `blogmanage.qinquanquan.com`），
登录后撰写 / 编辑 / 删除，点「发布到站点」即可。后台会通过 GitHub API 提交到 `master`，
GitHub Actions 自动重建站点，约 1~2 分钟生效。

### 2. 命令行提交

```bash
cd /home/ubuntu/blog-admin
GH_TOKEN=$(grep '^GITHUB_TOKEN=' .env | cut -d= -f2) \
python3 publish_files.py \
  "src/content/wiki/notes/new-note.md=/path/to/new-note.md" \
  --message "content: 新增《新笔记》"
```

注意：本机到 `github.com` 的 git 协议不稳定（`git push` 常报 TLS 断连），所以统一走 `api.github.com`，
不要在服务器上依赖 `git push`。

## 六、目录与显示名的约定

- 目录名用英文小写（决定 URL），界面上显示的中文名放在 `src/data/categories.json`，
  由 `src/lib/wiki/labels.ts` 读取；后台的「类别」页会维护这个文件。
- 类别下没有文章时，站点导航不会显示该类别（导航由文章生成）。

## 七、构建产物与部署

- 站点：Astro 7 静态站，构建产物在 `dist/`，由 `.github/workflows/deploy.yml` 发布到 GitHub Pages。
- 注意：`pnpm build` 需要约 1.5 分钟，且会生成 Pagefind 搜索索引；改动 Frontmatter 字段
  要同步 `src/content.config.ts` 的 Zod 校验。
