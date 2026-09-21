import { newCommandId } from "../../../lib/uuid.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type ChatMessageDto,
  type Direction,
  type EquipmentItemDto,
  type GameStateDto,
  type GameSyncEventDto,
  type GameSyncResponseDto,
  type InventoryItemDto,
  type LeaderboardEntryDto,
  type MarketDto,
  type MarketTradeRequestDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type OfflineReportDto,
  type PresenceDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import {
  acceptNpcTask,
  buyMarketItem,
  cancelAction,
  claimMunicipalRelief,
  completeNpcTask,
  createCharacter,
  eatFood,
  enterCorruptForest,
  enterOldMine,
  equipEquipment,
  GameApiError,
  getGameSync,
  getMarket,
  getNpcDialogue,
  heartbeatPresence,
  listDialogueTargets,
  move,
  repairAllEquipment,
  repairEquipment,
  returnToVillage,
  sellMarketItem,
  sendLobbyChat,
  sendNpcDialogueMessage,
  startCombat,
  startGathering
} from "../gameApi";
import {
  selectContextualObjective,
  selectRecentLog,
  selectSceneObjects,
  type SceneObject
} from "./gameSelectors";
import { dispatchHotkey, getInputContextScopes } from "../input/InputContext";
import { HotkeyRegistry } from "../input/HotkeyRegistry";
import { useGameSync } from "../sync/useGameSync";

export type ActiveModal =
  | { type: "item"; item: InventoryItemDto }
  | { type: "equipment"; item: EquipmentItemDto }
  | { type: "market" }
  | { type: "dialogue" }
  | { type: "combat" };

export type LobbyTab = "chat" | "online" | "leaderboard";

export interface LobbyState {
  chat: ChatMessageDto[];
  presence: PresenceDto[];
  leaderboards: {
    level: LeaderboardEntryDto[];
    wealth: LeaderboardEntryDto[];
  };
}

export interface SyncNotice {
  id: string;
  tone: "loot" | "rare" | "level";
  text: string;
}

export interface GameControllerView {
  isModalOpen: boolean;
  canMove: boolean;
  canGather: boolean;
  canStartCombat: boolean;
  canCancelAction: boolean;
  canReturnVillage: boolean;
  canClaimRelief: boolean;
  canEnterForest: boolean;
  canEnterOldMine: boolean;
  canOpenMarket: boolean;
  canOpenDialogue: boolean;
  canInteractWithTasks: boolean;
  canRepairEquipment: boolean;
  canEatFood: boolean;
  canEquipEquipment: boolean;
  hunger: NonNullable<GameStateDto["character"]>["needs"]["hunger"] | null;
  hungerWarning: string | null;
  damagedEquipment: EquipmentItemDto[];
  acceptedTasks: GameStateDto["npcTasks"];
  selectedClass: (typeof CHARACTER_CLASSES)[number] | undefined;
  nextStep: string;
  cells: NonNullable<GameStateDto["map"]>["cells"];
  recentLog: GameStateDto["log"];
  location: {
    id: NonNullable<GameStateDto["character"]>["currentLocation"] | null;
    title: string;
    description: string;
    positionText: string;
  };
  sceneObjects: SceneObject[];
}

export interface GameControllerCommands {
  createCharacter(): Promise<void>;
  move(direction: Direction): Promise<void>;
  startGathering(): Promise<void>;
  startCombat(): Promise<void>;
  cancelAction(): Promise<void>;
  returnToVillage(): Promise<void>;
  claimRelief(): Promise<void>;
  enterCorruptForest(): Promise<void>;
  enterOldMine(): Promise<void>;
  eatFood(itemId: string): Promise<void>;
  repairEquipment(equipmentId: string): Promise<void>;
  repairAllEquipment(): Promise<void>;
  equipBackpackEquipment(instanceId: string, onSuccess?: () => void): Promise<void>;
  openMarket(): Promise<void>;
  buyMarketItem(itemId: string, quantity?: MarketTradeRequestDto["quantity"]): Promise<void>;
  sellMarketItem(itemId: string, quantity?: MarketTradeRequestDto["quantity"]): Promise<void>;
  openDialogue(): Promise<void>;
  openNpcDialogue(npcActorId: string): Promise<void>;
  submitDialogueMessage(): Promise<void>;
  acceptNpcTask(taskId: string): Promise<void>;
  completeNpcTask(taskId: string): Promise<void>;
  submitLobbyChat(): Promise<void>;
  endSession(): Promise<void>;
  openItem(item: InventoryItemDto): void;
  openEquipment(item: EquipmentItemDto): void;
  openCombat(): void;
  closeModal(): void;
}

