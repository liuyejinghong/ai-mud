import { useMemo } from "react";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type EquipmentItemDto,
  type GameLocationId,
  type InventoryItemDto,
  type MoneyDto,
  type NpcDialogueTargetDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import {
  selectContextualObjective,
  selectRecentLog,
  selectSceneObjects
} from "./controller/gameSelectors";
import { useGameController } from "./controller/useGameController";
import { ModalManager } from "./ui/ModalManager";
import "./GameShell.css";

interface GameShellProps {
  csrfToken: string;
  onAuthExpired?: () => void;
  onLogout?: () => Promise<void>;
}

const EVENT_LOG_LIMIT = 30;

const locationLabels: Partial<Record<GameLocationId, string>> = {
  blackpine_outpost: "黑松哨站",
  corrupt_forest: "腐林",
  old_mine: "旧矿坑"
};

const eventTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function locationText(locationId: GameLocationId) {
  return locationLabels[locationId] ?? locationId;
}

function eventTimeText(createdAt: string) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return "--:--";
  return eventTimeFormatter.format(timestamp);
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

function isFoodItem(item: InventoryItemDto) {
  return item.itemId === "wild_berry" || item.itemId === "beast_meat";
}

const slotLabels: Record<EquipmentItemDto["slot"], string> = {
  weapon: "武器",
  chest: "胸甲",
  head: "头部",
  accessory: "饰品"
};

const rarityLabels: Record<EquipmentItemDto["rarity"], string> = {
  common: "普通",
  uncommon: "优良",
  rare: "稀有",
  epic: "史诗"
};

function equipmentPower(item: EquipmentItemDto) {
  return item.attackBonus + item.defenseBonus + item.agilityBonus + item.maxHpBonus;
}

function equipmentStatLine(item: EquipmentItemDto | null) {
  if (!item) return "无";
  const stats = [
    item.attackBonus ? `攻 +${item.attackBonus}` : null,
    item.defenseBonus ? `防 +${item.defenseBonus}` : null,
    item.agilityBonus ? `敏 +${item.agilityBonus}` : null,
    item.maxHpBonus ? `生命 +${item.maxHpBonus}` : null
  ].filter((entry): entry is string => entry !== null);
  return stats.length ? stats.join(" / ") : "无属性";
}

function equipmentAffixLine(item: EquipmentItemDto) {
  if (item.affixes.length === 0) return "无词缀";
  return item.affixes.map((affix) => `${affix.name} +${affix.value}`).join(" / ");
}

function dialogueTaskHint(target: NpcDialogueTargetDto) {
  if (!target.task) return null;
  const status = {
    open: "可接取",
    accepted: "进行中",
    completed: "已完成",
    expired: "已过期"
  }[target.task.status];
  return `${status}：${target.task.title}`;
}

