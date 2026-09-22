import customCategories from "@/data/categories.json";

/**
 * 站点中文显示名映射。
 * 目录名保持英文（决定 URL），仅在界面上映射为中文标签。
 *
 * 用户自定义类别的中文名放在 src/data/categories.json，
 * 后台管理系统（blog-admin）会读写这个文件，因此这里优先读取它。
 */
const FOLDER_LABELS: Record<string, string> = {
  wiki: "知识库",
  overview: "总览",
};

const categories = customCategories as Record<string, string>;

/** 把一个目录 slug 转成界面显示名；未收录的 slug 原样返回。 */
export function folderLabel(slug: string): string {
  const key = slug.toLowerCase();
  return categories[key] ?? FOLDER_LABELS[key] ?? slug;
}

/** 笔记成长阶段（growthStage）的中文显示名。 */
const GROWTH_STAGE_LABELS: Record<string, string> = {
  seedling: "幼苗",
  budding: "生长中",
  evergreen: "常青",
};

export function growthStageLabel(stage: string): string {
  return GROWTH_STAGE_LABELS[stage] ?? stage;
}
