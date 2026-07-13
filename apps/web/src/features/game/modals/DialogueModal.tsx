import { dialogueTaskHint, moneyText } from "./modalFormatters";
import type { GameModalContext } from "./modalTypes";

export function DialogueModal({ context }: { context: GameModalContext }) {
  const {
    state,
    dialogueTargets,
    dialogue,
    dialogueInput,
    onDialogueInputChange,
    dialogueStatus,
    isBusy,
    canInteractWithTasks,
    commands,
    closeModal
  } = context;
  const dialogueTask = dialogue?.target.task ?? null;
  const taskMaterialGap = dialogueTask
    ? Math.max(
        0,
        dialogueTask.requestedItem.quantity -
          (state.inventory.find((item) => item.itemId === dialogueTask.requestedItem.itemId)?.quantity ?? 0)
      )
    : 0;

  return (
    <section className="dialogue-dialog" role="dialog" aria-modal="true" aria-label="附近 NPC 对话">
      <p className="game-kicker">NPC 对话</p>
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
              className={target.npcActorId === dialogue?.target.npcActorId ? "is-selected" : ""}
              key={target.npcActorId}
              disabled={isBusy}
              onClick={() => void commands.openNpcDialogue(target.npcActorId)}
            >
              <strong>{target.task?.status === "open" ? "! " : ""}{target.name}</strong>
              <span>{target.statusLine}</span>
              {dialogueTaskHint(target) ? <span className="dialogue-task-hint">{dialogueTaskHint(target)}</span> : null}
            </button>
          ))}
        </aside>
        <section className="dialogue-thread" aria-label="对话记录">
          {dialogue ? (
            <>
              {dialogueTask ? (
                <section className="dialogue-task-summary" aria-label="NPC 任务">
                  <strong>{dialogueTaskHint(dialogue.target)}</strong>
                  <p>需要 {dialogueTask.requestedItem.name} x{dialogueTask.requestedItem.quantity}</p>
                  <p>奖励 {moneyText(dialogueTask.rewardCopper)}</p>
                  {taskMaterialGap > 0 ? <p className="dialogue-task-gap">还差 {taskMaterialGap} 份材料</p> : null}
                  {dialogueTask.status === "open" ? (
                    <div className="dialogue-task-actions">
                      <button
                        type="button"
                        className="game-secondary-button"
                        disabled={!canInteractWithTasks}
                        onClick={() => void commands.acceptNpcTask(dialogueTask.id)}
                      >接取任务</button>
                    </div>
                  ) : null}
                  {dialogueTask.status === "accepted" ? (
                    <div className="dialogue-task-actions">
                      <button
                        type="button"
                        className="game-secondary-button"
                        disabled={!canInteractWithTasks || taskMaterialGap > 0}
                        onClick={() => void commands.completeNpcTask(dialogueTask.id)}
                      >提交任务</button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <ol>
                {dialogue.messages.length === 0 ? <li>还没有交谈记录。</li> : null}
                {dialogue.messages.map((message) => (
                  <li className={`speaker-${message.speakerType}`} key={message.id}>
                    <span>{message.speakerType === "player" ? state.character?.name : dialogue.target.name}</span>
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
                  onChange={(event) => onDialogueInputChange(event.target.value)}
                />
                <button type="submit" className="game-primary-button" disabled={isBusy || !dialogueInput.trim()}>发送</button>
              </form>
            </>
          ) : <p className="empty-copy">选择一个 NPC 开始交谈。</p>}
        </section>
      </div>
      {dialogueStatus ? <p role="status" aria-live="polite" className="dialogue-status">{dialogueStatus}</p> : null}
      <div className="dialog-actions"><button type="button" className="game-primary-button" onClick={closeModal}>关闭</button></div>
    </section>
  );
}
