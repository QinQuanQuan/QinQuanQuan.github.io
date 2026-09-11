import { folderLabel } from "./labels";

export type Breadcrumb = {
  label: string;
};

function humanize(segment: string): string {
  const known = folderLabel(segment);
  if (known !== segment) return known;

  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function generateBreadcrumbs(path: string): Breadcrumb[] {
  const segments = path.split("/").filter(Boolean);
  return segments.map((segment) => {
    const label = humanize(segment);
    return {
      label,
    };
  });
}
