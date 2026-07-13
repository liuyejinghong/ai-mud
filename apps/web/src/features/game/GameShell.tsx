import { CHARACTER_CLASSES, type CharacterClassId } from "@ai-mud/shared";
import { useGameController } from "./controller/useGameController";
import { GameHud } from "./layout/GameHud";
import { GameModalContent } from "./modals/GameModalContent";
import { ModalManager } from "./ui/ModalManager";
import "./GameShell.css";

interface GameShellProps {
  csrfToken: string;
  onAuthExpired?: () => void;
  onLogout?: () => Promise<void>;
}

export function GameShell({ csrfToken, onAuthExpired, onLogout }: GameShellProps) {
  const controller = useGameController({
    csrfToken,
    ...(onAuthExpired ? { onAuthExpired } : {}),
    ...(onLogout ? { onLogout } : {})
  });

  if (!controller.state.character) {
    return (
      <main className="game-shell game-shell-authenticated">
        <section className="game-create-panel" aria-labelledby="create-character-title">
          <p className="game-kicker">黑松哨站户籍簿</p>
          <h1 id="create-character-title">创建角色</h1>
          <p className="game-copy">
            黑松哨站只记录一个常驻身份。后续职业、装备、经济和 NPC 记忆都会挂在这个角色上。
          </p>

          <label className="game-field" htmlFor="character-name">
            角色名
            <input
              id="character-name"
              value={controller.name}
              maxLength={24}
              onChange={(event) => controller.setName(event.target.value)}
            />
          </label>

          <label className="game-field" htmlFor="character-class">
            职业
            <select
              id="character-class"
              value={controller.classId}
              onChange={(event) => controller.setClassId(event.target.value as CharacterClassId)}
            >
              {CHARACTER_CLASSES.map((characterClass) => (
                <option key={characterClass.id} value={characterClass.id}>
                  {characterClass.name}
                </option>
              ))}
            </select>
          </label>

          <p className="class-brief">{controller.view.selectedClass?.description}</p>

          <button
            type="button"
            className="game-primary-button"
            disabled={controller.isBusy}
            onClick={() => void controller.commands.createCharacter()}
          >
            进入世界
          </button>

          {controller.error ? <p role="alert" className="game-error">{controller.error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <GameHud controller={controller} onLogoutAvailable={Boolean(onLogout)} />
      <ModalManager activeModal={controller.activeModal} onClose={controller.commands.closeModal}>
        {(modal, closeModal) => (
          <GameModalContent
            modal={modal}
            state={controller.state}
            market={controller.market}
            marketStatus={controller.marketStatus}
            dialogueTargets={controller.dialogueTargets}
            dialogue={controller.dialogue}
            dialogueInput={controller.dialogueInput}
            onDialogueInputChange={controller.setDialogueInput}
            dialogueStatus={controller.dialogueStatus}
            isBusy={controller.isBusy}
            canInteractWithTasks={controller.view.canInteractWithTasks}
            canRepairEquipment={controller.view.canRepairEquipment}
            canEquipEquipment={controller.view.canEquipEquipment}
            commands={controller.commands}
            closeModal={closeModal}
          />
        )}
      </ModalManager>
    </main>
  );
}
