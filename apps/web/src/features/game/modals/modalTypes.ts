import type {
  EquipmentItemDto,
  GameStateDto,
  MarketDto,
  NpcDialogueResponseDto,
  NpcDialogueTargetDto
} from "@ai-mud/shared";
import type { GameControllerCommands } from "../controller/useGameController";

export interface GameModalContext {
  state: GameStateDto;
  market: MarketDto | null;
  marketStatus: string | null;
  dialogueTargets: readonly NpcDialogueTargetDto[];
  dialogue: NpcDialogueResponseDto | null;
  dialogueInput: string;
  onDialogueInputChange: (value: string) => void;
  dialogueStatus: string;
  isBusy: boolean;
  canInteractWithTasks: boolean;
  canRepairEquipment: boolean;
  canEquipEquipment: boolean;
  commands: GameControllerCommands;
  closeModal: () => void;
}

export interface EquipmentModalProps {
  context: GameModalContext;
  item: EquipmentItemDto;
}
