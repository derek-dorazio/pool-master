import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Knows the theme's own letter spacing names, so `tracking-normal` replaces `tracking-eyebrow`. */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { tracking: [{ tracking: ["eyebrow", "label"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
