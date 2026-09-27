// D013：基地事件历史（base_events 唯一写者 = world.base）。
// 事件是结算点（工程完工/制造完工/采矿送达/订单交付）在同一事务内追加的只读流水；
// industry/economy 等模块经 composition 绑定的结构端口 `(tx) => new BaseEventRepository(tx)`
// 追加，不各自直写 SQL（与 AssetMutationService 回执模式一致）。
// 所有方法必须在调用方事务内执行，本类永不开启或提交事务。
// append 不做去重：上游结算点各自幂等（完成态迁移/送达标记/命令回执保证同一事实
// 只提交一次；事务回滚则事件随事实一起回滚）。
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseEvents } from "../../db/schema.js";

export type BaseEventTx = Pick<Db, "delete" | "insert" | "select" | "update">;

// 事件类型字面量（transport/前端契约是 string；此处收窄服务端可写的集合）。
export type BaseEventType =
  | "project.completed"
  | "manufacturing.completed"
  | "extraction.delivered"
  | "order.delivered";

export interface BaseEventRecord {
  id: string;
  type: string;
  title: string;
  detail: string;
  simTime: Date;
  createdAt: Date;
}

export interface BaseEventAppendInput {
  baseId: string;
  type: BaseEventType;
  title: string;
  detail: string;
  simTime: Date;
}

export class BaseEventRepository {
  constructor(private readonly db: BaseEventTx) {}

  // 与 AssetMutationService 同模式：实例绑定调用方事务，方法不再收 tx。
  async append(input: BaseEventAppendInput): Promise<void> {
    await this.db.insert(baseEvents).values({
      baseId: input.baseId,
      type: input.type,
      title: input.title,
      detail: input.detail,
      simTime: input.simTime
    });
  }

  // 按 created_at 降序（同刻按 id 降序稳定排序）；limit 由调用方钳制（1—200）。
  async listForBase(baseId: string, limit: number): Promise<BaseEventRecord[]> {
    return this.db
      .select({
        id: baseEvents.id,
        type: baseEvents.type,
        title: baseEvents.title,
        detail: baseEvents.detail,
        simTime: baseEvents.simTime,
        createdAt: baseEvents.createdAt
      })
      .from(baseEvents)
      .where(eq(baseEvents.baseId, baseId))
      .orderBy(desc(baseEvents.createdAt), desc(baseEvents.id))
      .limit(limit);
  }
}
