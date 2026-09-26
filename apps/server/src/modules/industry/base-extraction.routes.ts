// R1 landing 路由：勘探 / 采矿单生命周期（03-domain-contracts.md §4）。
// 鉴权 + CSRF 模式同 base-manufacturing.routes（cookie SESSION_COOKIE_NAME + x-csrf-token）。
import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BaseOperationError } from "../../application/base/create-project.js";
import type { BaseAuthFacade } from "../../application/base/ports.js";

const surveySchema = z.object({
  operatorId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional()
});

const createMiningSchema = z.object({
  nodeId: z.string().uuid(),
  batches: z.number().int().min(1).max(10),
  builderOperatorIds: z.array(z.string().uuid()).min(1).max(2),
  haulerOperatorId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional()
});

const actionSchema = z.object({
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional(),
  builderOperatorIds: z.array(z.string().uuid()).min(1).max(2).optional(),
  haulerOperatorId: z.string().uuid().optional()
});

const idSchema = z.string().uuid();

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

export interface BaseExtractionRouteDeps {
  auth: BaseAuthFacade;
  survey: {
    execute(
      principal: { accountId: string },
      input: { nodeId: string; operatorId: string; commandId: string; expectedBaseRevision?: number }
    ): Promise<{ jobId: string; duplicate: boolean }>;
  };
  createMining: {
    execute(
      principal: { accountId: string },
      input: {
        nodeId: string; batches: number; builderOperatorIds: string[];
        haulerOperatorId: string; commandId: string; expectedBaseRevision?: number;
      }
    ): Promise<{ jobId: string; status: string; reservedOre: number; duplicate: boolean }>;
  };
  pause: {
    execute(
      principal: { accountId: string },
      input: { jobId: string; commandId: string; expectedBaseRevision?: number }
    ): Promise<{ jobId: string; status: string; duplicate: boolean; releasedOre: number }>;
  };
  resume: {
    execute(
      principal: { accountId: string },
      input: {
        jobId: string; commandId: string; expectedBaseRevision?: number;
        builderOperatorIds?: string[]; haulerOperatorId?: string;
      }
    ): Promise<{ jobId: string; status: string; duplicate: boolean; releasedOre: number }>;
  };
  cancel: {
    execute(
      principal: { accountId: string },
      input: { jobId: string; commandId: string; expectedBaseRevision?: number }
    ): Promise<{ jobId: string; status: string; duplicate: boolean; releasedOre: number }>;
  };
}

export async function registerBaseExtractionRoutes(
  app: FastifyInstance,
  deps: BaseExtractionRouteDeps
) {
  const requireSession = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<{ accountId: string } | null> => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (!token) {
      void sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
      return null;
    }
    const principal = await deps.auth.resolvePrincipal(token);
    if (!principal) {
      void sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
      return null;
    }
    const csrfToken = request.headers["x-csrf-token"];
    if (typeof csrfToken !== "string" || !deps.auth.verifyCsrf(token, csrfToken)) {
      void sendError(reply, 403, "FORBIDDEN", "CSRF 令牌缺失或不有效。");
      return null;
    }
    return { accountId: principal.accountId };
  };

  const guard = async (
    request: FastifyRequest,
    reply: FastifyReply,
    handler: (session: { accountId: string }) => Promise<FastifyReply>
  ): Promise<FastifyReply> => {
    const session = await requireSession(request, reply);
    if (!session) return reply;
    try {
      return await handler(session);
    } catch (error) {
      if (error instanceof BaseOperationError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  };

  app.post<{ Params: { nodeId: string } }>(
    "/base/resource-nodes/:nodeId/survey",
    async (request, reply) =>
      guard(request, reply, async (session) => {
        const nodeId = idSchema.safeParse(request.params.nodeId);
        if (!nodeId.success) return sendError(reply, 404, "VALIDATION_ERROR", "矿点不存在。");
        const parsed = surveySchema.safeParse(request.body);
        if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "勘探请求格式无效。");
        const result = await deps.survey.execute(session, {
          nodeId: nodeId.data,
          operatorId: parsed.data.operatorId,
          commandId: parsed.data.commandId ?? randomUUID(),
          ...(parsed.data.expectedBaseRevision !== undefined
            ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
            : {})
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      })
  );

  app.post("/base/extraction-jobs", async (request, reply) =>
    guard(request, reply, async (session) => {
      const parsed = createMiningSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "采矿请求格式无效。");
      const result = await deps.createMining.execute(session, {
        nodeId: parsed.data.nodeId,
        batches: parsed.data.batches,
        builderOperatorIds: parsed.data.builderOperatorIds,
        haulerOperatorId: parsed.data.haulerOperatorId,
        commandId: parsed.data.commandId ?? randomUUID(),
        ...(parsed.data.expectedBaseRevision !== undefined
          ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
          : {})
      });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    })
  );

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post<{ Params: { jobId: string } }>(
      `/base/extraction-jobs/:jobId/${action}`,
      async (request, reply) =>
        guard(request, reply, async (session) => {
          const jobId = idSchema.safeParse(request.params.jobId);
          if (!jobId.success) return sendError(reply, 404, "VALIDATION_ERROR", "作业不存在。");
          const parsed = actionSchema.safeParse(request.body ?? {});
          if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "请求格式无效。");
          const input = {
            jobId: jobId.data,
            commandId: parsed.data.commandId ?? randomUUID(),
            ...(parsed.data.expectedBaseRevision !== undefined
              ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
              : {})
          };
          const result =
            action === "pause"
              ? await deps.pause.execute(session, input)
              : action === "resume"
                ? await deps.resume.execute(session, {
                    ...input,
                    ...(parsed.data.builderOperatorIds !== undefined
                      ? { builderOperatorIds: parsed.data.builderOperatorIds }
                      : {}),
                    ...(parsed.data.haulerOperatorId !== undefined
                      ? { haulerOperatorId: parsed.data.haulerOperatorId }
                      : {})
                  })
                : await deps.cancel.execute(session, input);
          return reply.code(200).send(result);
        })
    );
  }
}
