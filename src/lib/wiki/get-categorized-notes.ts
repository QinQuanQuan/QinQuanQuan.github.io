import { getCollection } from "astro:content";
import categoryOrder from "@/data/category-order.json";

export interface CategorizedNote {
  name: string;
  notes: Array<{
    id: string;
    title: string;
    description: string;
    growthStage: string;
    updatedAt: Date;
  }>;
}

/** 首页分组的显示顺序，来自 src/data/category-order.json（后台「类别」页可改） */
const ORDER: string[] = categoryOrder as string[];

function getCategory(noteId: string): string {
  return noteId === "index" ? "overview" : noteId.split("/")[0];
}

function byUpdatedAtDesc(
  a: { updatedAt: Date },
  b: { updatedAt: Date },
): number {
  return b.updatedAt.valueOf() - a.updatedAt.valueOf();
}

/** 先按配置里的顺序，未配置的分组排在后面并按目录名字母序 */
function byCategoryOrder(a: { name: string }, b: { name: string }): number {
  const ai = ORDER.indexOf(a.name);
  const bi = ORDER.indexOf(b.name);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.name.localeCompare(b.name);
}

export async function getCategorizedNotes(): Promise<CategorizedNote[]> {
  const allNotes = await getCollection("wiki");

  const grouped = allNotes.reduce(
    (acc, note) => {
      const category = getCategory(note.id);
      if (!acc[category]) acc[category] = [];
      acc[category].push({
        id: note.id,
        title: note.data.title,
        description: note.data.description || "",
        growthStage: note.data.growthStage || "",
        updatedAt: note.data.updatedAt,
      });
      return acc;
    },
    {} as Record<string, CategorizedNote["notes"]>,
  );

  return Object.entries(grouped)
    .map(([name, notes]) => ({
      name,
      notes: notes.sort(byUpdatedAtDesc),
    }))
    .sort(byCategoryOrder);
}
