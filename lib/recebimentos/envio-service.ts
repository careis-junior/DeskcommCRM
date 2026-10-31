import "server-only";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { checkDailyLimit, espacarEnvio } from "@/lib/automation/throttle";
import { cobrancaPodeSerEnviada, cobrancaPublicaSchema, mensagemDaCobranca } from "./cobrancas";
import {
  alterarCobranca,
  CobrancaError,
  lerLinha,
  novoIdDeMensagem,
  sincronizarCobranca,
} from "./cobrancas-service";

/** Envio humano pela MESMA porta da Inbox. Não é ferramenta paralela de envio da IA. */
export async function enviarCobranca(
  db: SupabaseClient,
  ctx: HandlerCtx,
  id: string,
  operationId: string,
  conversationId: string,
) {
  await sincronizarCobranca(db, ctx.organization_id, id);
  let row = await lerLinha(db, ctx.organization_id, id);
  const { data: conversa, error } = await db
    .from("conversations")
    .select("id,contact_id,channel_session_id,is_group")
    .eq("organization_id", ctx.organization_id)
    .eq("id", conversationId)
    .eq("contact_id", row.contact_id)
    .maybeSingle();
  if (error) throw new CobrancaError("recebimentos_unavailable", 503);
  if (!conversa || conversa.is_group) throw new CobrancaError("recebimentos_invalid_source", 422);
  if (row.send_operation_id === operationId) return cobrancaPublicaSchema.parse(row);
  if (
    !cobrancaPodeSerEnviada(row) ||
    ["enviando", "queued", "revisao_manual"].includes(row.send_state)
  )
    throw new CobrancaError("recebimentos_conflict");
  if (row.send_requested_at && Date.now() - new Date(row.send_requested_at).getTime() < 60_000)
    throw new CobrancaError("recebimentos_conflict");
  if (row.appointment_id) {
    const { data: a, error: erro } = await db
      .from("calendar_appointments")
      .select("status,contact_id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", row.appointment_id)
      .maybeSingle();
    if (erro) throw new CobrancaError("recebimentos_unavailable", 503);
    if (!a || a.contact_id !== row.contact_id || !["confirmed"].includes(a.status))
      throw new CobrancaError("recebimentos_invalid_source", 422);
  }
  if (await adiarAteAJanelaAbrir(db, ctx.organization_id, conversa.channel_session_id))
    throw new CobrancaError("recebimentos_conflict");
  const limite = await checkDailyLimit(db, ctx.organization_id, conversa.channel_session_id);
  if (!limite.allowed) throw new CobrancaError("recebimentos_conflict");
  row = await alterarCobranca(db, row, {
    send_state: "enviando",
    send_operation_id: operationId,
    message_id: novoIdDeMensagem(),
    conversation_id: conversationId,
    send_requested_at: new Date().toISOString(),
  });
  try {
    await espacarEnvio(conversa.channel_session_id);
    const mensagem = await sendMessageHandler(
      db,
      { ...ctx, internalMessageId: row.message_id! },
      {
        conversation_id: conversationId,
        type: "text",
        body: mensagemDaCobranca(row),
        metadata: { recebimento_id: row.id, ambiente: "sandbox" },
      },
    );
    const estado = ["sent", "delivered", "read", "queued", "failed"].includes(mensagem.status)
      ? mensagem.status
      : "revisao_manual";
    row = await alterarCobranca(db, row, { send_state: estado });
  } catch (erro) {
    if (erro instanceof OrgNaoOperanteError) {
      await alterarCobranca(db, row, { send_state: "failed", diagnostic: "Envio não realizado: a empresa está suspensa." });
      throw erro;
    }
    // O canal pode ter recebido antes da queda. A Inbox e o message_id são a
    // autoridade para revisão. Nunca reexecutar o envio automaticamente.
    row = await alterarCobranca(db, row, {
      send_state: "revisao_manual",
      diagnostic: "Envio não confirmado. Confira a mensagem na Inbox antes de reenviar.",
    });
  }
  return cobrancaPublicaSchema.parse(row);
}
