import type { BasePrincipal, ResetBaseResultDto, ResetUseCase } from "./ports.js";
import type { BaseResetService } from "../../modules/world-reset/base-reset.service.js";

// 账号重开（删档重开）用例薄壳。构造收 world-reset 的 BaseResetService
// （application → world-reset 登记模块的允许边），事务/删除/重建编排都在服务内；
// transport 只消费本用例端口，不接触重开内部。

export class ResetBaseUseCase implements ResetUseCase {
  constructor(private readonly service: BaseResetService) {}

  execute(
    principal: BasePrincipal,
    input: { commandId?: string }
  ): Promise<ResetBaseResultDto> {
    const normalized =
      input.commandId === undefined ? {} : { commandId: input.commandId };
    return this.service.resetBase(principal, normalized);
  }
}
