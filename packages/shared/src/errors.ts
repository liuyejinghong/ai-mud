export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "ACTIVATION_CODE_INVALID"
  | "ACTIVATION_CODE_USED"
  | "ACTIVATION_CODE_EXPIRED"
  | "ACCOUNT_DISABLED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "BASE_SCOPE_INVALID"
  | "CONTROL_EXPIRED"
  | "REVISION_EXPIRED"
  | "CONTENT_INCOMPATIBLE"
  | "RESOURCE_INSUFFICIENT"
  | "SITE_OCCUPIED"
  | "REQUIREMENTS_NOT_MET"
  | "BUDGET_EXCEEDED"
  | "IDEMPOTENCY_CONFLICT"
  | "DEVICE_BUSY"
  | "CAPABILITY_UNAVAILABLE";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    // 可选机器可读原因（D010）：当前仅控制权失效（CONTROL_EXPIRED）携带，
    // 取值见 base.ts 的 ControlFailureReason（GHOST_LEASE / HEARTBEAT_STALE），
    // 供前端区分"接管可收回"与"心跳断档过期"。
    reason?: string;
  };
}
