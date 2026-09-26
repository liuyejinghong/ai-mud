import type {
  CooperationDecisionInputDto,
  CooperationDecisionResultDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { AssetMutationService, hashRequest } from "../../modules/ledger/asset-mutation.service.js";
import { BaseOperationError } from "../../modules/world-runtime/base.service.js";
import type { BasePrincipal, BaseTx, CooperationDecisionUseCase } from "./ports.js";

const COMMAND_KIND = "base.cooperation_decision";

interface BaseLookup {
  findBaseIdByAccount(tx: BaseTx, accountId: string): Promise<string | null>;
  getBaseForUpdate(tx: BaseTx, baseId: string): Promise<{
    id: string;
    accountId: string;
    epoch: number;
    simTime: Date;
  } | null>;
}

interface DecisionParticipant {
  decide(
    tx: BaseTx,
    baseId: string,
    input: CooperationDecisionInputDto & { requestId: string; decisionId: string; nowSimTime: Date }
  ): Promise<Omit<CooperationDecisionResultDto, "duplicate">>;
}

export class CooperationDecisionCase implements CooperationDecisionUseCase {
  constructor(
    private readonly db: Db,
    private readonly lookup: BaseLookup,
    private readonly participant: DecisionParticipant
  ) {}

  execute(
    principal: BasePrincipal,
    input: CooperationDecisionInputDto & { requestId: string }
  ): Promise<CooperationDecisionResultDto> {
    return this.db.transaction(async (tx) => {
      const baseId = await this.lookup.findBaseIdByAccount(tx, principal.accountId);
      if (!baseId) throw new BaseOperationError("BASE_SCOPE_INVALID", "基地不存在。");
      const base = await this.lookup.getBaseForUpdate(tx, baseId);
      if (!base || base.accountId !== principal.accountId) {
        throw new BaseOperationError("BASE_SCOPE_INVALID", "基地不存在。");
      }

      const receipts = new AssetMutationService(tx);
      const actorScope = `base:${baseId}`;
      const requestHash = hashRequest({
        requestId: input.requestId,
        action: input.action,
        expectedHelperOperatorId: input.expectedHelperOperatorId ?? null
      });
      const replay = async (): Promise<CooperationDecisionResultDto | null> => {
        const receipt = await receipts.findReceiptForUpdate(
          actorScope,
          COMMAND_KIND,
          input.commandId,
          base.epoch
        );
        if (!receipt) return null;
        if (receipt.requestHash !== requestHash) {
          throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "同一命令编号已用于不同选择。");
        }
        const result = receipt.result as Partial<CooperationDecisionResultDto>;
        if (result.status !== "accepted" && result.status !== "declined") {
          throw new BaseOperationError("CONFLICT", "协作选择尚未完成，请稍后重试。");
        }
        return {
          requestId: input.requestId,
          status: result.status,
          ...(result.helperOperatorId ? { helperOperatorId: result.helperOperatorId } : {}),
          duplicate: true
        };
      };

      const existing = await replay();
      if (existing) return existing;
      const claimed = await receipts.claimReceipt({
        actorScope,
        commandKind: COMMAND_KIND,
        commandId: input.commandId,
        worldEpoch: base.epoch,
        requestHash
      });
      if (!claimed) {
        const raced = await replay();
        if (raced) return raced;
        throw new BaseOperationError("CONFLICT", "协作选择正在处理，请稍后重试。");
      }

      const decided = await this.participant.decide(tx, baseId, {
        requestId: input.requestId,
        action: input.action,
        commandId: input.commandId,
        decisionId: input.commandId,
        nowSimTime: base.simTime,
        ...(input.expectedHelperOperatorId
          ? { expectedHelperOperatorId: input.expectedHelperOperatorId }
          : {})
      });
      const result = { ...decided, duplicate: false };
      await receipts.saveReceiptResult({
        actorScope,
        commandKind: COMMAND_KIND,
        commandId: input.commandId,
        worldEpoch: base.epoch,
        result
      });
      return result;
    });
  }
}
