// M13-C 取消制造工单薄用例：只负责事务边界；业务语义在 industry.manufacturing
// （m13-p-contract.md §3—§4）。
import type { CancelManufacturingJobResultDto } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import type { ManufacturingService } from "../../modules/industry/manufacturing.service.js";
import type { ManufacturingPrincipal } from "./create-job.js";

export interface CancelManufacturingJobUseCase {
  execute(
    principal: ManufacturingPrincipal,
    input: { jobId: string; commandId: string }
  ): Promise<CancelManufacturingJobResultDto>;
}

export class CancelManufacturingJobCase implements CancelManufacturingJobUseCase {
  constructor(
    private readonly db: Db,
    private readonly service: ManufacturingService
  ) {}

  execute(
    principal: ManufacturingPrincipal,
    input: { jobId: string; commandId: string }
  ): Promise<CancelManufacturingJobResultDto> {
    return this.db.transaction((tx) => this.service.cancel(tx, principal, input));
  }
}
