---
title: "Markdown 速查"
description: "本站在用的 Markdown 与扩展语法速查：标题、表格、代码块、提示块、双链与公式。"
createdAt: 2026-09-11
updatedAt: 2026-09-11
tags: ["Markdown", "速查", "写作"]
isPinned: false
growthStage: "evergreen"
---

写笔记时最常用的一些语法，随手记一份，省得每次都去翻文档。

## 标题与强调

```markdown
# 一级标题（页面内一般用不到，标题由 Frontmatter 提供）
## 二级标题（会出现在右侧目录）
### 三级标题

**加粗**、*斜体*、~~删除线~~、`行内代码`
```

高亮与上下标是本主题的扩展语法：

```markdown
==高亮文本==  ^上标^  ,,下标,,
```

效果：==高亮文本==、^上标^、,,下标,,

## 列表与表格

```markdown
- 无序列表
1. 有序列表

| 列 A | 列 B |
| --- | --- |
| a1  | b1  |
```

## 代码块

使用三反引号并标注语言，构建期会用 Shiki 高亮（支持深浅色两套主题）：

```javascript
const notes = await getCollection("wiki");
console.log(`共 ${notes.length} 篇笔记`);
```

## 提示块

```markdown
> [!NOTE]
> 补充说明。

> [!TIP]
> 小技巧。

> [!WARNING]
> 需要注意的坑。
```

> [!TIP]
> 提示块语法来自 `remark-github-blockquote-alert` 插件，等价于 GitHub 上的告警块。

## 双链与数学

- 双链：`[[git-cheatsheet]]` → [[git-cheatsheet]]
- 行内公式：`$E = mc^2$` → $E = mc^2$
- 块级公式：

$$
\int_{0}^{1} x^2 \, dx = \frac{1}{3}
$$

## 相关笔记

- [[writing-guide]]
- [[git-cheatsheet]]
- [[astro-veka-setup]]
