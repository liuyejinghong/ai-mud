import type { BaseEventsResponseDto } from "@ai-mud/shared";
import type { BasePrincipal } from "./ports.js";
import type { BaseRepoTx, BaseRepository } from "../../modules/world-runtime/base.repository.js";
import { BaseEventRepository } from "../../modules/world-runtime/base-event.repository.js";
import { BaseOperationError } from "../../modules/world-runtime/base.service.js";
import type { Db } from "../../db/client.js";

// D013 事件历史用例薄壳：鉴权同快照（会话 → 账号作用域基地），只读投影
// base_events（world/base-event 唯一写者的结算流水）。快照为纯读，这里同样
// 不写任何事实；limit 由路由解析、本用例钳制（1—200，缺省 100）。

export const BASE_EVENTS_DEFAULT_LIMIT = 100;
export const BASE_EVENTS_MAX_LIMIT = 200;

export class BaseEventsUseCase {
  constructor(
    private readonly deps: {
      db: Db;
      repo: BaseRepository;
      // 事务绑定工厂：读必须在调用方事务内（与写口同一绑定模式）。
      events: (tx: BaseRepoTx) => BaseEventRepository;
    }
  ) {}

  async execute(
    principal: BasePrincipal,
    input: { limit?: number }
  ): Promise<BaseEventsResponseDto> {
    const requested = input.limit ?? BASE_EVENTS_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.floor(requested), 1), BASE_EVENTS_MAX_LIMIT);
    return this.deps.db.transaction(async (tx) => {
      const scopedTx = tx as unknown as BaseRepoTx;
      const baseId = await this.deps.repo.findBaseIdByAccount(scopedTx, principal.accountId);
      if (!baseId) {
        // 与快照同语义：不泄漏其他账号基地的存在性。
        throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");
      }
      const rows = await this.deps.events(scopedTx).listForBase(baseId, limit);
      return {
        events: rows.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          detail: row.detail,
          simTime: row.simTime.toISOString(),
          createdAt: row.createdAt.toISOString()
        }))
      };
    });
  }
}
