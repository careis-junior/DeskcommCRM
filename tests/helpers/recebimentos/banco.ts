import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
export type Linha = Record<string, unknown>;
/** Dublê de concorrência da aplicação; RLS/FKs são provadas separadamente em Postgres. */
export function bancoRecebimentos(iniciais: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = { recebimentos_cobrancas: [], ...iniciais };
  const consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  function from(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    consultas.push({ tabela, filtros });
    let insert: Linha | undefined;
    let update: Linha | undefined;
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filtros.push([k, v]);
        return b;
      },
      order: () => b,
      limit: () => b,
      insert: (v: Linha) => {
        insert = v;
        return b;
      },
      update: (v: Linha) => {
        update = v;
        return b;
      },
      async maybeSingle() {
        const rows = tabelas[tabela] ?? [];
        if (insert) {
          const i = insert;
          if (
            rows.some(
              (v) =>
                v.organization_id === i.organization_id &&
                (v.operation_id === i.operation_id ||
                  (i.appointment_id && v.appointment_id === i.appointment_id)),
            )
          )
            return { data: null, error: { code: "23505" } };
          const row = {
            id: randomUUID(),
            status: "criando",
            provider_status: null,
            invoice_url: null,
            diagnostic: null,
            revision: 1,
            currency: "BRL",
            send_state: "nao_enviada",
            send_operation_id: null,
            message_id: null,
            conversation_id: null,
            send_requested_at: null,
            provider_payment_id: null,
            provider_customer_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...i,
          };
          rows.push(row);
          tabelas[tabela] = rows;
          return { data: { ...row }, error: null };
        }
        const row = rows.find((r) => filtros.every(([k, v]) => r[k] === v));
        if (row && update) Object.assign(row, update);
        return { data: row ? { ...row } : null, error: null };
      },
      then(resolve: (v: { data: Linha[]; error: null }) => unknown) {
        return Promise.resolve({
          data: (tabelas[tabela] ?? []).filter((r) => filtros.every(([k, v]) => r[k] === v)),
          error: null,
        }).then(resolve);
      },
    };
    return b;
  }
  return { db: { from } as unknown as SupabaseClient, tabelas, consultas };
}
