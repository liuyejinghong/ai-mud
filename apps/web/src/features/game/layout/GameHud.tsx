import { useState } from "react";
import type { StartGatheringRequestDto } from "@ai-mud/shared";
import {
  selectAvailablePrimaryActions,
  type PrimaryAction
} from "../controller/gameSelectors";
import type { GameController } from "../controller/useGameController";
import { ActionPanel } from "../panels/ActionPanel";
import { AuxiliaryPanel, type AuxiliaryPanelTab } from "../panels/AuxiliaryPanel";
import { CharacterStatusPanel } from "../panels/CharacterStatusPanel";
import { EquipmentPanel } from "../panels/EquipmentPanel";
import { EventLogPanel } from "../panels/EventLogPanel";
import { InventoryPanel } from "../panels/InventoryPanel";
import { LobbyPanel } from "../panels/LobbyPanel";
import { ScenePanel } from "../panels/ScenePanel";
import { TaskTrackerPanel } from "../panels/TaskTrackerPanel";
import { TutorialGuide } from "../ui/TutorialGuide";

interface GameHudProps {
  controller: GameController;
  onLogoutAvailable: boolean;
}

function isFoodItem(itemId: string) {
  return itemId === "wild_berry" || itemId === "beast_meat";
}

function runPrimaryAction(
  actionId: PrimaryAction["id"],
  controller: GameController
) {
  const { commands } = controller;
  switch (actionId) {
    case "claim_relief":
      return commands.claimRelief();
    case "enter_corrupt_forest":
      return commands.enterCorruptForest();
    case "enter_old_mine":
      return commands.enterOldMine();
    case "gather":
    case "start_gathering":
      return commands.startGathering();
    case "start_combat":
      return commands.startCombat();
    case "cancel_action":
      return commands.cancelAction();
    case "return_to_village":
      return commands.returnToVillage();
    case "open_market":
      return commands.openMarket();
    case "view_npc_tasks":
      return commands.openDialogue();
    case "repair_equipment":
      return commands.repairAllEquipment();
    default:
      return Promise.resolve();
  }
}

export function GameHud({ controller, onLogoutAvailable }: GameHudProps) {
  const {
    state,
    view,
    lobby,
    lobbyTab,
    setLobbyTab,
    chatInput,
    setChatInput,
    chatStatus,
    isChatSending,
    syncNotices,
    offlineReport,
    plannedMinutes,
    setPlannedMinutes,
    error,
    isBusy,
    sync,
    commands
  } = controller;
  const [auxiliaryTab, setAuxiliaryTab] = useState<AuxiliaryPanelTab>("map");
  const [isAuxiliaryOpen, setIsAuxiliaryOpen] = useState(false);

  if (!state.character) return null;

  const actions = selectAvailablePrimaryActions(state);
  const positionText = view.location.positionText;

  const handleAction = (actionId: PrimaryAction["id"]) =>
    runPrimaryAction(actionId, controller);

  return (
    <>
      <aside className="game-column game-character-panel" aria-label="角色状态">
        <CharacterStatusPanel
          character={state.character}
          hungerWarning={view.hungerWarning}
          isLogoutDisabled={isBusy}
          {...(onLogoutAvailable ? { onLogout: commands.endSession } : {})}
        />
        <EquipmentPanel
          equipment={state.equipment}
          canRepair={view.canRepairEquipment && view.damagedEquipment.length > 0}
          onSelectEquipment={commands.openEquipment}
          onRepairAll={commands.repairAllEquipment}
        />
        <InventoryPanel
          items={state.inventory}
          backpackEquipment={state.backpackEquipment}
          canEatFood={view.canEatFood}
          onSelectItem={commands.openItem}
          onSelectEquipment={commands.openEquipment}
          onEatItem={(item) =>
            isFoodItem(item.itemId) ? commands.eatFood(item.itemId) : undefined
          }
        />
        <LobbyPanel
          chatMessages={lobby.chat}
          presence={lobby.presence}
          levelLeaderboard={lobby.leaderboards.level}
          wealthLeaderboard={lobby.leaderboards.wealth}
          activeTab={lobbyTab}
          chatInput={chatInput}
          chatStatus={chatStatus}
          isChatSending={isChatSending}
          isSyncing={sync.isSyncing}
          onTabChange={setLobbyTab}
          onChatInputChange={setChatInput}
          onSubmitChat={commands.submitLobbyChat}
        />
      </aside>

      <section className="game-main-panel" aria-label="场景与行动">
        <button
          type="button"
          className="auxiliary-toggle"
          aria-controls="auxiliary-panel"
          aria-expanded={isAuxiliaryOpen}
          onClick={() => setIsAuxiliaryOpen((open) => !open)}
        >
          地图与信息
        </button>
        <ScenePanel
          locationTitle={view.location.title}
          locationDescription={view.location.description}
          positionText={positionText}
          sceneObjects={view.sceneObjects}
          contextualObjective={view.nextStep}
        />
        <TutorialGuide
          characterId={state.character.id}
          state={{ ...state, character: state.character }}
        />
        <ActionPanel
          actions={actions}
          currentAction={state.currentAction}
          plannedMinutes={plannedMinutes}
          onPlannedMinutesChange={
            (minutes: StartGatheringRequestDto["plannedMinutes"]) => setPlannedMinutes(minutes)
          }
          onAction={handleAction}
          {...(view.canOpenDialogue ? { onOpenDialogue: commands.openDialogue } : {})}
          onOpenCombat={commands.openCombat}
          disabled={isBusy}
        />
        <TaskTrackerPanel
          tasks={view.acceptedTasks}
          inventory={state.inventory}
          canOpenDialogue={view.canOpenDialogue}
          onOpenDialogue={commands.openDialogue}
        />
        {syncNotices.length > 0 ? (
          <ul className="sync-feedback-list" aria-live="polite" aria-label="同步事件提示">
            {syncNotices.map((notice) => (
              <li className={`sync-feedback-item is-${notice.tone}`} key={notice.id}>
                {notice.text}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p role="alert" className="game-error">{error}</p> : null}
        <EventLogPanel entries={view.recentLog} totalEntryCount={state.log.length} />
      </section>

      <AuxiliaryPanel
        map={state.map}
        rumors={state.rumors}
        offlineReport={offlineReport}
        activeTab={auxiliaryTab}
        onActiveTabChange={setAuxiliaryTab}
        canMove={view.canMove}
        onMove={commands.move}
        isOpen={isAuxiliaryOpen}
        onClose={() => setIsAuxiliaryOpen(false)}
      />
    </>
  );
}
