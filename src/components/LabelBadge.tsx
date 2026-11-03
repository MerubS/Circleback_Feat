import { LABEL_TEXT, type Label } from "@/lib/types";

export const LABEL_STYLE: Record<Label, string> = {
  SUPPORTED: "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-900/40 dark:text-emerald-300",
  WEAK: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300",
  UNSUPPORTED: "bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-900/40 dark:text-rose-300",
  OWNER_NOT_CONFIRMED: "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-900/40 dark:text-violet-300",
};

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${LABEL_STYLE[label]}`}>
      {LABEL_TEXT[label]}
    </span>
  );
}

export function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
