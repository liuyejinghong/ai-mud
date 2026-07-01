import { useEffect, useMemo, useState } from "react";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type Direction,
  type GameStateDto,
  type InventoryItemDto,
  type MarketDto,
  type MoneyDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import {
  buyMarketItem,
  cancelAction,
  createCharacter,
  enterCorruptForest,
  getGameState,
  getMarket,
  move,
  returnToVillage,
  sellMarketItem,
  startCombat,
  startGathering
} from "./gameApi";
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
  market: null,
  currentAction: null,
  availableActions: ["create_character"],
  log: []
};

const keyDirections: Record<string, Direction> = {
  w: "north",
  a: "west",
  s: "south",
  d: "east"
};

const directionLabels: Record<Direction, string> = {
  north: "北",
  west: "西",
  south: "南",
  east: "东"
};

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

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

export function GameShell({ csrfToken }: GameShellProps) {
  const [state, setState] = useState<GameStateDto>(initialState);
  const [name, setName] = useState("Zichen");
  const [classId, setClassId] = useState<CharacterClassId>("ranger");
  const [selectedItem, setSelectedItem] = useState<InventoryItemDto | null>(null);
  const [market, setMarket] = useState<MarketDto | null>(null);
  const [isMarketDialogOpen, setIsMarketDialogOpen] = useState(false);
  const [plannedMinutes, setPlannedMinutes] =
    useState<StartGatheringRequestDto["plannedMinutes"]>(10);
  const [isCombatDialogOpen, setIsCombatDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const canMove = state.availableActions.includes("move") && !isBusy;
  const canGather =
    (state.availableActions.includes("start_gathering") ||
      state.availableActions.includes("gather")) &&
    !isBusy;
  const canStartCombat = state.availableActions.includes("start_combat") && !isBusy;
  const canCancelAction = state.availableActions.includes("cancel_action") && !isBusy;
  const canReturnVillage = state.availableActions.includes("return_to_village") && !isBusy;
  const canEnterForest = state.availableActions.includes("enter_corrupt_forest") && !isBusy;
  const canOpenMarket = state.availableActions.includes("open_market") && !isBusy;
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
      setIsMarketDialogOpen(true);
    } catch {
      setError("集市暂时无法打开。");
    } finally {
      setIsBusy(false);
    }
  }

  async function runMarketTrade(action: () => Promise<GameStateDto>) {
    await runCommand(action);
    setIsMarketDialogOpen(false);
  }

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
      if (isTextEntryTarget(event.target)) return;

      const direction = keyDirections[event.key.toLowerCase()];
      if (!direction || !canMove) return;

      event.preventDefault();
      void runCommand(() => move(direction, csrfToken));
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canMove, csrfToken]);

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
              <dt>货币</dt>
              <dd>{moneyText(state.character.money)}</dd>
            </div>
          </dl>
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>背包</h2>
            <span>{state.inventory.length} 类</span>
          </div>
          {state.inventory.length === 0 ? <p className="empty-copy">空</p> : null}
          <div className="inventory-list">
            {state.inventory.map((item) => (
              <button
                type="button"
                key={item.itemId}
                className="inventory-item"
                onClick={() => setSelectedItem(item)}
              >
                {item.name} x{item.quantity}
              </button>
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
                  onClick={() => setIsCombatDialogOpen(true)}
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

      {selectedItem ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedItem(null)}>
          <section
            className="item-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={selectedItem.name}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="game-kicker">Inventory Item</p>
            <h2>{selectedItem.name}</h2>
            <dl className="stat-list">
              <div>
                <dt>数量</dt>
                <dd>{selectedItem.quantity}</dd>
              </div>
              <div>
                <dt>物品 ID</dt>
                <dd>{selectedItem.itemId}</dd>
              </div>
            </dl>
            <div className="dialog-actions">
              <button type="button" className="game-secondary-button" disabled>
                使用
              </button>
              <button
                type="button"
                className="game-primary-button"
                onClick={() => setSelectedItem(null)}
              >
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isMarketDialogOpen && market ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsMarketDialogOpen(false)}>
          <section
            className="market-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="市政集市"
            onMouseDown={(event) => event.stopPropagation()}
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
              <button
                type="button"
                className="game-primary-button"
                onClick={() => setIsMarketDialogOpen(false)}
              >
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isCombatDialogOpen && state.currentAction?.actionType === "combat" ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsCombatDialogOpen(false)}>
          <section
            className="item-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="战斗详情"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="game-kicker">Combat Timeline</p>
            <h2>战斗详情</h2>
            <ol className="combat-log">
              {state.currentAction.combatLog.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ol>
            <div className="dialog-actions">
              <button
                type="button"
                className="game-primary-button"
                onClick={() => setIsCombatDialogOpen(false)}
              >
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
