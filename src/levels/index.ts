import { StageDef } from '../engine/level';
import { stage1 } from './stage1';
import { stage2 } from './stage2';
import { stage3 } from './stage3';
import { stage4 } from './stage4';
import { stage5 } from './stage5';
import { stage6 } from './stage6';

export const STAGES: StageDef[] = [stage1, stage2, stage3, stage4, stage5, stage6];

export function stageById(id: number): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}