export interface UseGameControllerOptions {
  csrfToken: string;
  onAuthExpired?: () => void;
  onLogout?: () => Promise<void>;
}

export interface GameController {
  state: GameStateDto;
  view: GameControllerView;
  activeModal: ActiveModal | null;
  setActiveModal: Dispatch<SetStateAction<ActiveModal | null>>;
  market: MarketDto | null;
  marketStatus: string | null;
  dialogueTargets: NpcDialogueTargetDto[];
  dialogue: NpcDialogueResponseDto | null;
  dialogueInput: string;
  setDialogueInput: Dispatch<SetStateAction<string>>;
  dialogueStatus: string;
  lobby: LobbyState;
  lobbyTab: LobbyTab;
  setLobbyTab: Dispatch<SetStateAction<LobbyTab>>;
  chatInput: string;
  setChatInput: Dispatch<SetStateAction<string>>;
  chatStatus: string;
  isChatSending: boolean;
  syncNotices: SyncNotice[];
  offlineReport: OfflineReportDto | null;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  classId: CharacterClassId;
  setClassId: Dispatch<SetStateAction<CharacterClassId>>;
  plannedMinutes: StartGatheringRequestDto["plannedMinutes"];
  setPlannedMinutes: Dispatch<SetStateAction<StartGatheringRequestDto["plannedMinutes"]>>;
  error: string | null;
  isBusy: boolean;
  sync: ReturnType<typeof useGameSync>;
  commands: GameControllerCommands;
}

const initialState: GameStateDto = {
  character: null,
  locationTitle: "黑松哨站",
  locationDescription: "你尚未创建角色。",
  map: null,
  inventory: [],
  equipment: [],
  backpackEquipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["create_character"],
  log: []
};

const initialLobbyState: LobbyState = {
  chat: [],
  presence: [],
  leaderboards: { level: [], wealth: [] }
};

const rarityLabels: Record<EquipmentItemDto["rarity"], string> = {
  common: "普通",
  uncommon: "优良",
  rare: "稀有",
  epic: "史诗"
};

function gameErrorMessage(error: unknown, fallback: string) {
  if (error instanceof GameApiError) {
    if (error.status === 401 || error.code === "UNAUTHENTICATED") {
      return "登录已失效，请重新登录。";
    }
    return error.message || fallback;
  }
  return fallback;
}

function isAuthExpired(error: unknown) {
  return (
    error instanceof GameApiError &&
    (error.status === 401 || error.code === "UNAUTHENTICATED")
  );
}

function readPayloadString(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "string" ? payload[key] : null;
}

function readPayloadNumber(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === "number" ? payload[key] : null;
}

