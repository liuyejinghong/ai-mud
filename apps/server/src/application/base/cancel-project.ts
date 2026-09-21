// M12-B 取消项目薄用例：只负责事务边界；业务语义在 industry.construction（§3.4—§3.5）。
import type { Db } from "../../db/client.js";
import type { ConstructionService } from "../../modules/industry/construction.service.js";
import type {
  BasePrincipal,
  CancelProjectResultDto,
  CancelProjectUseCase
} from "./ports.js";

export class CancelProjectCase implements CancelProjectUseCase {
  constructor(
    private readonly db: Db,
    private readonly service: ConstructionService
  ) {}

  execute(
    principal: BasePrincipal,
    input: { projectId: string; commandId: string }
  ): Promise<CancelProjectResultDto> {
    return this.db.transaction((tx) => this.service.cancel(tx, principal, input));
  }
}
