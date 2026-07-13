import type { ActiveModal } from "../controller/useGameController";
import { CombatModal } from "./CombatModal";
import { DialogueModal } from "./DialogueModal";
import { EquipmentModal } from "./EquipmentModal";
import { ItemModal } from "./ItemModal";
import { MarketModal } from "./MarketModal";
import type { GameModalContext } from "./modalTypes";

export interface GameModalContentProps extends GameModalContext {
  modal: ActiveModal;
}

export function GameModalContent({ modal, ...context }: GameModalContentProps) {
  switch (modal.type) {
    case "equipment":
      return <EquipmentModal context={context} item={modal.item} />;
    case "item":
      return <ItemModal item={modal.item} closeModal={context.closeModal} />;
    case "market":
      return <MarketModal context={context} />;
    case "dialogue":
      return <DialogueModal context={context} />;
    case "combat":
      return <CombatModal state={context.state} closeModal={context.closeModal} />;
    default:
      return null;
  }
}
