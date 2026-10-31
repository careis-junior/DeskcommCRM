import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { CobrancaError, exigirModulo } from "./cobrancas-service";
import { ConexaoRecebimentosError } from "./conexao-service";

export async function autorizarCobrancas(req: Request, escrita = false) {
  const requestId = req.headers.get("X-Request-Id") ?? randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "recebimentos_cobrancas" });
  if (!auth.ok) return { response: auth.response } as const;
  if (escrita) {
    const suporte = await requireSupportWrite(auth.org.orgId);
    if (suporte) return { response: suporte } as const;
  }
  const db = createAdminClient();
  try {
    await exigirModulo(db);
  } catch (e) {
    return { response: erroDaCobranca(e, requestId) } as const;
  }
  return { db, auth, requestId } as const;
}
export function erroDaCobranca(e: unknown, requestId: string) {
  if (e instanceof OrgNaoOperanteError) return fail("org_suspended", "A empresa está suspensa. Nenhuma mensagem foi enviada.", 403, { requestId });
  if (e instanceof z.ZodError)
    return fail(
      "validation_failed",
      "Confira os dados da cobrança. Documento, valor e vencimento precisam ser válidos.",
      422,
      { requestId },
    );
  if (e instanceof ConexaoRecebimentosError)
    return fail(
      e.code,
      "Confira e teste a conexão Sandbox desta empresa antes de continuar.",
      e.status,
      { requestId },
    );
  if (e instanceof CobrancaError) {
    const mensagens = {
      not_found: "Cobrança indisponível.",
      recebimentos_conflict:
        "A operação está em curso ou o registro mudou. Atualize a tela; confira a situação e a Inbox antes de repetir.",
      recebimentos_invalid_source:
        "Confira o contato, a conversa e os dados de origem. Agendamentos precisam ter preço cadastrado e estar ativos.",
      recebimentos_connection_changed:
        "A chave ou conta da conexão mudou. Revise esta cobrança na conta original do Asaas.",
      recebimentos_unavailable: "Não foi possível acessar as cobranças agora.",
    };
    return fail(e.code, mensagens[e.code], e.status, { requestId });
  }
  return fail(
    "internal_error",
    "Não foi possível confirmar a operação. Consulte a situação antes de repeti-la.",
    503,
    { requestId },
  );
}
export function chaveDeOperacao(req: Request) {
  return z.string().uuid().parse(req.headers.get("Idempotency-Key"));
}
