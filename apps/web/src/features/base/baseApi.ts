// 基地客户端会话 API（M12-C，模块 client_session）。
// 数据只来自冻结 REST 面（docs/reviews/base-operations/m12-p-contract.md §6）与 @ai-mud/shared DTO。
import type {
  BaseClockCommandInputDto,
  AcceptOrderInputDto,
  CreatePurchaseInputDto,
  DeliverOrderInputDto,
  BaseSnapshotDto,
  BaseTimeMode,
  CancelManufacturingJobResultDto,
  CreateManufacturingJobInputDto,
  CreateManufacturingJobResultDto,
  CreateProjectInputDto
} from "@ai-mud/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:3000";

export class BaseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  csrfToken?: string;
}

function isErrorResponse(value: unknown): value is { error: { code: string; message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error: { code?: unknown } }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string" &&
    typeof (value as { error: { message?: unknown } }).error.message === "string"
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.csrfToken !== undefined ? { "x-csrf-token": options.csrfToken } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });

  if (!response.ok) {
    let code = response.status === 401 ? "UNAUTHENTICATED" : "REQUEST_FAILED";
    let message =
      response.status === 401 ? "登录已失效，请重新登录。" : `请求失败：${response.status}`;
    try {
      const body = (await response.json()) as unknown;
      if (isErrorResponse(body)) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // 服务端未返回 JSON 时保留按状态码推导的兜底文案。
    }
    throw new BaseApiError(response.status, code, message);
  }

  return response.json() as Promise<T>;
}

export interface PlaytestRegisterInputDto {
  email: string;
  password: string;
}

export interface PlaytestRegisterResultDto {
  user: { accountId: string; email: string };
  baseId: string;
  csrfToken: string;
}

export interface ProvisionResultDto {
  baseId: string;
  duplicate: boolean;
}

export interface HeartbeatResultDto {
  leaseUntil: string;
  timeMode: BaseTimeMode;
}

export interface ClockCommandResultDto {
  timeMode: BaseTimeMode;
  speed: number;
  simTime: string;
}

export interface CreateProjectResultDto {
  projectId: string;
  duplicate: boolean;
}

// 取消项目结果（对应服务端 CancelProjectResultDto，shared 未冻结该 DTO，此处按 REST 面原样声明）。
export interface CancelProjectResultDto {
  cancelled: boolean;
  duplicate: boolean;
  completed: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

export interface AuthLoginResultDto {
  user: { id: string; email: string; role: string; status: string };
  csrfToken: string;
}

export function getSnapshot(): Promise<BaseSnapshotDto> {
  return request<BaseSnapshotDto>("/base/snapshot");
}

export function provision(csrfToken: string, commandId?: string): Promise<ProvisionResultDto> {
  return request<ProvisionResultDto>("/base/provision", {
    method: "POST",
    csrfToken,
    ...(commandId !== undefined ? { body: { commandId } } : { body: {} })
  });
}

export function playtestRegister(
  input: PlaytestRegisterInputDto
): Promise<PlaytestRegisterResultDto> {
  return request<PlaytestRegisterResultDto>("/base/playtest-register", {
    method: "POST",
    body: { email: input.email, password: input.password }
  });
}

export function heartbeat(csrfToken: string): Promise<HeartbeatResultDto> {
  return request<HeartbeatResultDto>("/base/heartbeat", {
    method: "POST",
    csrfToken,
    body: {}
  });
}

export function setClock(
  input: BaseClockCommandInputDto,
  csrfToken: string
): Promise<ClockCommandResultDto> {
  return request<ClockCommandResultDto>("/base/clock", {
    method: "POST",
    csrfToken,
    body: input
  });
}

export function createProject(
  input: CreateProjectInputDto,
  csrfToken: string
): Promise<CreateProjectResultDto> {
  return request<CreateProjectResultDto>("/base/projects", {
    method: "POST",
    csrfToken,
    body: input
  });
}

export function cancelProject(
  projectId: string,
  commandId: string,
  csrfToken: string
): Promise<CancelProjectResultDto> {
  return request<CancelProjectResultDto>(`/base/projects/${encodeURIComponent(projectId)}/cancel`, {
    method: "POST",
    csrfToken,
    body: { commandId }
  });
}

export function createManufacturingJob(
  input: CreateManufacturingJobInputDto,
  csrfToken: string
): Promise<CreateManufacturingJobResultDto> {
  return request<CreateManufacturingJobResultDto>("/base/manufacturing", {
    method: "POST",
    csrfToken,
    body: input
  });
}

export function cancelManufacturingJob(
  jobId: string,
  commandId: string,
  csrfToken: string
): Promise<CancelManufacturingJobResultDto> {
  return request<CancelManufacturingJobResultDto>(
    `/base/manufacturing/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      csrfToken,
      body: { commandId }
    }
  );
}

export function acceptOrder(
  orderId: string,
  commandId: string,
  csrfToken: string
): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>(
    `/base/orders/${encodeURIComponent(orderId)}/accept`,
    {
      method: "POST",
      csrfToken,
      body: { commandId }
    }
  );
}

export function deliverOrder(
  input: DeliverOrderInputDto,
  csrfToken: string
): Promise<{ delivered: boolean; rewardCredits?: number }> {
  return request<{ delivered: boolean }>(
    `/base/orders/${encodeURIComponent(input.orderId)}/deliver`,
    {
      method: "POST",
      csrfToken,
      body: { commandId: input.commandId }
    }
  );
}

export function createPurchase(
  input: CreatePurchaseInputDto,
  csrfToken: string
): Promise<{ purchaseId: string; duplicate: boolean }> {
  return request<{ purchaseId: string; duplicate: boolean }>("/base/purchases", {
    method: "POST",
    csrfToken,
    body: input
  });
}

export function login(input: PlaytestRegisterInputDto): Promise<AuthLoginResultDto> {
  return request<AuthLoginResultDto>("/auth/login", {
    method: "POST",
    body: { email: input.email, password: input.password }
  });
}
