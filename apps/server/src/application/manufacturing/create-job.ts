// M13-C 创建制造工单薄用例：只负责事务边界；业务语义在 industry.manufacturing
// （m13-p-contract.md §3—§4）。另把 BaseOperationError 再导出给 transport 路由
// （transport 仅可 import application）。
import type {
  CreateManufacturingJobInputDto,
  CreateManufacturingJobResultDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import {
  BaseOperationError,
  ManufacturingService
} from "../../modules/industry/manufacturing.service.js";

export { BaseOperationError };

export interface ManufacturingPrincipal {
  accountId: string;
}

export interface CreateManufacturingJobUseCase {
  execute(
    principal: ManufacturingPrincipal,
    input: CreateManufacturingJobInputDto
  ): Promise<CreateManufacturingJobResultDto>;
}

export class CreateManufacturingJobCase implements CreateManufacturingJobUseCase {
  constructor(
    private readonly db: Db,
    private readonly service: ManufacturingService
  ) {}

  execute(
    principal: ManufacturingPrincipal,
    input: CreateManufacturingJobInputDto
  ): Promise<CreateManufacturingJobResultDto> {
    return this.db.transaction((tx) => this.service.create(tx, principal, input));
  }
}
