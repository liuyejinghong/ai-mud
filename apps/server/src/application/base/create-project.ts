// M12-B 创建项目薄用例：只负责事务边界；业务语义在 industry.construction（§3.4—§3.5）。
// 另把 BaseOperationError 再导出给 transport 路由（transport 仅可 import application）。
import type {
  CreateProjectInputDto,
  CreateProjectResultDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import type { ConstructionService } from "../../modules/industry/construction.service.js";
export { BaseOperationError } from "../../modules/industry/construction.service.js";
import type { BasePrincipal, CreateProjectUseCase } from "./ports.js";

export class CreateProjectCase implements CreateProjectUseCase {
  constructor(
    private readonly db: Db,
    private readonly service: ConstructionService
  ) {}

  execute(principal: BasePrincipal, input: CreateProjectInputDto): Promise<CreateProjectResultDto> {
    return this.db.transaction((tx) => this.service.create(tx, principal, input));
  }
}
