import { z } from "zod";
import { ok } from "@/lib/api/wrappers";
import { autorizarCobrancas, erroDaCobranca } from "@/lib/recebimentos/cobrancas-http";
import { CobrancaError } from "@/lib/recebimentos/cobrancas-service";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const a = await autorizarCobrancas(req);
  if (a.response) return a.response;
  try {
    const contactId = z
      .string()
      .uuid()
      .optional()
      .parse(new URL(req.url).searchParams.get("contact_id") ?? undefined);
    if (!contactId) {
      const { data, error } = await a.db
        .from("contacts")
        .select("id,name,display_name")
        .eq("organization_id", a.auth.org.orgId)
        .eq("is_anonymized", false)
        .eq("is_blocked", false)
        .neq("kind", "whatsapp_group")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new CobrancaError("recebimentos_unavailable", 503);
      return ok({ contatos: data ?? [] }, { requestId: a.requestId });
    }
    const [agenda, conversas] = await Promise.all([
      a.db
        .from("calendar_appointments")
        .select("id,starts_at,event_type_id,status")
        .eq("organization_id", a.auth.org.orgId)
        .eq("contact_id", contactId)
        .in("status", ["confirmed"])
        .order("starts_at", { ascending: false })
        .limit(50),
      a.db
        .from("conversations")
        .select("id,created_at")
        .eq("organization_id", a.auth.org.orgId)
        .eq("contact_id", contactId)
        .eq("is_group", false)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (agenda.error || conversas.error) throw new CobrancaError("recebimentos_unavailable", 503);
    const tipos = await a.db
      .from("calendar_event_types")
      .select("id,name,default_price_cents")
      .eq("organization_id", a.auth.org.orgId);
    if (tipos.error) throw new CobrancaError("recebimentos_unavailable", 503);
    return ok(
      {
        agendamentos: (agenda.data ?? []).map((s) => {
          const tipo = tipos.data?.find((t) => t.id === s.event_type_id);
          return {
            id: s.id,
            starts_at: s.starts_at,
            nome: tipo?.name ?? "Agendamento",
            amount_cents: tipo?.default_price_cents ?? null,
          };
        }),
        conversas: conversas.data ?? [],
      },
      { requestId: a.requestId },
    );
  } catch (e) {
    return erroDaCobranca(e, a.requestId);
  }
}
