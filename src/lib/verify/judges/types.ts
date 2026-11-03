import type { ActionItem, Judgment, Meeting, OwnerStatus } from "@/lib/types";

export type JudgeInput = { item: ActionItem; meeting: Meeting; owner: OwnerStatus };

export interface Judge {
  name: string;
  judge(input: JudgeInput): Promise<Judgment>;
}