function syncEventNotice(
  event: GameSyncEventDto,
  currentCharacterId: string | null
): SyncNotice | null {
  const itemId = readPayloadString(event.payload, "itemId");
  const itemName = readPayloadString(event.payload, "itemName") ?? itemId;
  const quantity = readPayloadNumber(event.payload, "quantity");
  if (event.eventType === "item.grant" && itemName && quantity) {
    return { id: String(event.id), tone: "loot", text: `获得 ${itemName} x${quantity}` };
  }
  if (event.eventType === "item.instance.grant") {
    const equipmentName =
      readPayloadString(event.payload, "itemName") ??
      readPayloadString(event.payload, "itemDefId") ??
      "未知装备";
    const rarity = readPayloadString(event.payload, "rarity");
    const rarityText =
      rarity && rarity in rarityLabels
        ? rarityLabels[rarity as EquipmentItemDto["rarity"]]
        : "装备";
    return {
      id: String(event.id),
      tone: rarity === "common" ? "loot" : "rare",
      text: `获得${rarityText}装备：${equipmentName}`
    };
  }
  if (event.eventType === "character.level_up") {
    const level = readPayloadNumber(event.payload, "level");
    if (!level) return null;
    return { id: String(event.id), tone: "level", text: `等级提升至 ${level}` };
  }
  if (event.eventType === "world.broadcast") {
    const characterId = readPayloadString(event.payload, "characterId");
    if (characterId && characterId === currentCharacterId) return null;

    const kind = readPayloadString(event.payload, "kind");
    const characterName = readPayloadString(event.payload, "characterName") ?? "有冒险者";
    if (kind === "rare_drop") {
      const equipmentName =
        readPayloadString(event.payload, "itemName") ??
        readPayloadString(event.payload, "itemDefId") ??
        "未知装备";
      const rarity = readPayloadString(event.payload, "rarity");
      const rarityText =
        rarity && rarity in rarityLabels
          ? rarityLabels[rarity as EquipmentItemDto["rarity"]]
          : "稀有";
      return {
        id: String(event.id),
        tone: "rare",
        text: `${characterName} 获得${rarityText}装备：${equipmentName}`
      };
    }
    if (kind === "level_up") {
      const level = readPayloadNumber(event.payload, "level");
      if (!level) return null;
      return { id: String(event.id), tone: "level", text: `${characterName} 升到 ${level} 级` };
    }
  }
  if (event.eventType === "system.announcement") {
    return { id: String(event.id), tone: "level", text: "系统公告已发布" };
  }
  if (event.eventType === "item.consume" && itemName && quantity) {
    return { id: String(event.id), tone: "loot", text: `消耗 ${itemName} x${quantity}` };
  }
  if (event.eventType === "item.transfer.in" && itemId && quantity) {
    return { id: String(event.id), tone: "loot", text: `收到 ${itemName} x${quantity}` };
  }
  return null;
}

function hungerWarningText(status: "fed" | "hungry" | "starving") {
  if (status === "fed") return null;
  if (status === "starving") return "饥饿：饱腹归零，无法继续外出。";
  return "饥饿：继续外出前最好准备食物。";
}

