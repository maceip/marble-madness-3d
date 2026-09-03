import { StageDef } from '../engine/level';
import { stage1 } from './stage1';

export const STAGES: StageDef[] = [stage1];

export function stageById(id: number): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}
