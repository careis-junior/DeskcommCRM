import { z } from "zod";
import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { enviarCobranca } from "@/lib/recebimentos/envio-service";
import {
  autorizarCobrancas,
  chaveDeOperacao,
  erroDaCobranca,
} from "@/lib/recebimentos/cobrancas-http";
import { lerCorpoDaConexao } from "@/lib/recebimentos/conexao-http";
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
    const corpo = z
      .strictObject({ conversation_id: z.string().uuid() })
      .parse(await lerCorpoDaConexao(req));
    const cobranca = await enviarCobranca(
      a.db,
      {
        organization_id: a.auth.org.orgId,
        actor: { type: "user", id: a.auth.user.id, role: a.auth.org.role },
        requestId: a.requestId,
        idioma: a.auth.user.idioma,
      },
      id,
      chaveDeOperacao(req),
      corpo.conversation_id,
    );
    void audit({
      action: "recebimentos.charge_send_requested",
      organizationId: a.auth.org.orgId,
      actorUserId: a.auth.user.id,
      resourceType: "recebimentos_cobrancas",
      resourceId: id,
      requestId: a.requestId,
      metadata: {
        ambiente: "sandbox",
        message_id: cobranca.message_id,
        send_state: cobranca.send_state,
      },
    });
    return ok({ cobranca }, { requestId: a.requestId });
  } catch (e) {
    return erroDaCobranca(e, a.requestId);
  }
}
