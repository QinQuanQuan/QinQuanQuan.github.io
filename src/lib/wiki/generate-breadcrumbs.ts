import { folderLabel } from "./labels";

export type Breadcrumb = {
  label: string;
  /** 可点击的上级路径；当前页（最后一段）没有 href */
  href?: string;
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
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    return {
      label: humanize(segment),
      href: isLast
        ? undefined
        : "/" + segments.slice(0, index + 1).join("/"),
    };
  });
}
