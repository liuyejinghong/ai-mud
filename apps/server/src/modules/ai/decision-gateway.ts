// M14-A 决策网关（m14-p-contract.md §2/§3 冻结语义；decision_records 唯一写者）。
// 职责：把 DecisionRequestDto 交给注入的 DecisionProvider（默认 RuleDecisionProvider，
// SHADOW/LIVE seam——provider 未配置即安全回退 RULE），施加 deadline 超时保护
// （Promise.race + DECISION_TIMEOUT_MS，超时 abstain、provider 记 "timeout"），并把每次
// 决策写入 decision_records 审计（mode 常量 "rule"；只审计，不授权）。审计写失败不吞：
// 直接抛出，由调用方事务整体回滚（审计必须落）。
// 必须在调用方事务内执行（decide 接收 tx），本网关永不自开或提交事务；构造时的 db 仅
// 保存引用供组合根校验/后续只读扩展，decide 的写路径一律走 tx。
import type { DecisionCandidateDto, DecisionMode, DecisionOutcomeDto, DecisionRequestDto } from "@ai-mud/shared";
import { DECISION_TIMEOUT_MS } from "@ai-mud/shared";
// 审计写入口由 composition 注入（ai 模块不直接访问 DB——能力分层）。
import {
  RuleDecisionProvider,
  type DecisionCandidateScore,
  type DecisionProvider,
  type DecisionProviderResult
} from "./decision-provider.js";

// 只写审计行：插入面即可（不 update/delete）。
// 事务占位类型：调用方（industry 结算）在事务内调用；审计写已由注入端口承担，
// 本网关自身不再触碰数据库（能力分层）。gateway 不读写该参数，仅透传给 provider 上下文。
export type DecisionTx = unknown; // 事务占位：网关不读写，宽松以适配任意调用方 tx。

// RULE 模式常量（shadow/live seam：mode 字段已在协议中，本版实现只走 rule）。
export const DECISION_RULE_MODE: DecisionMode = "rule";

// 超时兜底 provider 名（审计可见：这条弃权是网关超时保护产生的，不是 provider 意见）。
export const DECISION_TIMEOUT_PROVIDER_NAME = "timeout";

const TIMEOUT_REASON = "决策超时，本次弃权";

export interface DecisionAuditRow {
  decisionId: string;
  purpose: string;
  mode: string;
  provider: string;
  baseId: string | null;
  planRevision: number;
  question: string;
  candidates: unknown[];
  selectedCandidateId: string | null;
  latencyMs: number;
}

export interface DecisionGatewayDeps {
  // 审计写入（注入）：实现在 composition（写 decision_records 表）。
  recordAudit(row: DecisionAuditRow): Promise<void>;
  // 未注入时默认 RuleDecisionProvider（provider 未配置→安全回退 RULE，合同 §1）。
  provider?: DecisionProvider;
  clock?: { now(): Date };
  // 测试可注入更短窗口；生产默认 DECISION_TIMEOUT_MS。
  timeoutMs?: number;
}

export class DecisionGateway {
  private readonly provider: DecisionProvider;
  private readonly clock: { now(): Date };
  private readonly timeoutMs: number;

  constructor(private readonly deps: DecisionGatewayDeps) {
    this.provider = deps.provider ?? new RuleDecisionProvider();
    this.clock = deps.clock ?? { now: () => new Date() };
    this.timeoutMs = deps.timeoutMs ?? DECISION_TIMEOUT_MS;
  }

  async decide(tx: DecisionTx, request: DecisionRequestDto): Promise<DecisionOutcomeDto> {
    const startedAt = this.clock.now();

    // 候选投影：provider 只见 candidateId + score（决策只选 ID，不改候选语义）。
    const providerRequest = {
      purpose: request.purpose,
      question: request.question,
      candidates: request.candidates.map(
        (candidate): DecisionCandidateScore => ({
          candidateId: candidate.candidateId,
          score: candidate.score
        })
      ),
      deadlineMs: request.deadlineMs
    };

    const outcome = await this.raceProvider(providerRequest);

    // 候选语义保护（合同 §1）：provider 返回的 ID 不在候选内 → 视为弃权。
    const selectedCandidateId =
      outcome.selectedCandidateId !== null &&
      request.candidates.some((candidate) => candidate.candidateId === outcome.selectedCandidateId)
        ? outcome.selectedCandidateId
        : null;

    const latencyMs = Math.max(0, this.clock.now().getTime() - startedAt.getTime());

    // 审计必须落库：写失败不吞，抛出让调用方事务回滚。
    await this.deps.recordAudit({
      decisionId: request.decisionId,
      purpose: request.purpose,
      mode: DECISION_RULE_MODE,
      provider: outcome.provider,
      baseId: request.baseId,
      planRevision: request.planRevision,
      question: request.question,
      candidates: request.candidates,
      selectedCandidateId,
      latencyMs
    });

    return {
      decisionId: request.decisionId,
      selectedCandidateId,
      mode: DECISION_RULE_MODE,
      provider: outcome.provider,
      latencyMs,
      reason: outcome.reason
    };
  }

  // deadline 超时保护：provider 结果与超时兜底竞速；超时 abstain（provider="timeout"）。
  // 迟到的 provider 结果被丢弃（迟到保护），不产生第二次写入。
  private async raceProvider(request: {
    purpose: DecisionRequestDto["purpose"];
    question: string;
    candidates: DecisionCandidateScore[];
    deadlineMs: number;
  }): Promise<DecisionProviderResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DecisionProviderResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            selectedCandidateId: null,
            provider: DECISION_TIMEOUT_PROVIDER_NAME,
            reason: TIMEOUT_REASON
          }),
        this.timeoutMs
      );
    });
    try {
      return await Promise.race([this.provider.decide(request), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
