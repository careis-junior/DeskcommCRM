import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
import { salvarConexaoSchema, revisarConexaoSchema } from "@/lib/recebimentos/conexao";
import {
  lerConexaoSandbox,
  salvarConexaoSandbox,
  desativarConexaoSandbox,
} from "@/lib/recebimentos/conexao-service";
import { erroDaConexao, lerCorpoDaConexao } from "@/lib/recebimentos/conexao-http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = req.headers.get("X-Request-Id") ?? randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "recebimentos_conexoes" });
  if (!auth.ok) return auth.response;
  try {
    const db = createAdminClient();
    if (!(await moduloLigado(db, "recebimentos")))
      return fail("not_found", "Recurso indisponível.", 404, { requestId });
    return ok({ conexao: await lerConexaoSandbox(db, auth.org.orgId) }, { requestId });
  } catch (e) {
    return erroDaConexao(e, requestId);
  }
}

export async function PUT(req: Request) {
  const requestId = req.headers.get("X-Request-Id") ?? randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "recebimentos_conexoes" });
  if (!auth.ok) return auth.response;
  const suporte = await requireSupportWrite(auth.org.orgId);
  if (suporte) return suporte;
  let corpo: unknown;
  try {
    corpo = await lerCorpoDaConexao(req);
  } catch {
    return fail("invalid_request", "Informe um JSON válido de até 6 KiB.", 400, { requestId });
  }
  const input = salvarConexaoSchema.safeParse(corpo);
  if (!input.success)
    return fail(
      "validation_failed",
      "Confira a chave do Sandbox e atualize a página se a conexão mudou.",
      422,
      { requestId },
    );
  try {
    const db = createAdminClient();
    if (!(await moduloLigado(db, "recebimentos")))
      return fail("not_found", "Recurso indisponível.", 404, { requestId });
    const conexao = await salvarConexaoSandbox(
      db,
      auth.org.orgId,
      input.data.api_key,
      input.data.expected_revision,
    );
    void audit({
      action: "recebimentos.connection_saved",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "recebimentos_conexoes",
      resourceId: conexao.id,
      requestId,
      metadata: { ambiente: "sandbox", revision: conexao.revision },
    });
    return ok({ conexao }, { requestId });
  } catch (e) {
    return erroDaConexao(e, requestId);
  }
}

export async function PATCH(req: Request) {
  const requestId = req.headers.get("X-Request-Id") ?? randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "recebimentos_conexoes" });
  if (!auth.ok) return auth.response;
  const suporte = await requireSupportWrite(auth.org.orgId);
  if (suporte) return suporte;
  let corpo: unknown;
  try {
    corpo = await lerCorpoDaConexao(req);
  } catch {
    return fail("invalid_request", "Informe um JSON válido de até 6 KiB.", 400, { requestId });
  }
  const input = revisarConexaoSchema.safeParse(corpo);
  if (!input.success)
    return fail("validation_failed", "Atualize a página antes de desativar a conexão.", 422, {
      requestId,
    });
  try {
    const db = createAdminClient();
    if (!(await moduloLigado(db, "recebimentos")))
      return fail("not_found", "Recurso indisponível.", 404, { requestId });
    const conexao = await desativarConexaoSandbox(db, auth.org.orgId, input.data.expected_revision);
    void audit({
      action: "recebimentos.connection_disabled",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "recebimentos_conexoes",
      resourceId: conexao.id,
      requestId,
      metadata: { ambiente: "sandbox", revision: conexao.revision },
    });
    return ok({ conexao }, { requestId });
  } catch (e) {
    return erroDaConexao(e, requestId);
  }
}
