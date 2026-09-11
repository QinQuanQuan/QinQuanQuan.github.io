---
title: "Git 常用命令速查"
description: "日常开发中最常用的一组 Git 命令：分支、回退、暂存、查看历史与远程操作。"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["Git", "速查", "工具"]
isPinned: false
growthStage: "evergreen"
---

## 日常提交

```bash
git status                 # 查看当前改动
git add -p                 # 交互式挑选要提交的代码块
git commit -m "feat: 新增笔记列表页"
git push origin master
```

## 分支操作

```bash
git switch -c feature/search    # 新建并切换分支
git switch master               # 切回主分支
git merge --no-ff feature/search
git branch -d feature/search    # 删除已合并分支
```

## 查看历史

```bash
git log --oneline --graph --decorate -20
git log -p -- src/content/wiki  # 只看某个目录的改动
git blame src/lib/site-config.ts
```

## 回退与撤销

| 场景 | 命令 |
| --- | --- |
| 撤销工作区改动 | `git restore <file>` |
| 取消暂存 | `git restore --staged <file>` |
| 修改最近一次提交信息 | `git commit --amend` |
| 回退提交但保留改动 | `git reset --soft HEAD~1` |
| 安全撤销已推送的提交 | `git revert <commit>` |

> [!WARNING]
> `git reset --hard` 会丢弃未提交的改动，执行前先用 `git stash` 或确认 `git status` 是干净的。

## 远程与部署

```bash
git remote -v
git fetch --prune
git push origin master      # 本站推送到 master 后会自动触发 Pages 部署
```

## 相关笔记

- [[writing-guide]]
- [[astro-veka-setup]]
- [[markdown-syntax]]
