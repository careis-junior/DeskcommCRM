import { z } from "zod";
import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { sincronizarCobranca } from "@/lib/recebimentos/cobrancas-service";
import { autorizarCobrancas, erroDaCobranca } from "@/lib/recebimentos/cobrancas-http";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await autorizarCobrancas(req, true);
  if (a.response) return a.response;
  const suporte = await requireSupportWrite(a.auth.org.orgId);
  if (suporte) return suporte;
  try {
    const id = z
      .string()
      .uuid()
      .parse((await ctx.params).id);
    const cobranca = await sincronizarCobranca(a.db, a.auth.org.orgId, id);
    void audit({
      action: "recebimentos.charge_sincronizar",
      organizationId: a.auth.org.orgId,
      actorUserId: a.auth.user.id,
      resourceType: "recebimentos_cobrancas",
      resourceId: id,
      requestId: a.requestId,
      metadata: { ambiente: "sandbox", status: cobranca.status },
    });
    return ok({ cobranca }, { requestId: a.requestId });
  } catch (e) {
    return erroDaCobranca(e, a.requestId);
  }
}
