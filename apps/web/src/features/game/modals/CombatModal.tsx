import type { GameStateDto } from "@ai-mud/shared";

export function CombatModal({ state, closeModal }: { state: GameStateDto; closeModal: () => void }) {
  if (state.currentAction?.actionType !== "combat") return null;

  return (
    <section className="item-dialog" role="dialog" aria-modal="true" aria-label="战斗详情">
      <p className="game-kicker">战斗详情</p>
      <h2>战斗详情</h2>
      <ol className="combat-log">
        {state.currentAction.combatLog.map((message) => <li key={message}>{message}</li>)}
      </ol>
      <div className="dialog-actions"><button type="button" className="game-primary-button" onClick={closeModal}>关闭</button></div>
    </section>
  );
}