export function GameShell({ csrfToken, onAuthExpired, onLogout }: GameShellProps) {
  const {
    state,
    activeModal,
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
    commands,
    view: {
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
      hungerWarning,
      damagedEquipment,
      acceptedTasks,
      selectedClass,
      cells,
      location
    }
  } = useGameController({
    csrfToken,
    ...(onAuthExpired ? { onAuthExpired } : {}),
    ...(onLogout ? { onLogout } : {})
  });

  const nextStep = useMemo(() => selectContextualObjective(state), [state]);
  const recentLog = useMemo(() => selectRecentLog(state, EVENT_LOG_LIMIT), [state]);
  const sceneObjects = useMemo(() => selectSceneObjects(state), [state]);

  if (!state.character) {
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
            onClick={() => void commands.createCharacter()}
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
          <p className="game-kicker">冒险者状态</p>
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
          {onLogout ? (
            <button
              type="button"
              className="game-secondary-button session-end-button"
              disabled={isBusy}
              onClick={() => void commands.endSession()}
            >
              退出登录
            </button>
          ) : null}
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>装备</h2>
            <span>{state.equipment.length} 件</span>
          </div>
          {state.equipment.length === 0 ? <p className="empty-copy">无</p> : null}
          <div className="equipment-slot-list" aria-label="已装备槽位">
            {state.equipment.map((item) => (
              <button
                type="button"
                className={`equipment-slot rarity-${item.rarity}`}
                key={item.id}
                aria-label={`${slotLabels[item.slot]} ${item.name} ${rarityLabels[item.rarity]} 耐久 ${item.durabilityPct}%`}
                onClick={() => commands.openEquipment(item)}
              >
                <span className="equipment-slot-label">{slotLabels[item.slot]}</span>
                <strong>{item.name}</strong>
                <span className="equipment-slot-meta">
                  {rarityLabels[item.rarity]} · 耐久 {item.durabilityPct}%
                </span>
                <div className="durability-bar" aria-hidden="true">
                  <span style={{ width: `${item.durabilityPct}%` }} />
                </div>
                {item.effectiveStatRatio < 1 ? (
                  <span className="equipment-warning">耐久归零</span>
                ) : null}
              </button>
            ))}
          </div>
          {damagedEquipment.length > 1 ? (
            <button
              type="button"
              className="game-secondary-button repair-all-button"
              disabled={!canRepairEquipment}
              onClick={() => void commands.repairAllEquipment()}
            >
              修理全部装备
            </button>
          ) : null}
        </section>

        <section className="game-panel">
          <div className="panel-heading">
            <h2>背包</h2>
            <span>{state.inventory.length + state.backpackEquipment.length} 类</span>
          </div>
          {state.inventory.length === 0 && state.backpackEquipment.length === 0 ? (
            <p className="empty-copy">空</p>
          ) : null}
          {state.backpackEquipment.length > 0 ? (
            <div className="inventory-equipment-list" aria-label="背包装备">
              {state.backpackEquipment.map((item) => (
                <button
                  type="button"
                  className={`inventory-equipment rarity-${item.rarity}`}
                  key={item.id}
                  onClick={() => commands.openEquipment(item)}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {slotLabels[item.slot]} · {rarityLabels[item.rarity]} · 装等 {item.itemLevel}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="inventory-list">
            {state.inventory.map((item) => (
              <div className="inventory-item-row" key={item.itemId}>
                <button
                  type="button"
                  className="inventory-item"
                  onClick={() => commands.openItem(item)}
                >
                  {item.name} x{item.quantity}
                </button>
                {canEatFood && isFoodItem(item) ? (
                  <button
                    type="button"
                    className="game-secondary-button eat-button"
                    onClick={() =>
                      void commands.eatFood(item.itemId)
                    }
                  >
                    食用 {item.name}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="game-panel lobby-panel" aria-labelledby="lobby-title">
          <div className="panel-heading">
            <h2 id="lobby-title">大厅</h2>
            <span>{sync.isSyncing ? "同步中" : "实时"}</span>
          </div>
          <div className="lobby-tabs" role="tablist" aria-label="大厅面板">
            <button
              type="button"
              className={lobbyTab === "chat" ? "is-selected" : ""}
              role="tab"
              aria-selected={lobbyTab === "chat"}
              onClick={() => setLobbyTab("chat")}
            >
              聊天
            </button>
            <button
              type="button"
              className={lobbyTab === "online" ? "is-selected" : ""}
              role="tab"
              aria-selected={lobbyTab === "online"}
              onClick={() => setLobbyTab("online")}
            >
              在线 {lobby.presence.length}
            </button>
            <button
              type="button"
              className={lobbyTab === "leaderboard" ? "is-selected" : ""}
              role="tab"
              aria-selected={lobbyTab === "leaderboard"}
              onClick={() => setLobbyTab("leaderboard")}
            >
              排行
            </button>
          </div>

          {lobbyTab === "chat" ? (
            <div className="lobby-chat-panel" role="tabpanel">
              <ol className="lobby-chat-list" aria-label="大厅聊天">
                {lobby.chat.length === 0 ? <li className="empty-copy">暂时没有大厅发言。</li> : null}
                {lobby.chat.map((message) => (
                  <li
                    className={`lobby-chat-message${message.kind === "system" ? " is-system" : ""}`}
                    key={message.id}
                  >
                    <span>{message.characterName}</span>
                    <p>{message.body}</p>
                  </li>
                ))}
              </ol>
              <form
                className="lobby-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void commands.submitLobbyChat();
                }}
              >
                <input
                  aria-label="大厅发言"
                  value={chatInput}
                  maxLength={240}
                  disabled={isChatSending}
                  onChange={(event) => setChatInput(event.target.value)}
                />
                <button
                  type="submit"
                  className="game-primary-button"
                  disabled={isChatSending || !chatInput.trim()}
                >
                  发送到大厅
                </button>
              </form>
              {chatStatus ? (
                <p role="status" aria-live="polite" className="dialogue-status">
                  {chatStatus}
                </p>
              ) : null}
            </div>
          ) : null}

          {lobbyTab === "online" ? (
            <ul className="lobby-presence-list" role="tabpanel" aria-label="在线角色">
              {lobby.presence.length === 0 ? <li className="empty-copy">当前没有在线角色。</li> : null}
              {lobby.presence.map((presence) => (
                <li key={`${presence.accountId}:${presence.characterId}`}>
                  {presence.characterName} · {locationText(presence.currentLocation)}
                </li>
              ))}
            </ul>
          ) : null}

          {lobbyTab === "leaderboard" ? (
            <div className="lobby-leaderboards" role="tabpanel" aria-label="排行榜">
              <section>
                <h3>等级榜</h3>
                <ol className="leaderboard-list">
                  {lobby.leaderboards.level.length === 0 ? <li className="empty-copy">暂无等级排行。</li> : null}
                  {lobby.leaderboards.level.map((entry) => (
                    <li key={entry.characterId}>
                      {entry.rank}. {entry.characterName} Lv.{entry.level}
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h3>财富榜</h3>
                <ol className="leaderboard-list">
                  {lobby.leaderboards.wealth.length === 0 ? <li className="empty-copy">暂无财富排行。</li> : null}
                  {lobby.leaderboards.wealth.map((entry) => (
                    <li key={entry.characterId}>
                      {entry.rank}. {entry.characterName} {entry.wealthCopper} 铜
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          ) : null}
        </section>
      </aside>

      <section className="game-main-panel" aria-label="场景与行动">
        <div className="location-header">
          <p className="game-kicker">场景</p>
          <h1 id="location-title">{state.locationTitle}</h1>
          <p>{state.locationDescription}</p>
        </div>

        <section className="world-scene-panel" aria-labelledby="scene-focus-title">
          <article className="scene-narrative">
            <div className="panel-heading">
              <h2 id="scene-focus-title">当前位置</h2>
              <span>{location.positionText}</span>
            </div>
            <div className="scene-copy">
              <p>{state.locationDescription}</p>
            </div>
            <div className="scene-object-list" aria-label="当前位置可交互对象">
              {sceneObjects.length === 0 ? (
                <div className="scene-object-card">
                  <strong>静默的四周</strong>
                  <span>暂时没有可辨认的交互对象。</span>
                </div>
              ) : null}
              {sceneObjects.map((entry) => (
                <div className="scene-object-card" key={entry.id}>
                  <strong>{entry.title}</strong>
                  <span>{entry.body}</span>
                </div>
              ))}
            </div>
          </article>

          <aside className="scene-decision-panel" aria-labelledby="next-step-title">
            <div className="panel-heading">
              <h2 id="next-step-title">下一步</h2>
              <span>{state.currentAction ? "行动中" : "空闲"}</span>
            </div>
            <div className="scene-tags" aria-label="当前位置标签">
              {canGather ? <span>采集推荐</span> : null}
              {canStartCombat ? <span>有遭遇</span> : null}
              {canReturnVillage ? <span>可返回</span> : null}
              {!state.map ? <span>村镇</span> : null}
            </div>
            <p className="objective-copy">{nextStep}</p>
          </aside>
        </section>

        <section className="quick-action-panel" aria-label="常用动作">
          <div className="panel-heading">
            <h2>动作</h2>
            <span>可执行</span>
          </div>
          <div className="game-actions">
            {canClaimRelief ? (
              <button
                type="button"
                className="game-primary-button"
                onClick={() => void commands.claimRelief()}
              >
                领取市政救济
              </button>
            ) : null}
            {canEnterForest ? (
              <button
                type="button"
                className="game-primary-button"
                onClick={() => void commands.enterCorruptForest()}
              >
                前往腐林
              </button>
            ) : null}
            {canEnterOldMine ? (
              <button
                type="button"
                className="game-secondary-button"
                onClick={() => void commands.enterOldMine()}
              >
                前往旧矿坑
              </button>
            ) : null}
            {canOpenMarket ? (
              <button
                type="button"
                className="game-secondary-button"
                onClick={() => void commands.openMarket()}
              >
                市政集市
              </button>
            ) : null}
            {canOpenDialogue ? (
              <button
                type="button"
                className="game-secondary-button"
                onClick={() => void commands.openDialogue()}
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
                  className="game-primary-button"
                  onClick={() =>
                    void commands.startGathering()
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
                onClick={() => void commands.startCombat()}
              >
                攻击野狼
              </button>
            ) : null}
            {canReturnVillage ? (
              <button
                type="button"
                className="game-secondary-button"
                onClick={() => void commands.returnToVillage()}
              >
                返回哨站
              </button>
            ) : null}
          </div>
        </section>

        {state.currentAction ? (
          <section className="active-action-panel" aria-labelledby="active-action-title">
            <div className="panel-heading">
              <h2 id="active-action-title">当前行动</h2>
              <span>总进度 {state.currentAction.progressPct}%</span>
            </div>
            <p>{state.currentAction.description}</p>
            <div className="action-progress" aria-hidden="true">
              <span style={{ width: `${state.currentAction.progressPct}%` }} />
            </div>
            {state.currentAction.actionType === "gathering" ? (
              <p className="action-meta">
                本轮采集 {state.currentAction.cycleProgressPct}% · 已入账{" "}
                {state.currentAction.settledCycles}/{state.currentAction.plannedCycles}
              </p>
            ) : null}
            {state.currentAction.expectedYield.length > 0 ? (
              <p className="action-meta">
                计划总产出：
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
                  onClick={commands.openCombat}
                >
                  查看战斗
                </button>
              ) : null}
              {canCancelAction ? (
                <button
                  type="button"
                  className="game-secondary-button"
                  onClick={() => void commands.cancelAction()}
                >
                  {state.currentAction.actionType === "combat" ? "撤离" : "取消行动"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {acceptedTasks.length > 0 ? (
          <section className="npc-task-tracker" aria-labelledby="npc-task-tracker-title">
            <div className="panel-heading">
              <h2 id="npc-task-tracker-title">任务追踪</h2>
              <span>{acceptedTasks.length} 项进行中</span>
            </div>
            <ul className="npc-task-tracker-list" aria-label="已接任务">
              {acceptedTasks.map((task) => {
                const playerQuantity =
                  state.inventory.find((item) => item.itemId === task.requestedItem.itemId)?.quantity ?? 0;
                return (
                  <li key={task.id}>
                    <strong>{task.title}</strong>
                    <span>
                      材料 {Math.min(playerQuantity, task.requestedItem.quantity)}/
                      {task.requestedItem.quantity} {task.requestedItem.name}
                    </span>
                    <span>发布者：{task.npcName}</span>
                    {canOpenDialogue ? (
                      <button
                        type="button"
                        className="game-secondary-button"
                        onClick={() => void commands.openDialogue()}
                      >
                        与 NPC 交谈
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

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

        <section className="event-log-panel" aria-labelledby="event-log-title">
          <div className="panel-heading">
            <h2 id="event-log-title">事件记录</h2>
            <span>最近 {recentLog.length}/{state.log.length}</span>
          </div>
          <ol className="game-log" aria-label="最近事件记录">
            {recentLog.map((entry) => (
              <li className="event-log-entry" key={entry.id}>
                <time dateTime={entry.createdAt}>{eventTimeText(entry.createdAt)}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        </section>
      </section>

      <aside className="game-column game-map-panel" aria-label="小地图与辅助信息">
        <section className="game-panel nav-map-panel">
          <div className="panel-heading">
            <h2>小地图</h2>
            {state.map ? <span>{state.map.width} x {state.map.height}</span> : <span>村镇</span>}
          </div>
          {state.map ? (
            <div
              className="mini-map"
              style={{ gridTemplateColumns: `repeat(${state.map.width}, minmax(0, 1fr))` }}
              aria-label="当前位置小地图"
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
          <div className="direction-pad">
            <button
              type="button"
              disabled={!canMove}
              className="direction-button north"
              aria-label="向北移动"
              onClick={() => void commands.move("north")}
            >
              W
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button west"
              aria-label="向西移动"
              onClick={() => void commands.move("west")}
            >
              A
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button south"
              aria-label="向南移动"
              onClick={() => void commands.move("south")}
            >
              S
            </button>
            <button
              type="button"
              disabled={!canMove}
              className="direction-button east"
              aria-label="向东移动"
              onClick={() => void commands.move("east")}
            >
              D
            </button>
          </div>
        </section>

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

        {offlineReport ? (
          <section className="offline-report-panel" aria-labelledby="offline-report-title">
            <div className="panel-heading">
              <h2 id="offline-report-title">{offlineReport.title}</h2>
              <span>{offlineReport.status === "success" ? "AI" : "模板"}</span>
            </div>
            <p>{offlineReport.summary}</p>
            {offlineReport.highlights.length > 0 ? (
              <ul>
                {offlineReport.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </aside>

      <ModalManager activeModal={activeModal} onClose={commands.closeModal}>
        {(modal, closeModal) => {
          if (modal.type === "equipment") {
            const current = state.equipment.find((item) => item.slot === modal.item.slot) ?? null;
            const isBackpackEquipment = state.backpackEquipment.some(
              (item) => item.id === modal.item.id
            );
            const powerDelta = equipmentPower(modal.item) - (current ? equipmentPower(current) : 0);
            return (
              <section
                className="equipment-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`${modal.item.name} ${isBackpackEquipment ? "装备对比" : "装备详情"}`}
              >
                <p className="game-kicker">
                  {isBackpackEquipment ? "Equipment Compare" : "Equipment Detail"}
                </p>
                <div className="panel-heading">
                  <h2>{modal.item.name}</h2>
                  <span>{rarityLabels[modal.item.rarity]}</span>
                </div>
                <div className={`equipment-compare-grid${isBackpackEquipment ? "" : " is-detail"}`}>
                  {isBackpackEquipment ? (
                    <article className="equipment-compare-card">
                    <p className="game-kicker">当前</p>
                    <h3>{current?.name ?? "空槽位"}</h3>
                    <dl className="stat-list">
                      <div>
                        <dt>槽位</dt>
                        <dd>{slotLabels[modal.item.slot]}</dd>
                      </div>
                      <div>
                        <dt>属性</dt>
                        <dd>{equipmentStatLine(current)}</dd>
                      </div>
                      <div>
                        <dt>词缀</dt>
                        <dd>{current ? equipmentAffixLine(current) : "无"}</dd>
                      </div>
                    </dl>
                  </article>
                  ) : null}
                  <article className={`equipment-compare-card rarity-${modal.item.rarity}`}>
                    <p className="game-kicker">{isBackpackEquipment ? "背包" : "已装备"}</p>
                    <h3>{modal.item.name}</h3>
                    <dl className="stat-list">
                      <div>
                        <dt>槽位</dt>
                        <dd>{slotLabels[modal.item.slot]}</dd>
                      </div>
                      <div>
                        <dt>属性</dt>
                        <dd>{equipmentStatLine(modal.item)}</dd>
                      </div>
                      <div>
                        <dt>词缀</dt>
                        <dd>{equipmentAffixLine(modal.item)}</dd>
                      </div>
                      <div>
                        <dt>耐久</dt>
                        <dd>{modal.item.currentDurability}/{modal.item.maxDurability}</dd>
                      </div>
                      <div>
                        <dt>修理</dt>
                        <dd>
                          {modal.item.repairQuote
                            ? `${moneyText(modal.item.repairQuote.copperCost)} + 基础铁矿石 x${modal.item.repairQuote.ironOreCost}`
                            : "无需修理"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </div>
                {isBackpackEquipment ? (
                  <p className={powerDelta >= 0 ? "equipment-delta is-positive" : "equipment-delta is-negative"}>
                    综合属性差异：{powerDelta >= 0 ? "+" : ""}
                    {powerDelta}
                  </p>
                ) : null}
                <div className="dialog-actions">
                  {isBackpackEquipment ? (
                    <button
                      type="button"
                      className="game-primary-button"
                      disabled={!canEquipEquipment}
                      onClick={() =>
                        void commands.equipBackpackEquipment(modal.item.id, closeModal)
                      }
                    >
                      装备
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="game-secondary-button"
                      disabled={!canRepairEquipment || !modal.item.repairQuote}
                      onClick={() => void commands.repairEquipment(modal.item.id)}
                    >
                      修理 {modal.item.name}
                    </button>
                  )}
                  <button type="button" className="game-secondary-button" onClick={closeModal}>
                    关闭
                  </button>
                </div>
              </section>
            );
          }

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
            const availableCopper = state.character?.money.totalCopper ?? 0;
            const hasUnaffordablePurchase = market.items.some(
              (item) => item.buyPrice.totalCopper > availableCopper
            );
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
                  {market.items.map((item) => {
                    const canAffordPurchase = item.buyPrice.totalCopper <= availableCopper;
                    return (
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
                          aria-describedby={
                            canAffordPurchase ? undefined : "market-purchase-funds-hint"
                          }
                          aria-label={
                            canAffordPurchase
                              ? undefined
                              : `购买 ${item.name}，铜币不足`
                          }
                          disabled={item.stockQuantity < 1 || !canAffordPurchase || isBusy}
                          onClick={() => void commands.buyMarketItem(item.itemId)}
                        >
                          购买 {item.name}
                        </button>
                        <button
                          type="button"
                          className="game-secondary-button"
                          disabled={item.playerQuantity < 1 || isBusy}
                          onClick={() => void commands.sellMarketItem(item.itemId)}
                        >
                          出售 {item.name}
                        </button>
                      </span>
                    </div>
                    );
                  })}
                </div>
                {hasUnaffordablePurchase ? (
                  <p id="market-purchase-funds-hint" className="market-status">
                    铜币不足的物品暂时不能购买。
                  </p>
                ) : null}
                {marketStatus ? (
                  <p role="status" aria-live="polite" className="market-status">
                    {marketStatus}
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

          if (modal.type === "dialogue") {
            const dialogueTask = dialogue?.target.task ?? null;
            const taskMaterialGap = dialogueTask
              ? Math.max(0, dialogueTask.requestedItem.quantity - dialogueTask.playerQuantity)
              : 0;
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
                  <span>{dialogue ? "对话" : "列表"}</span>
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
                        onClick={() => void commands.openNpcDialogue(target.npcActorId)}
                      >
                        <strong>
                          {target.task?.status === "open" ? "! " : ""}
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
                        {dialogueTask ? (
                          <section className="dialogue-task-summary" aria-label="NPC 任务">
                            <strong>{dialogueTaskHint(dialogue.target)}</strong>
                            <p>
                              需要 {dialogueTask.requestedItem.name} x
                              {dialogueTask.requestedItem.quantity}
                            </p>
                            <p>奖励 {moneyText(dialogueTask.rewardCopper)}</p>
                            {taskMaterialGap > 0 ? (
                              <p className="dialogue-task-gap">还差 {taskMaterialGap} 份材料</p>
                            ) : null}
                            {dialogueTask.status === "open" ? (
                              <div className="dialogue-task-actions">
                                <button
                                  type="button"
                                  className="game-secondary-button"
                                  disabled={!canInteractWithTasks}
                                  onClick={() => void commands.acceptNpcTask(dialogueTask.id)}
                                >
                                  接取任务
                                </button>
                              </div>
                            ) : null}
                            {dialogueTask.status === "accepted" ? (
                              <div className="dialogue-task-actions">
                                <button
                                  type="button"
                                  className="game-secondary-button"
                                  disabled={!canInteractWithTasks || taskMaterialGap > 0}
                                  onClick={() => void commands.completeNpcTask(dialogueTask.id)}
                                >
                                  提交任务
                                </button>
                              </div>
                            ) : null}
                          </section>
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
                            void commands.submitDialogueMessage();
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
