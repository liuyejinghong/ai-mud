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
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}
