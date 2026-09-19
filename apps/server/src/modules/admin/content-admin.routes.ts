import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ContentAdminUseCasesPort } from "../../application/content-admin/usecases.js";

// M13-B 内容工坊管理路由（仅 admin 会话）。transport 只 import application。
// CSRF 与现有 admin 路由同头：x-ai-mud-csrf。

const createDraftSchema = z.object({
  kind: z.enum(["robot_template", "project", "recipe"]),
  stableId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  payload: z.record(z.string(), z.unknown())
});

const updateDraftSchema = z.object({
  draftId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown())
});

const publishSchema = z.object({});

const activateSchema = z.object({
  releaseId: z.string().min(1).max(64),
  baseId: z.string().uuid()
});

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

export interface ContentAdminRouteDeps {
  getCurrentAdmin(request: FastifyRequest): Promise<{ accountId: string; role: string } | null>;
  verifyAdminMutation(request: FastifyRequest): Promise<boolean>;
  contentAdmin: ContentAdminUseCasesPort;
}

export async function registerContentAdminRoutes(
  app: FastifyInstance,
  deps: ContentAdminRouteDeps
) {
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      sendError(reply, 401, "UNAUTHENTICATED", "请先以管理员身份登录。");
      return null;
    }
    if (request.method !== "GET") {
      const ok = await deps.verifyAdminMutation(request);
      if (!ok) {
        sendError(reply, 403, "FORBIDDEN", "缺少有效的管理操作令牌。");
        return null;
      }
    }
    return admin;
  };

  app.get("/admin/content/drafts", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    return { drafts: await deps.contentAdmin.listDrafts(admin) };
  });

  app.post("/admin/content/drafts", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const parsed = createDraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "草稿字段不完整或格式不正确。");
    }
    try {
      const draft = await deps.contentAdmin.createDraft(admin, parsed.data);
      return reply.code(201).send({ draft });
    } catch (error) {
      return handleContentError(reply, error);
    }
  });

  app.put("/admin/content/drafts/:draftId", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const params = z.object({ draftId: z.string().uuid() }).safeParse(request.params);
    const body = updateDraftSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "草稿更新请求不合法。");
    }
    try {
      const draft = await deps.contentAdmin.updateDraft(admin, body.data);
      return { draft };
    } catch (error) {
      return handleContentError(reply, error);
    }
  });

  app.delete("/admin/content/drafts/:draftId", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const params = z.object({ draftId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "草稿 ID 不合法。");
    }
    try {
      await deps.contentAdmin.deleteDraft(admin, params.data.draftId);
      return reply.code(204).send();
    } catch (error) {
      return handleContentError(reply, error);
    }
  });

  app.post("/admin/content/publish", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    try {
      const result = await deps.contentAdmin.publish(admin);
      return { release: result };
    } catch (error) {
      return handleContentError(reply, error);
    }
  });

  app.get("/admin/content/releases", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    return { releases: await deps.contentAdmin.listReleases(admin) };
  });

  app.post("/admin/content/activate", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const parsed = activateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "激活请求不合法。");
    }
    try {
      await deps.contentAdmin.activate(admin, parsed.data);
      return { activated: true };
    } catch (error) {
      return handleContentError(reply, error);
    }
  });
}

function handleContentError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === "CONTENT_INCOMPATIBLE") {
    return sendError(reply, 400, "CONTENT_INCOMPATIBLE", (error as Error).message);
  }
  if (code === "FORBIDDEN") {
    return sendError(reply, 403, "FORBIDDEN", (error as Error).message);
  }
  if (code === "VALIDATION_ERROR") {
    return sendError(reply, 404, "VALIDATION_ERROR", (error as Error).message);
  }
  throw error;
}
