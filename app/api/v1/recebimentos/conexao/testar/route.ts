import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarConexaoSchema } from "@/lib/recebimentos/conexao";
import { testarConexaoSandbox } from "@/lib/recebimentos/conexao-service";
import { erroDaConexao, lerCorpoDaConexao } from "@/lib/recebimentos/conexao-http";

export async function POST(req: Request) {
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
    return fail("validation_failed", "Atualize a página antes de testar a conexão.", 422, {
      requestId,
    });
  try {
    const db = createAdminClient();
    if (!(await moduloLigado(db, "recebimentos")))
      return fail("not_found", "Recurso indisponível.", 404, { requestId });
    const conexao = await testarConexaoSandbox(db, auth.org.orgId, input.data.expected_revision);
    void audit({
      action: "recebimentos.connection_tested",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "recebimentos_conexoes",
      resourceId: conexao.id,
      requestId,
      metadata: { ambiente: "sandbox", status: conexao.status, revision: conexao.revision },
    });
    return ok({ conexao }, { requestId });
  } catch (e) {
    return erroDaConexao(e, requestId);
  }
}
