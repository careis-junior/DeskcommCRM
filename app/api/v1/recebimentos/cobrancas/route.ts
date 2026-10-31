import { z } from "zod";
import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { criarCobranca, listarCobrancas } from "@/lib/recebimentos/cobrancas-service";
import {
  autorizarCobrancas,
  chaveDeOperacao,
  erroDaCobranca,
} from "@/lib/recebimentos/cobrancas-http";
import { lerCorpoDaConexao } from "@/lib/recebimentos/conexao-http";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const a = await autorizarCobrancas(req);
  if (a.response) return a.response;
  try {
    const contato = z
      .string()
      .uuid()
      .optional()
      .parse(new URL(req.url).searchParams.get("contact_id") ?? undefined);
    return ok(
      { cobrancas: await listarCobrancas(a.db, a.auth.org.orgId, contato) },
      { requestId: a.requestId },
    );
  } catch (e) {
    return erroDaCobranca(e, a.requestId);
  }
}
export async function POST(req: Request) {
  const a = await autorizarCobrancas(req, true);
  if (a.response) return a.response;
  const suporte = await requireSupportWrite(a.auth.org.orgId);
  if (suporte) return suporte;
  try {
    const cobranca = await criarCobranca(
      a.db,
      a.auth.org.orgId,
      chaveDeOperacao(req),
      await lerCorpoDaConexao(req),
    );
    void audit({
      action: "recebimentos.charge_requested",
      organizationId: a.auth.org.orgId,
      actorUserId: a.auth.user.id,
      resourceType: "recebimentos_cobrancas",
      resourceId: cobranca.id,
      requestId: a.requestId,
      metadata: { ambiente: "sandbox", status: cobranca.status },
    });
    return ok({ cobranca }, { requestId: a.requestId, status: 200 });
  } catch (e) {
    return erroDaCobranca(e, a.requestId);
  }
}
