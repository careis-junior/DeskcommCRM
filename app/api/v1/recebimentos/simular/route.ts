import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { simularRecebimento } from "@/lib/recebimentos/plano";

/** Prévia sem escrita, chamada autenticada. Não é uma rota de emissão. */
export async function POST(req: Request) {
  const requestId = req.headers.get("X-Request-Id") ?? randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "recebimentos" });
  if (!authz.ok) return authz.response;
  // Contrato conservador para POSTs da API, inclusive durante suporte remoto.
  const support = await requireSupportWrite(authz.org.orgId);
  if (support) return support;
  let entrada: unknown;
  try {
    // Não devolvemos input ou erro de parsing: dados financeiros podem ser sensíveis.
    const corpo = await req.text();
    if (new TextEncoder().encode(corpo).byteLength > 4_096) {
      return fail("invalid_request", "A simulação excede o tamanho permitido.", 413, { requestId });
    }
    entrada = JSON.parse(corpo);
  } catch {
    return fail("invalid_request", "Informe um JSON válido.", 400, { requestId });
  }
  const resultado = simularRecebimento(entrada);
  if (!resultado.ok) {
    return fail("validation_failed", "Confira o total e a condição de recebimento.", 422, {
      requestId,
      details: { motivo: resultado.motivo },
    });
  }
  // Sem audit de mutação: nenhuma dívida, configuração ou mensagem foi criada.
  return ok(resultado, { requestId });
}
