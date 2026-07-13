import type { CharacterDto } from "@ai-mud/shared";

export interface CharacterStatusPanelProps {
  character: CharacterDto;
  hungerWarning?: string | null;
  isLogoutDisabled?: boolean;
  onLogout?: () => void | Promise<void>;
}

function moneyText(character: CharacterDto) {
  const { gold, silver, copper } = character.money;
  return `金币 ${gold} | 银币 ${silver} | 铜币 ${copper}`;
}

export function CharacterStatusPanel({
  character,
  hungerWarning = null,
  isLogoutDisabled = false,
  onLogout
}: CharacterStatusPanelProps) {
  return (
    <section className="game-panel">
      <p className="game-kicker">冒险者状态</p>
      <h2>{character.name}</h2>
      <dl className="stat-list">
        <div>
          <dt>等级</dt>
          <dd>{character.level}</dd>
        </div>
        <div>
          <dt>经验</dt>
          <dd>{character.xp}</dd>
        </div>
        <div>
          <dt>生命</dt>
          <dd>{character.hp}/{character.maxHp}</dd>
        </div>
        <div>
          <dt>饱腹</dt>
          <dd>
            饱腹 {character.needs.hunger.current}/{character.needs.hunger.max}
          </dd>
        </div>
        <div>
          <dt>货币</dt>
          <dd>{moneyText(character)}</dd>
        </div>
      </dl>
      {hungerWarning ? <p className="needs-warning">{hungerWarning}</p> : null}
      {onLogout ? (
        <button
          type="button"
          className="game-secondary-button session-end-button"
          disabled={isLogoutDisabled}
          onClick={() => void onLogout()}
        >
          退出登录
        </button>
      ) : null}
    </section>
  );
}
