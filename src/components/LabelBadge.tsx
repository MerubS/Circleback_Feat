import { OWNER_TEXT, TASK_TEXT, type OwnerStatus, type TaskStatus } from "@/lib/types";

const base = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";
const green = "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-900/40 dark:text-emerald-300";
const amber = "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300";
const red = "bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-900/40 dark:text-rose-300";
const violet = "bg-violet-100 text-violet-800 ring-violet-600/20 dark:bg-violet-900/40 dark:text-violet-300";
const grey = "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400";

export const TASK_STYLE: Record<TaskStatus, string> = { SUPPORTED: green, WEAK: amber, UNSUPPORTED: red, CONTRADICTED: red, NOT_CHECKED: grey };
export const OWNER_STYLE: Record<OwnerStatus, string> = {
  CONFIRMED: green,
  WEAK: amber,
  NOT_ACKNOWLEDGED: violet,
  DECLINED: violet,
  SOMEONE_ELSE: red,
  UNIDENTIFIED: violet,
  NOT_IN_MEETING: violet,
  NO_OWNER: grey,
  NOT_APPLICABLE: grey,
};

export function TaskBadge({ task }: { task: TaskStatus }) {
  return <span className={`${base} ${TASK_STYLE[task]}`}>Task: {TASK_TEXT[task]}</span>;
}

export function OwnerBadge({ owner }: { owner: OwnerStatus }) {
  if (owner === "NOT_APPLICABLE") return null;
  return <span className={`${base} ${OWNER_STYLE[owner]}`}>{OWNER_TEXT[owner]}</span>;
}

/** Fine as-is: real task, the owner took it on (or nobody was named), and nothing flagged (owner fix, due date, ...). */
export function isClean(task: TaskStatus, owner: OwnerStatus, flagged = false) {
  return task === "SUPPORTED" && (owner === "CONFIRMED" || owner === "NO_OWNER") && !flagged;
}

export function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