export function useGameController({
  csrfToken,
  onAuthExpired,
  onLogout
}: UseGameControllerOptions): GameController {
  const [state, setGameState] = useState<GameStateDto>(initialState);
  const currentCharacterIdRef = useRef<string | null>(initialState.character?.id ?? null);
  const characterRevisionRef = useRef<{ epoch: number; revision: number } | null>(null);
  const [name, setName] = useState("Zichen");
  const [classId, setClassId] = useState<CharacterClassId>("ranger");
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [market, setMarket] = useState<MarketDto | null>(null);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);
  const [dialogueTargets, setDialogueTargets] = useState<NpcDialogueTargetDto[]>([]);
  const [dialogue, setDialogue] = useState<NpcDialogueResponseDto | null>(null);
  const [dialogueInput, setDialogueInput] = useState("");
  const [dialogueStatus, setDialogueStatus] = useState("");
  const [lobby, setLobby] = useState<LobbyState>(initialLobbyState);
  const [lobbyTab, setLobbyTab] = useState<LobbyTab>("chat");
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [syncNotices, setSyncNotices] = useState<SyncNotice[]>([]);
  const [offlineReport, setOfflineReport] = useState<OfflineReportDto | null>(null);
  const [plannedMinutes, setPlannedMinutes] =
    useState<StartGatheringRequestDto["plannedMinutes"]>(10);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const applyState = useCallback((nextState: GameStateDto) => {
    const nextCharacterId = nextState.character?.id ?? null;
    if (nextCharacterId !== currentCharacterIdRef.current) {
      currentCharacterIdRef.current = nextCharacterId;
      characterRevisionRef.current = null;
    }
    setGameState(nextState);
  }, []);

  const applySyncState = useCallback((nextState: GameStateDto, response: GameSyncResponseDto) => {
    const nextCharacterId = nextState.character?.id ?? null;
    if (nextCharacterId !== currentCharacterIdRef.current) {
      currentCharacterIdRef.current = nextCharacterId;
      characterRevisionRef.current =
        response.characterRevision === null
          ? null
          : { epoch: response.worldEpoch, revision: response.characterRevision };
      setGameState(nextState);
      return;
    }
    const nextRevision = response.characterRevision;
    const stored = characterRevisionRef.current;
    if (
      nextRevision !== null &&
      stored !== null &&
      response.worldEpoch === stored.epoch &&
      nextRevision < stored.revision
    ) {
      return;
    }
    if (nextRevision !== null) {
      characterRevisionRef.current = { epoch: response.worldEpoch, revision: nextRevision };
    }
    setGameState(nextState);
  }, []);

  const handleSyncEvents = useCallback((events: GameSyncEventDto[]) => {
    const notices = events
      .map((event) => syncEventNotice(event, currentCharacterIdRef.current))
      .filter((entry): entry is SyncNotice => entry !== null);
    if (notices.length === 0) return;
    setSyncNotices((current) => [...notices, ...current].slice(0, 4));
  }, []);

  const applyLobbySync = useCallback((next: LobbyState) => {
    setLobby({
      chat: next.chat.slice(-30),
      presence: next.presence,
      leaderboards: next.leaderboards
    });
  }, []);

  const sync = useGameSync({
    characterId: state.character?.id ?? null,
    activeAction: state.currentAction,
    onState: applySyncState,
    onEvents: handleSyncEvents,
    onLobby: applyLobbySync,
    onOfflineReport: setOfflineReport
  });

  const runStateMutation = useCallback(
    async (
      action: () => Promise<GameStateDto>,
      onFailure?: (message: string) => void
    ): Promise<boolean> => {
      setError(null);
      setIsBusy(true);
      try {
        applyState(await action());
        return true;
      } catch (caught) {
        if (isAuthExpired(caught)) onAuthExpired?.();
        const message = gameErrorMessage(caught, "动作失败，请稍后再试。");
        if (onFailure) onFailure(message);
        else setError(message);
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [applyState, onAuthExpired]
  );

  const refreshSync = useCallback(async () => {
    const refreshed = await getGameSync(sync.cursor > 0 ? sync.cursor : undefined);
    sync.applyResponse(refreshed);
  }, [sync.applyResponse, sync.cursor]);

  const submitLobbyChatCommand = useCallback(async () => {
    const body = chatInput.trim();
    if (!body || isChatSending) return;

    setError(null);
    setChatStatus("发送中...");
    setIsChatSending(true);
    try {
      await sendLobbyChat(body, csrfToken);
      await refreshSync();
      setChatInput("");
      setChatStatus("");
    } catch (caught) {
      if (isAuthExpired(caught)) onAuthExpired?.();
      setChatStatus(gameErrorMessage(caught, "大厅发言失败，请稍后再试。"));
    } finally {
      setIsChatSending(false);
    }
  }, [chatInput, csrfToken, isChatSending, onAuthExpired, refreshSync]);

  const endSessionCommand = useCallback(async () => {
    if (!onLogout) return;
    setIsBusy(true);
    setError("");
    try {
      await onLogout();
    } catch {
      setError("退出登录失败，请检查网络后重试。");
    } finally {
      setIsBusy(false);
    }
  }, [onLogout]);

  const equipBackpackEquipmentCommand = useCallback(
    async (instanceId: string, onSuccess?: () => void) => {
      setError(null);
      setIsBusy(true);
      try {
        applyState(await equipEquipment({ instanceId }, csrfToken));
        onSuccess?.();
      } catch (caught) {
        if (isAuthExpired(caught)) onAuthExpired?.();
        setError(gameErrorMessage(caught, "装备失败，请稍后再试。"));
      } finally {
        setIsBusy(false);
      }
    },
    [applyState, csrfToken, onAuthExpired]
  );

  const openMarketCommand = useCallback(async () => {
    setError(null);
    setMarketStatus(null);
    setIsBusy(true);
    try {
      setMarket(await getMarket());
      setActiveModal({ type: "market" });
    } catch (caught) {
      if (isAuthExpired(caught)) onAuthExpired?.();
      setError(gameErrorMessage(caught, "集市暂时无法打开。"));
    } finally {
      setIsBusy(false);
    }
  }, [onAuthExpired]);

  const openDialogueCommand = useCallback(async () => {
    setError(null);
    setDialogueStatus("正在寻找附近 NPC...");
    setActiveModal({ type: "dialogue" });
    setIsBusy(true);
    try {
      const targets = await listDialogueTargets();
      setDialogueTargets(targets);
      setDialogue(null);
      setDialogueStatus(targets.length > 0 ? "" : "附近暂时没有可交谈的 NPC。");
    } catch (caught) {
      if (isAuthExpired(caught)) onAuthExpired?.();
      setDialogueStatus(gameErrorMessage(caught, "附近 NPC 暂时无法读取。"));
    } finally {
      setIsBusy(false);
    }
  }, [onAuthExpired]);

  const openNpcDialogueCommand = useCallback(
    async (npcActorId: string) => {
      setDialogueStatus("正在读取对话...");
      setIsBusy(true);
      try {
        const nextDialogue = await getNpcDialogue(npcActorId);
        setDialogue(nextDialogue);
        setDialogueTargets((current) =>
          current.map((target) =>
            target.npcActorId === nextDialogue.target.npcActorId ? nextDialogue.target : target
          )
        );
        setDialogueInput("");
        setDialogueStatus("");
      } catch (caught) {
        if (isAuthExpired(caught)) onAuthExpired?.();
        setDialogueStatus(gameErrorMessage(caught, "对话暂时无法打开。"));
      } finally {
        setIsBusy(false);
      }
    },
    [onAuthExpired]
  );

  const submitDialogueMessageCommand = useCallback(async () => {
    const message = dialogueInput.trim();
    if (!dialogue || !message) return;

    setDialogueStatus("正在等待回应...");
    setIsBusy(true);
    try {
      const nextDialogue = await sendNpcDialogueMessage(
        dialogue.target.npcActorId,
        message,
        csrfToken
      );
      setDialogue(nextDialogue);
      setDialogueTargets((current) =>
        current.map((target) =>
          target.npcActorId === nextDialogue.target.npcActorId ? nextDialogue.target : target
        )
      );
      const refreshed = await getGameSync();
      if (refreshed.state) applyState(refreshed.state);
      setDialogueInput("");
      setDialogueStatus("");
    } catch (caught) {
      if (isAuthExpired(caught)) onAuthExpired?.();
      setDialogueStatus(gameErrorMessage(caught, "NPC 暂时没有回应。"));
    } finally {
      setIsBusy(false);
    }
  }, [applyState, csrfToken, dialogue, dialogueInput, onAuthExpired]);

  const runDialogueTask = useCallback(
    async (action: () => Promise<GameStateDto>) => {
      if (!dialogue) return;

      setDialogueStatus("");
      setIsBusy(true);
      try {
        applyState(await action());
        const nextDialogue = await getNpcDialogue(dialogue.target.npcActorId);
        setDialogue(nextDialogue);
        setDialogueTargets((current) =>
          current.map((target) =>
            target.npcActorId === nextDialogue.target.npcActorId ? nextDialogue.target : target
          )
        );
        await refreshSync();
      } catch (caught) {
        if (isAuthExpired(caught)) onAuthExpired?.();
        setDialogueStatus(gameErrorMessage(caught, "任务操作未完成，请稍后再试。"));
      } finally {
        setIsBusy(false);
      }
    },
    [applyState, dialogue, onAuthExpired, refreshSync]
  );

  const runMarketTrade = useCallback(
    async (action: () => Promise<GameStateDto>) => {
      setMarketStatus(null);
      const succeeded = await runStateMutation(action, setMarketStatus);
      if (succeeded) setActiveModal(null);
    },
    [runStateMutation]
  );

  const moveCommand = useCallback(
    async (direction: Direction) => {
      await runStateMutation(() => move(direction, csrfToken));
    },
    [csrfToken, runStateMutation]
  );

  const closeModal = useCallback(() => setActiveModal(null), []);
  const isModalOpen = activeModal !== null;
  const canMove = state.availableActions.includes("move") && !isBusy && !isModalOpen;

  const hotkeyRegistry = useMemo(() => {
    const registry = new HotkeyRegistry();
    const movementHotkeys: Array<{
      key: string;
      direction: Direction;
      description: string;
    }> = [
      { key: "w", direction: "north", description: "向北移动" },
      { key: "a", direction: "west", description: "向西移动" },
      { key: "s", direction: "south", description: "向南移动" },
      { key: "d", direction: "east", description: "向东移动" }
    ];

    for (const hotkey of movementHotkeys) {
      registry.register({
        key: hotkey.key,
        contextScope: "global",
        action: `move:${hotkey.direction}`,
        description: hotkey.description,
        handler: () => {
          if (!canMove) return;
          void moveCommand(hotkey.direction);
        }
      });
    }

    registry.register({
      key: "Escape",
      contextScope: "modal",
      action: "modal:close",
      description: "关闭弹层",
      handler: closeModal
    });

    return registry;
  }, [canMove, closeModal, moveCommand]);

  useEffect(() => {
    if (!sync.error) return;
    if (isAuthExpired(sync.error)) onAuthExpired?.();
    setError(gameErrorMessage(sync.error, "同步世界状态失败。"));
  }, [onAuthExpired, sync.error]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isModalOpen) {
        closeModal();
        event.preventDefault();
        return;
      }

      const handled = dispatchHotkey(
        hotkeyRegistry,
        event.key,
        getInputContextScopes(event, { isModalOpen })
      );
      if (handled) event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, hotkeyRegistry, isModalOpen]);

  useEffect(() => {
    setActiveModal((current) => (current?.type === "combat" ? null : current));
  }, [state.currentAction?.actionType, state.currentAction?.id]);

  useEffect(() => {
    if (!state.character) return undefined;

    let cancelled = false;
    const publishHeartbeat = async () => {
      try {
        await heartbeatPresence(csrfToken);
      } catch (caught) {
        if (cancelled) return;
        if (isAuthExpired(caught)) onAuthExpired?.();
      }
    };

    void publishHeartbeat();
    const timer = window.setInterval(() => {
      void publishHeartbeat();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [csrfToken, onAuthExpired, state.character?.id]);

  const canGather =
    (state.availableActions.includes("start_gathering") ||
      state.availableActions.includes("gather")) &&
    !isBusy;
  const canStartCombat = state.availableActions.includes("start_combat") && !isBusy;
  const canCancelAction = state.availableActions.includes("cancel_action") && !isBusy;
  const canReturnVillage = state.availableActions.includes("return_to_village") && !isBusy;
  const canClaimRelief = state.availableActions.includes("claim_relief") && !isBusy;
  const canEnterForest = state.availableActions.includes("enter_corrupt_forest") && !isBusy;
  const canEnterOldMine = state.availableActions.includes("enter_old_mine") && !isBusy;
  const canOpenMarket = state.availableActions.includes("open_market") && !isBusy;
  const canOpenDialogue =
    state.character?.currentLocation === "blackpine_outpost" && !isBusy && !state.currentAction;
  const canInteractWithTasks =
    state.character?.currentLocation === "blackpine_outpost" && !isBusy && !state.currentAction;
  const canRepairEquipment =
    state.availableActions.includes("repair_equipment") && !isBusy && !state.currentAction;
  const canEatFood =
    state.availableActions.includes("eat_food") && !isBusy && !state.currentAction;
  const canEquipEquipment = !isBusy && !state.currentAction;
  const hunger = state.character?.needs.hunger ?? null;
  const hungerWarning = hungerWarningText(hunger?.status ?? "fed");
  const damagedEquipment = state.equipment.filter((item) => item.repairQuote !== null);
  const acceptedTasks = state.npcTasks.filter((task) => task.status === "accepted");
  const selectedClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  const nextStep = selectContextualObjective(state);
  const cells = state.map?.cells ?? [];
  const recentLog = selectRecentLog(state, 30);
  const positionText = state.character?.position
    ? `坐标 ${state.character.position.x}, ${state.character.position.y}`
    : "村镇";
  const sceneObjects = selectSceneObjects(state);

  const view: GameControllerView = {
    isModalOpen,
    canMove,
    canGather,
    canStartCombat,
    canCancelAction,
    canReturnVillage,
    canClaimRelief,
    canEnterForest,
    canEnterOldMine,
    canOpenMarket,
    canOpenDialogue,
    canInteractWithTasks,
    canRepairEquipment,
    canEatFood,
    canEquipEquipment,
    hunger,
    hungerWarning,
    damagedEquipment,
    acceptedTasks,
    selectedClass,
    nextStep,
    cells,
    recentLog,
    location: {
      id: state.character?.currentLocation ?? null,
      title: state.locationTitle,
      description: state.locationDescription,
      positionText
    },
    sceneObjects
  };

  const commands: GameControllerCommands = {
    async createCharacter() {
      await runStateMutation(() => createCharacter({ name, classId }, csrfToken));
    },
    move: moveCommand,
    async startGathering() {
      await runStateMutation(() => startGathering({ plannedMinutes }, csrfToken));
    },
    async startCombat() {
      await runStateMutation(() => startCombat(csrfToken));
    },
    async cancelAction() {
      await runStateMutation(() => cancelAction(csrfToken));
    },
    async returnToVillage() {
      await runStateMutation(() => returnToVillage(csrfToken));
    },
    async claimRelief() {
      await runStateMutation(() => claimMunicipalRelief(csrfToken));
    },
    async enterCorruptForest() {
      await runStateMutation(() => enterCorruptForest(csrfToken));
    },
    async enterOldMine() {
      await runStateMutation(() => enterOldMine(csrfToken));
    },
    async eatFood(itemId: string) {
      await runStateMutation(() => eatFood({ itemId }, csrfToken));
    },
    async repairEquipment(equipmentId: string) {
      await runStateMutation(() => repairEquipment({ equipmentId }, csrfToken));
    },
    async repairAllEquipment() {
      await runStateMutation(() => repairAllEquipment(csrfToken));
    },
    equipBackpackEquipment: equipBackpackEquipmentCommand,
    openMarket: openMarketCommand,
    async buyMarketItem(itemId: string, quantity = 1) {
      await runMarketTrade(() => buyMarketItem({ itemId, quantity, commandId: newCommandId() }, csrfToken));
    },
    async sellMarketItem(itemId: string, quantity = 1) {
      await runMarketTrade(() => sellMarketItem({ itemId, quantity, commandId: newCommandId() }, csrfToken));
    },
    openDialogue: openDialogueCommand,
    openNpcDialogue: openNpcDialogueCommand,
    submitDialogueMessage: submitDialogueMessageCommand,
    async acceptNpcTask(taskId: string) {
      await runDialogueTask(() => acceptNpcTask(taskId, csrfToken));
    },
    async completeNpcTask(taskId: string) {
      await runDialogueTask(() => completeNpcTask(taskId, csrfToken));
    },
    submitLobbyChat: submitLobbyChatCommand,
    endSession: endSessionCommand,
    openItem(item: InventoryItemDto) {
      setActiveModal({ type: "item", item });
    },
    openEquipment(item: EquipmentItemDto) {
      setActiveModal({ type: "equipment", item });
    },
    openCombat() {
      if (state.currentAction?.actionType === "combat") setActiveModal({ type: "combat" });
    },
    closeModal
  };

  return {
    state,
    view,
    activeModal,
    setActiveModal,
    market,
    marketStatus,
    dialogueTargets,
    dialogue,
    dialogueInput,
    setDialogueInput,
    dialogueStatus,
    lobby,
    lobbyTab,
    setLobbyTab,
    chatInput,
    setChatInput,
    chatStatus,
    isChatSending,
    syncNotices,
    offlineReport,
    name,
    setName,
    classId,
    setClassId,
    plannedMinutes,
    setPlannedMinutes,
    error,
    isBusy,
    sync,
    commands
  };
}
