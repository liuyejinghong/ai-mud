import type {
  ChatMessageDto,
  GameLocationId,
  LeaderboardEntryDto,
  PresenceDto
} from "@ai-mud/shared";

export type LobbyPanelTab = "chat" | "online" | "leaderboard";

export interface LobbyPanelProps {
  chatMessages: readonly ChatMessageDto[];
  presence: readonly PresenceDto[];
  levelLeaderboard: readonly LeaderboardEntryDto[];
  wealthLeaderboard: readonly LeaderboardEntryDto[];
  activeTab: LobbyPanelTab;
  chatInput: string;
  chatStatus?: string | null;
  isChatSending: boolean;
  isSyncing: boolean;
  onTabChange: (tab: LobbyPanelTab) => void;
  onChatInputChange: (value: string) => void;
  onSubmitChat: () => void | Promise<void>;
}

const locationLabels: Record<GameLocationId, string> = {
  blackpine_outpost: "黑松哨站",
  corrupt_forest: "腐林",
  old_mine: "旧矿坑",
  ash_watch: "灰烬哨岗"
};

const scrollableContentStyle = { maxHeight: 220, overflowY: "auto" } as const;

export function LobbyPanel({
  chatMessages,
  presence,
  levelLeaderboard,
  wealthLeaderboard,
  activeTab,
  chatInput,
  chatStatus = null,
  isChatSending,
  isSyncing,
  onTabChange,
  onChatInputChange,
  onSubmitChat
}: LobbyPanelProps) {
  return (
    <section className="game-panel lobby-panel" aria-labelledby="lobby-title">
      <div className="panel-heading">
        <h2 id="lobby-title">大厅</h2>
        <span>{isSyncing ? "同步中" : "实时"}</span>
      </div>
      <div className="lobby-tabs" role="tablist" aria-label="大厅面板">
        <button
          type="button"
          className={activeTab === "chat" ? "is-selected" : ""}
          role="tab"
          aria-selected={activeTab === "chat"}
          onClick={() => onTabChange("chat")}
        >
          聊天
        </button>
        <button
          type="button"
          className={activeTab === "online" ? "is-selected" : ""}
          role="tab"
          aria-selected={activeTab === "online"}
          onClick={() => onTabChange("online")}
        >
          在线 {presence.length}
        </button>
        <button
          type="button"
          className={activeTab === "leaderboard" ? "is-selected" : ""}
          role="tab"
          aria-selected={activeTab === "leaderboard"}
          onClick={() => onTabChange("leaderboard")}
        >
          排行
        </button>
      </div>

      {activeTab === "chat" ? (
        <div className="lobby-chat-panel" role="tabpanel">
          <ol className="lobby-chat-list" aria-label="大厅聊天">
            {chatMessages.length === 0 ? <li className="empty-copy">暂时没有大厅发言。</li> : null}
            {chatMessages.map((message) => (
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
              void onSubmitChat();
            }}
          >
            <input
              aria-label="大厅发言"
              value={chatInput}
              maxLength={240}
              disabled={isChatSending}
              onChange={(event) => onChatInputChange(event.target.value)}
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

      {activeTab === "online" ? (
        <ul
          className="lobby-presence-list"
          role="tabpanel"
          aria-label="在线角色"
          style={scrollableContentStyle}
        >
          {presence.length === 0 ? <li className="empty-copy">当前没有在线角色。</li> : null}
          {presence.map((entry) => (
            <li key={`${entry.accountId}:${entry.characterId}`}>
              {entry.characterName} · {locationLabels[entry.currentLocation]}
            </li>
          ))}
        </ul>
      ) : null}

      {activeTab === "leaderboard" ? (
        <div
          className="lobby-leaderboards"
          role="tabpanel"
          aria-label="排行榜"
          style={scrollableContentStyle}
        >
          <section>
            <h3>等级榜</h3>
            <ol className="leaderboard-list">
              {levelLeaderboard.length === 0 ? <li className="empty-copy">暂无等级排行。</li> : null}
              {levelLeaderboard.map((entry) => (
                <li key={entry.characterId}>
                  {entry.rank}. {entry.characterName} Lv.{entry.level}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3>财富榜</h3>
            <ol className="leaderboard-list">
              {wealthLeaderboard.length === 0 ? <li className="empty-copy">暂无财富排行。</li> : null}
              {wealthLeaderboard.map((entry) => (
                <li key={entry.characterId}>
                  {entry.rank}. {entry.characterName} {entry.wealthCopper} 铜币
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </section>
  );
}
