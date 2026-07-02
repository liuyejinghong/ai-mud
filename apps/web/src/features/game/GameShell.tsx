import { useEffect, useMemo, useState } from "react";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type Direction,
  type GameStateDto,
  type HungerStatus,
  type InventoryItemDto,
  type MarketDto,
  type MoneyDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import {
  acceptNpcTask,
  buyMarketItem,
  cancelAction,
  completeNpcTask,
  createCharacter,
  eatFood,
  enterCorruptForest,
  getGameState,
  getMarket,
  getNpcDialogue,
  listDialogueTargets,
  move,
  repairAllEquipment,
  repairEquipment,
  returnToVillage,
  sellMarketItem,
  sendNpcDialogueMessage,
  startCombat,
  startGathering
} from "./gameApi";
import { HotkeyRegistry } from "./input/HotkeyRegistry";
import { dispatchHotkey, getInputContextScopes } from "./input/InputContext";
import { ModalManager } from "./ui/ModalManager";
import "./GameShell.css";

interface GameShellProps {
  csrfToken: string;
}

const initialState: GameStateDto = {
  character: null,
  locationTitle: "黑松哨站",
  locationDescription: "你尚未创建角色。",
  map: null,
  inventory: [],
  equipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["create_character"],
  log: []
};

const directionLabels: Record<Direction, string> = {
  north: "北",
  west: "西",
  south: "南",
  east: "东"
};

function cellText(markers: string[]) {
  if (markers.includes("player")) return "@";
  if (markers.includes("encounter")) return "!";
  if (markers.includes("resource")) return "*";
  if (markers.includes("exit")) return "E";
  return ".";
}

function moneyText(money: MoneyDto) {
  return `金币 ${money.gold} | 银币 ${money.silver} | 铜币 ${money.copper}`;
}

function isFoodItem(item: InventoryItemDto) {
  return item.itemId === "wild_berry" || item.itemId === "beast_meat";
}

function hungerWarningText(status: HungerStatus) {
  if (status === "fed") return null;
  if (status === "starving") return "饥饿：饱腹归零，无法继续外出。";
  return "饥饿：继续外出前最好准备食物。";
}

function taskStatusText(status: GameStateDto["npcTasks"][number]["status"]) {
  return {
    open: "可接取",
    accepted: "进行中",
    completed: "已完成",
    expired: "已过期",
    cancelled: "已取消"
  }[status];
}

function dialogueTaskHint(target: NpcDialogueTargetDto) {
  if (!target.hasTask || !target.taskTitle || !target.taskStatus) return null;
  const status = target.taskStatus === "open" ? "可接取" : "进行中";
  return `${status}：${target.taskTitle}`;
}

type ActiveModal =
  | { type: "item"; item: InventoryItemDto }
  | { type: "market" }
  | { type: "dialogue" }
  | { type: "combat" };

