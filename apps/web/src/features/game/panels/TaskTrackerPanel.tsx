import type { InventoryItemDto, NpcTaskDto } from "@ai-mud/shared";

export interface TaskTrackerPanelProps {
  tasks: readonly NpcTaskDto[];
  inventory: readonly InventoryItemDto[];
  canOpenDialogue: boolean;
  onOpenDialogue: () => void | Promise<void>;
}

export function TaskTrackerPanel({
  tasks,
  inventory,
  canOpenDialogue,
  onOpenDialogue
}: TaskTrackerPanelProps) {
  const acceptedTasks = tasks.filter((task) => task.status === "accepted");
  if (acceptedTasks.length === 0) return null;

  return (
    <section className="npc-task-tracker" aria-labelledby="npc-task-tracker-title">
      <div className="panel-heading">
        <h2 id="npc-task-tracker-title">任务追踪</h2>
        <span>{acceptedTasks.length} 项进行中</span>
      </div>
      <ul className="npc-task-tracker-list" aria-label="已接任务">
        {acceptedTasks.map((task) => {
          const playerQuantity =
            inventory.find((item) => item.itemId === task.requestedItem.itemId)?.quantity ?? 0;

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
                  onClick={() => void onOpenDialogue()}
                >
                  与 NPC 交谈
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
