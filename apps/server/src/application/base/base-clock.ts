import type { BaseClockCommandInputDto } from "@ai-mud/shared";
import type {
  BasePrincipal,
  ClockCommandResultDto
} from "./ports.js";
import type { BaseService } from "../../modules/world-runtime/base.service.js";

// 事务边界在 BaseService；应用层经 composition 注入 industry 已确认时段结算参与者。

export class BaseClockUseCase {
  constructor(private readonly service: BaseService) {}

  heartbeat(
    principal: BasePrincipal,
    input: { action: "acquire" | "renew" | "release"; controlToken?: string | null }
  ) {
    return this.service.heartbeat(principal, input);
  }

  applyCommand(
    principal: BasePrincipal,
    input: BaseClockCommandInputDto,
    controlToken?: string
  ): Promise<ClockCommandResultDto> {
    return this.service.applyCommand(principal, input, controlToken);
  }
}
