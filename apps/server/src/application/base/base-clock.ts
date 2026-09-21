import type { BaseClockCommandInputDto } from "@ai-mud/shared";
import type {
  BasePrincipal,
  ClockCommandResultDto,
  ClockHeartbeatResultDto,
  ClockUseCase
} from "./ports.js";
import type { BaseService } from "../../modules/world-runtime/base.service.js";

// M12-A：时钟用例薄壳（heartbeat 续租 / pause|resume|set_speed 命令）。
// 推进政策（running + 租约 + 追补上限）封装在 world BaseRepository.lockAdvanceableBases
// 内，由结算线（M12-B）经 BaseClockStorePort 消费；本用例只管命令面。

export class BaseClockUseCase implements ClockUseCase {
  constructor(private readonly service: BaseService) {}

  heartbeat(principal: BasePrincipal): Promise<ClockHeartbeatResultDto> {
    return this.service.heartbeat(principal);
  }

  applyCommand(
    principal: BasePrincipal,
    input: BaseClockCommandInputDto
  ): Promise<ClockCommandResultDto> {
    return this.service.applyCommand(principal, input);
  }
}