export function GameShell({ csrfToken }: GameShellProps) {
  const [state, setState] = useState<GameStateDto>(initialState);
  const [name, setName] = useState("Zichen");
  const [classId, setClassId] = useState<CharacterClassId>("ranger");
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [market, setMarket] = useState<MarketDto | null>(null);
  const [dialogueTargets, setDialogueTargets] = useState<NpcDialogueTargetDto[]>([]);
  const [dialogue, setDialogue] = useState<NpcDialogueResponseDto | null>(null);
  const [dialogueInput, setDialogueInput] = useState("");
  const [dialogueStatus, setDialogueStatus] = useState("");
  const [plannedMinutes, setPlannedMinutes] =
    useState<StartGatheringRequestDto["plannedMinutes"]>(10);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const isModalOpen = activeModal !== null;
  const canMove = state.availableActions.includes("move") && !isBusy && !isModalOpen;
  const canGather =
    (state.availableActions.includes("start_gathering") ||
      state.availableActions.includes("gather")) &&
    !isBusy;
  const canStartCombat = state.availableActions.includes("start_combat") && !isBusy;
  const canCancelAction = state.availableActions.includes("cancel_action") && !isBusy;
  const canReturnVillage = state.availableActions.includes("return_to_village") && !isBusy;
  const canEnterForest = state.availableActions.includes("enter_corrupt_forest") && !isBusy;
  const canOpenMarket = state.availableActions.includes("open_market") && !isBusy;
  const canOpenDialogue =
    state.character?.currentLocation === "blackpine_outpost" && !isBusy && !state.currentAction;
  const canInteractWithTasks =
    state.character?.currentLocation === "blackpine_outpost" && !isBusy && !state.currentAction;
  const canRepairEquipment =
    state.availableActions.includes("repair_equipment") && !isBusy && !state.currentAction;
  const canEatFood =
    state.availableActions.includes("eat_food") && !isBusy && !state.currentAction;
  const hungerWarning = hungerWarningText(state.character?.needs.hunger.status ?? "fed");
  const damagedEquipment = state.equipment.filter((item) => item.repairQuote !== null);
  const selectedClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);

  async function runCommand(action: () => Promise<GameStateDto>) {
    setError(null);
    setIsBusy(true);
    try {
      setState(await action());
    } catch {
      setError("动作失败，请稍后再试。");
    } finally {
      setIsBusy(false);
    }
  }

  async function openMarket() {
    setError(null);
    setIsBusy(true);
    try {
      setMarket(await getMarket());
      setActiveModal({ type: "market" });
    } catch {
      setError("集市暂时无法打开。");
    } finally {
      setIsBusy(false);
    }
  }

  async function openDialogueDialog() {
    setError(null);
    setDialogueStatus("正在寻找附近 NPC...");
    setActiveModal({ type: "dialogue" });
    setIsBusy(true);
    try {
      const targets = await listDialogueTargets();
      setDialogueTargets(targets);
      setDialogue(null);
      setDialogueStatus(targets.length > 0 ? "" : "附近暂时没有可交谈的 NPC。");
    } catch {
      setDialogueStatus("附近 NPC 暂时无法读取。");
    } finally {
      setIsBusy(false);
    }
  }

  async function openNpcDialogue(npcActorId: string) {
    setDialogueStatus("正在读取对话...");
    setIsBusy(true);
    try {
      setDialogue(await getNpcDialogue(npcActorId));
      setDialogueInput("");
      setDialogueStatus("");
    } catch {
      setDialogueStatus("对话暂时无法打开。");
    } finally {
      setIsBusy(false);
    }
  }

  async function submitDialogueMessage() {
    const message = dialogueInput.trim();
    if (!dialogue || !message) return;

    setDialogueStatus("正在等待回应...");
    setIsBusy(true);
    try {
      setDialogue(await sendNpcDialogueMessage(dialogue.target.npcActorId, message, csrfToken));
      setState(await getGameState());
      setDialogueInput("");
      setDialogueStatus("");
    } catch {
      setDialogueStatus("NPC 暂时没有回应。");
    } finally {
      setIsBusy(false);
    }
  }

  async function runMarketTrade(action: () => Promise<GameStateDto>) {
    await runCommand(action);
    setActiveModal(null);
  }

  const hotkeyRegistry = useMemo(() => {
    const registry = new HotkeyRegistry();
    const movementHotkeys: Array<{ key: string; direction: Direction; description: string }> = [
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
          void runCommand(() => move(hotkey.direction, csrfToken));
        }
      });
    }

    registry.register({
      key: "Escape",
      contextScope: "modal",
      action: "modal:close",
      description: "关闭弹层",
      handler: () => setActiveModal(null)
    });

    return registry;
  }, [canMove, csrfToken]);

  useEffect(() => {
    let cancelled = false;
    void getGameState()
      .then((nextState) => {
        if (!cancelled) setState(nextState);
      })
      .catch(() => {
        if (!cancelled) setState(initialState);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const handled = dispatchHotkey(
        hotkeyRegistry,
        event.key,
        getInputContextScopes(event, { isModalOpen })
      );
      if (handled) event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkeyRegistry, isModalOpen]);

  useEffect(() => {
    setActiveModal((current) => (current?.type === "combat" ? null : current));
  }, [state.currentAction?.id, state.currentAction?.actionType]);

  const cells = useMemo(() => state.map?.cells ?? [], [state.map]);

  if (!state.character) {
    return (
      <main className="game-shell game-shell-authenticated">
        <section className="game-create-panel" aria-labelledby="create-character-title">
          <p className="game-kicker">Blackpine Outpost Registry</p>
          <h1 id="create-character-title">创建角色</h1>
          <p className="game-copy">
            黑松哨站只记录一个常驻身份。后续职业、装备、经济和 NPC 记忆都会挂在这个角色上。
          </p>

          <label className="game-field" htmlFor="character-name">
            角色名
            <input
              id="character-name"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="game-field" htmlFor="character-class">
            职业
            <select
              id="character-class"
              value={classId}
              onChange={(event) => setClassId(event.target.value as CharacterClassId)}
            >
              {CHARACTER_CLASSES.map((characterClass) => (
                <option key={characterClass.id} value={characterClass.id}>
                  {characterClass.name}
                </option>
              ))}
            </select>
          </label>

          <p className="class-brief">{selectedClass?.description}</p>

          <button
            type="button"
            className="game-primary-button"
            disabled={isBusy}
            onClick={() => void runCommand(() => createCharacter({ name, classId }, csrfToken))}
          >
            进入世界
          </button>

          {error ? <p role="alert" className="game-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <aside className="game-column game-character-panel" aria-label="角色状态">
        <section className="game-panel">
          <p className="game-kicker">Hero Status</p>
          <h2>{state.character.name}</h2>
          <dl className="stat-list">
            <div>
              <dt>等级</dt>
              <dd>{state.character.level}</dd>
            </div>
            <div>
              <dt>经验</dt>
              <dd>{state.character.xp}</dd>
            </div>
            <div>
              <dt>生命</dt>
              <dd>
                {state.character.hp}/{state.character.maxHp}
              </dd>
            </div>
            <div>
              <dt>饱腹</dt>
              <dd>
                饱腹 {state.character.needs.hunger.current}/{state.character.needs.hunger.max}
              </dd>
            </div>
            <div>
              <dt>货币</dt>
              <dd>{moneyText(state.character.money)}</dd>
            </div>
          </dl>
          {hungerWarning ? <p className="needs-warning">{hungerWarning}</p> : null}
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>装备</h2>
            <span>{state.equipment.length} 件</span>
          </div>
          {state.equipment.length === 0 ? <p className="empty-copy">无</p> : null}
          <div className="equipment-list">
            {state.equipment.map((item) => (
              <article className="equipment-item" key={item.id}>
                <div className="equipment-title">
                  <strong>{item.name}</strong>
                  <span>{item.slot === "weapon" ? "武器" : "胸甲"}</span>
                </div>
                <div className="durability-bar" aria-hidden="true">
                  <span style={{ width: `${item.durabilityPct}%` }} />
                </div>
                <div className="equipment-meta">
                  <span>{item.currentDurability}/{item.maxDurability}</span>
                  <span>装等 {item.itemLevel}</span>
                </div>
                {item.effectiveStatRatio < 1 ? (
                  <p className="equipment-warning">耐久归零，仅保留 20% 属性。</p>
                ) : null}
                {item.repairQuote ? (
                  <p className="equipment-cost">
                    修理：{moneyText(item.repairQuote.copperCost)} + 基础铁矿石 x
                    {item.repairQuote.ironOreCost}
                  </p>
                ) : (
                  <p className="equipment-cost">无需修理</p>
                )}
                <button
                  type="button"
                  className="game-secondary-button"
                  disabled={!canRepairEquipment || !item.repairQuote}
                  onClick={() =>
                    void runCommand(() =>
                      repairEquipment({ equipmentId: item.id }, csrfToken)
                    )
                  }
                >
                  修理 {item.name}
                </button>
              </article>
            ))}
          </div>
          {damagedEquipment.length > 1 ? (
            <button
              type="button"
              className="game-secondary-button repair-all-button"
              disabled={!canRepairEquipment}
              onClick={() => void runCommand(() => repairAllEquipment(csrfToken))}
            >
              修理全部装备
            </button>
          ) : null}
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>背包</h2>
            <span>{state.inventory.length} 类</span>
          </div>
          {state.inventory.length === 0 ? <p className="empty-copy">空</p> : null}
          <div className="inventory-list">
            {state.inventory.map((item) => (
              <div className="inventory-item-row" key={item.itemId}>
                <button
                  type="button"
                  className="inventory-item"
                  onClick={() => setActiveModal({ type: "item", item })}
                >
                  {item.name} x{item.quantity}
                </button>
                {canEatFood && isFoodItem(item) ? (
                  <button
                    type="button"
                    className="game-secondary-button eat-button"
                    onClick={() =>
                      void runCommand(() => eatFood({ itemId: item.itemId }, csrfToken))
                    }
                  >
                    食用 {item.name}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </aside>

      <section className="game-main-panel" aria-labelledby="location-title">
        <div className="location-header">
          <p className="game-kicker">World Feed</p>
          <h1 id="location-title">{state.locationTitle}</h1>
          <p>{state.locationDescription}</p>
        </div>

        <div className="game-actions" aria-label="常用动作">
          {canEnterForest ? (
            <button
              type="button"
              className="game-primary-button"
              onClick={() => void runCommand(() => enterCorruptForest(csrfToken))}
            >
              前往腐林
            </button>
          ) : null}
          {canOpenMarket ? (
            <button
              type="button"
              className="game-secondary-button"
              onClick={() => void openMarket()}
            >
              市政集市
            </button>
          ) : null}
          {canOpenDialogue ? (
            <button
              type="button"
              className="game-secondary-button"
              onClick={() => void openDialogueDialog()}
            >
              附近 NPC
            </button>
          ) : null}
          {canGather ? (
            <div className="duration-select">
              <select
                aria-label="采集时长"
                value={plannedMinutes}
                onChange={(event) =>
                  setPlannedMinutes(Number(event.target.value) as StartGatheringRequestDto["plannedMinutes"])
                }
              >
                <option value={10}>10 分钟</option>
                <option value={30}>30 分钟</option>
                <option value={120}>2 小时</option>
              </select>
              <button
                type="button"
                className="game-secondary-button"
                onClick={() =>
                  void runCommand(() => startGathering({ plannedMinutes }, csrfToken))
                }
              >
                开始采集
              </button>
            </div>
          ) : null}
          {canStartCombat ? (
            <button
              type="button"
              className="game-secondary-button"
              onClick={() => void runCommand(() => startCombat(csrfToken))}
            >
              攻击野狼
            </button>
          ) : null}
          {canReturnVillage ? (
            <button
              type="button"
              className="game-secondary-button"
              onClick={() => void runCommand(() => returnToVillage(csrfToken))}
            >
              返回哨站
            </button>
          ) : null}
        </div>

        {state.npcTasks.length > 0 ? (
          <section className="npc-task-panel" aria-labelledby="npc-task-title">
            <div className="panel-heading">
              <h2 id="npc-task-title">NPC 任务</h2>
              <span>{state.npcTasks.length} 个</span>
            </div>
            <div className="npc-task-list">
              {state.npcTasks.map((task) => (
                <article className="npc-task-item" key={task.id}>
                  <div className="npc-task-title">
                    <strong>
                      {task.status === "open" ? "! " : ""}
                      {task.title}
                    </strong>
                    <span>{taskStatusText(task.status)}</span>
                  </div>
                  <p>{task.description}</p>
                  {task.proposalReason ? (
                    <p className="npc-task-reason">{task.proposalReason}</p>
                  ) : null}
                  <dl className="npc-task-meta">
                    <div>
                      <dt>发布者</dt>
                      <dd>{task.npcName}</dd>
                    </div>
                    <div>
                      <dt>需求</dt>
                      <dd>
                        {task.requestedItem.name} x{task.requestedItem.quantity}
                      </dd>
                    </div>
                    <div>
                      <dt>奖励</dt>
                      <dd>{moneyText(task.rewardCopper)}</dd>
                    </div>
                  </dl>
                  <div className="npc-task-actions">
                    {task.status === "open" ? (
                      <button
                        type="button"
                        className="game-secondary-button"
                        disabled={!canInteractWithTasks}
                        onClick={() =>
                          void runCommand(() => acceptNpcTask(task.id, csrfToken))
                        }
                      >
                        接取
                      </button>
                    ) : null}
                    {task.status === "accepted" ? (
                      <button
                        type="button"
                        className="game-secondary-button"
                        disabled={!canInteractWithTasks}
                        onClick={() =>
                          void runCommand(() => completeNpcTask(task.id, csrfToken))
                        }
                      >
                        提交
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rumor-panel" aria-labelledby="rumor-title">
          <div className="panel-heading">
            <h2 id="rumor-title">传闻</h2>
            <span>{state.rumors.length} 条</span>
          </div>
          {state.rumors.length === 0 ? (
            <p className="empty-copy">暂时没有新的传闻。</p>
          ) : (
            <ul className="rumor-list">
              {state.rumors.map((rumor) => (
                <li key={rumor.id}>{rumor.message}</li>
              ))}
            </ul>
          )}
        </section>

        {state.currentAction ? (
          <section className="active-action-panel" aria-labelledby="active-action-title">
            <div className="panel-heading">
              <h2 id="active-action-title">当前行动</h2>
              <span>{state.currentAction.progressPct}%</span>
            </div>
            <p>{state.currentAction.description}</p>
            <div className="action-progress" aria-hidden="true">
              <span style={{ width: `${state.currentAction.progressPct}%` }} />
            </div>
            {state.currentAction.actionType === "gathering" ? (
              <p className="action-meta">
                当前周期 {state.currentAction.cycleProgressPct}% · 已完成{" "}
                {state.currentAction.completedCycles}/{state.currentAction.plannedCycles}
              </p>
            ) : null}
            {state.currentAction.expectedYield.length > 0 ? (
              <p className="action-meta">
                预计产出：
                {state.currentAction.expectedYield
                  .map((item) => `${item.name} x${item.quantity}`)
                  .join("，")}
              </p>
            ) : null}
            <div className="game-actions">
              {state.currentAction.actionType === "combat" ? (
                <button
                  type="button"
                  className="game-secondary-button"
                  onClick={() => setActiveModal({ type: "combat" })}
                >
                  查看战斗
                </button>
              ) : null}
              {canCancelAction ? (
                <button
                  type="button"
                  className="game-secondary-button"
                  onClick={() => void runCommand(() => cancelAction(csrfToken))}
                >
                  {state.currentAction.actionType === "combat" ? "撤离" : "取消行动"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {error ? <p role="alert" className="game-error">{error}</p> : null}

        <ol className="game-log" aria-label="事件记录">
          {state.log.map((entry) => (
            <li key={entry.id}>{entry.message}</li>
          ))}
        </ol>
      </section>

      <aside className="game-column game-map-panel" aria-label="地图与移动">
        <section className="game-panel">
          <div className="panel-heading">
            <h2>地图</h2>
            {state.map ? <span>{state.map.width} x {state.map.height}</span> : <span>村镇</span>}
          </div>
          {state.map ? (
            <div
              className="mini-map"
              style={{ gridTemplateColumns: `repeat(${state.map.width}, minmax(0, 1fr))` }}
            >
              {cells.map((cell) => (
                <span
                  key={`${cell.x}:${cell.y}`}
                  className={`mini-map-cell ${cell.markers.map((marker) => `is-${marker}`).join(" ")}`}
                  title={`x:${cell.x} y:${cell.y}`}
                >
                  {cellText(cell.markers)}
                </span>
              ))}
            </div>
          ) : (
            <p className="empty-copy">当前在村镇区域，无野外方格。</p>
          )}
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>移动</h2>
            <span>WASD</span>
          </div>
          <div className="direction-pad">
            <button
              type="button"
              disabled={!canMove}
              className="direction-button north"
              aria-label="向北移动"
              onClick={() => void runCommand(() => move("north", csrfToken))}
            >
              W
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button west"
              aria-label="向西移动"
              onClick={() => void runCommand(() => move("west", csrfToken))}
            >
              A
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button south"
              aria-label="向南移动"
              onClick={() => void runCommand(() => move("south", csrfToken))}
            >
              S
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button east"
              aria-label="向东移动"
              onClick={() => void runCommand(() => move("east", csrfToken))}
            >
              D
            </button>
          </div>
          <p className="movement-hint">
            键盘和鼠标共用同一套服务端移动指令。
          </p>
        </section>
      </aside>

      <ModalManager activeModal={activeModal} onClose={() => setActiveModal(null)}>
        {(modal, closeModal) => {
          if (modal.type === "item") {
            return (
              <section
                className="item-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={modal.item.name}
              >
                <p className="game-kicker">Inventory Item</p>
                <h2>{modal.item.name}</h2>
                <dl className="stat-list">
                  <div>
                    <dt>数量</dt>
                    <dd>{modal.item.quantity}</dd>
                  </div>
                  <div>
                    <dt>物品 ID</dt>
                    <dd>{modal.item.itemId}</dd>
                  </div>
                </dl>
                <div className="dialog-actions">
                  <button type="button" className="game-secondary-button" disabled>
                    使用
                  </button>
                  <button type="button" className="game-primary-button" onClick={closeModal}>
                    关闭
                  </button>
                </div>
              </section>
            );
          }

          if (modal.type === "market" && market) {
            return (
              <section
                className="market-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="市政集市"
              >
                <p className="game-kicker">Municipal Market</p>
                <div className="panel-heading">
                  <h2>市政集市</h2>
                  <span>{market.items.length} 类</span>
                </div>
                <div className="market-table" role="table" aria-label="市政集市库存">
                  <div className="market-row market-row-heading" role="row">
                    <span role="columnheader">物品</span>
                    <span role="columnheader">库存</span>
                    <span role="columnheader">持有</span>
                    <span role="columnheader">买价</span>
                    <span role="columnheader">卖价</span>
                    <span role="columnheader">操作</span>
                  </div>
                  {market.items.map((item) => (
                    <div className="market-row" role="row" key={item.itemId}>
                      <span role="cell">{item.name}</span>
                      <span role="cell">{item.stockQuantity}</span>
                      <span role="cell">{item.playerQuantity}</span>
                      <span role="cell">
                        {moneyText(item.buyPrice)} + 税 {item.buyTax.totalCopper} 铜
                      </span>
                      <span role="cell">
                        {moneyText(item.sellPrice)} - 税 {item.sellTax.totalCopper} 铜
                      </span>
                      <span role="cell" className="market-actions">
                        <button
                          type="button"
                          className="game-secondary-button"
                          disabled={item.stockQuantity < 1 || isBusy}
                          onClick={() =>
                            void runMarketTrade(() =>
                              buyMarketItem({ itemId: item.itemId, quantity: 1 }, csrfToken)
                            )
                          }
                        >
                          购买 {item.name}
                        </button>
                        <button
                          type="button"
                          className="game-secondary-button"
                          disabled={item.playerQuantity < 1 || isBusy}
                          onClick={() =>
                            void runMarketTrade(() =>
                              sellMarketItem({ itemId: item.itemId, quantity: 1 }, csrfToken)
                            )
                          }
                        >
                          出售 {item.name}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="dialog-actions">
                  <button type="button" className="game-primary-button" onClick={closeModal}>
                    关闭
                  </button>
                </div>
              </section>
            );
          }

          if (modal.type === "dialogue") {
            return (
              <section
                className="dialogue-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="附近 NPC 对话"
              >
                <p className="game-kicker">NPC Dialogue</p>
                <div className="panel-heading">
                  <h2>{dialogue ? dialogue.target.name : "附近 NPC"}</h2>
                  <span>{dialogue?.ai.status ?? "列表"}</span>
                </div>

                <div className="dialogue-layout">
                  <aside className="dialogue-target-list" aria-label="附近 NPC">
                    {dialogueTargets.length === 0 ? <p className="empty-copy">暂无 NPC</p> : null}
                    {dialogueTargets.map((target) => (
                      <button
                        type="button"
                        className={
                          target.npcActorId === dialogue?.target.npcActorId ? "is-selected" : ""
                        }
                        key={target.npcActorId}
                        disabled={isBusy}
                        onClick={() => void openNpcDialogue(target.npcActorId)}
                      >
                        <strong>
                          {target.hasTask ? "! " : ""}
                          {target.name}
                        </strong>
                        <span>{target.statusLine}</span>
                        {dialogueTaskHint(target) ? (
                          <span className="dialogue-task-hint">{dialogueTaskHint(target)}</span>
                        ) : null}
                      </button>
                    ))}
                  </aside>

                  <section className="dialogue-thread" aria-label="对话记录">
                    {dialogue ? (
                      <>
                        {dialogueTaskHint(dialogue.target) ? (
                          <p className="dialogue-task-summary">
                            {dialogueTaskHint(dialogue.target)}。请在 NPC 任务面板接取或提交。
                          </p>
                        ) : null}
                        <ol>
                          {dialogue.messages.length === 0 ? <li>还没有交谈记录。</li> : null}
                          {dialogue.messages.map((message) => (
                            <li className={`speaker-${message.speakerType}`} key={message.id}>
                              <span>
                                {message.speakerType === "player"
                                  ? state.character?.name
                                  : dialogue.target.name}
                              </span>
                              <p>{message.message}</p>
                            </li>
                          ))}
                        </ol>
                        <form
                          className="dialogue-input-row"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitDialogueMessage();
                          }}
                        >
                          <input
                            aria-label="对 NPC 说"
                            value={dialogueInput}
                            maxLength={300}
                            disabled={isBusy}
                            onChange={(event) => setDialogueInput(event.target.value)}
                          />
                          <button
                            type="submit"
                            className="game-primary-button"
                            disabled={isBusy || !dialogueInput.trim()}
                          >
                            发送
                          </button>
                        </form>
                      </>
                    ) : (
                      <p className="empty-copy">选择一个 NPC 开始交谈。</p>
                    )}
                  </section>
                </div>

                {dialogueStatus ? (
                  <p role="status" aria-live="polite" className="dialogue-status">
                    {dialogueStatus}
                  </p>
                ) : null}

                <div className="dialog-actions">
                  <button type="button" className="game-primary-button" onClick={closeModal}>
                    关闭
                  </button>
                </div>
              </section>
            );
          }

          if (modal.type === "combat" && state.currentAction?.actionType === "combat") {
            return (
              <section
                className="item-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="战斗详情"
              >
                <p className="game-kicker">Combat Timeline</p>
                <h2>战斗详情</h2>
                <ol className="combat-log">
                  {state.currentAction.combatLog.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ol>
                <div className="dialog-actions">
                  <button type="button" className="game-primary-button" onClick={closeModal}>
                    关闭
                  </button>
                </div>
              </section>
            );
          }

          return null;
        }}
      </ModalManager>
    </main>
  );
}
