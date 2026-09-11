/**
 * 站点中文显示名映射。
 * 目录名保持英文（决定 URL），仅在界面上映射为中文标签。
 */
const FOLDER_LABELS: Record<string, string> = {
  wiki: "知识库",
  overview: "总览",
  notes: "笔记",
  projects: "项目",
  about: "关于",
  guides: "指南",
};

/** 把一个目录 slug 转成界面显示名；未收录的 slug 原样返回。 */
export function folderLabel(slug: string): string {
  return FOLDER_LABELS[slug.toLowerCase()] ?? slug;
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
