import "server-only";
import { z } from "zod";
import { chaveSandboxSchema } from "./conexao";
import { linkSandboxSeguro } from "./cobrancas";

const BASE = "https://api-sandbox.asaas.com/v3";
export class ProvedorSandboxError extends Error {
  constructor(
    readonly ambiguo: boolean,
    readonly status: number | null = null,
  ) {
    super("recebimentos_provider_unavailable");
  }
}
const pagamentoSchema = z.object({
  id: z.string().regex(/^pay_[a-zA-Z0-9]+$/),
  customer: z.string(),
  value: z.number().positive(),
  status: z.string(),
  dueDate: z.iso.date(),
  externalReference: z.string(),
  invoiceUrl: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
});
export type PagamentoSandbox = z.infer<typeof pagamentoSchema>;
export function provedorSandbox(chave: string, buscar: typeof fetch = fetch) {
  const key = chaveSandboxSchema.parse(chave);
  async function chamar(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    // Base fixa. Sem redirecionamentos e sem retentativa de POST: pode ter sido processado.
    let r: Response;
    try {
      r = await buscar(`${BASE}${path}`, {
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: {
          access_token: key,
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "Recebimentos-Sandbox/1",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ProvedorSandboxError(method !== "GET");
    }
    if (!r.ok) throw new ProvedorSandboxError(method !== "GET" && r.status >= 500, r.status);
    if (method === "DELETE") return null;
    try {
      return await r.json();
    } catch {
      throw new ProvedorSandboxError(method !== "GET", r.status);
    }
  }
  function pagamento(dado: unknown): PagamentoSandbox {
    const lido = pagamentoSchema.safeParse(dado);
    if (!lido.success) throw new ProvedorSandboxError(true);
    if (lido.data.invoiceUrl && !linkSandboxSeguro(lido.data.invoiceUrl))
      throw new ProvedorSandboxError(true);
    return lido.data;
  }
  return {
    async cliente(p: { referencia: string; nome: string; documento: string }): Promise<string> {
      const lista = z
        .object({
          data: z.array(
            z.object({
              id: z.string().regex(/^cus_[a-zA-Z0-9]+$/),
              deleted: z.boolean().optional(),
              cpfCnpj: z.string().optional(),
            }),
          ),
          hasMore: z.boolean().optional(),
        })
        .parse(
          await chamar(
            "GET",
            `/customers?externalReference=${encodeURIComponent(p.referencia)}&limit=100`,
          ),
        );
      const vivos = lista.data.filter((c) => !c.deleted);
      if (lista.hasMore || vivos.length > 1) throw new ProvedorSandboxError(false);
      if (vivos[0]) {
        if ((vivos[0].cpfCnpj ?? "").replace(/\W/g, "") !== p.documento)
          throw new ProvedorSandboxError(false, 422);
        return vivos[0].id;
      }
      const novo = await chamar("POST", "/customers", {
        name: p.nome,
        cpfCnpj: p.documento,
        externalReference: p.referencia,
        notificationDisabled: true,
      });
      const lido = z.object({ id: z.string().regex(/^cus_[a-zA-Z0-9]+$/) }).safeParse(novo);
      if (!lido.success) throw new ProvedorSandboxError(true);
      return lido.data.id;
    },
    async criar(p: {
      customer: string;
      amount_cents: number;
      due_date: string;
      billing_type: string;
      referencia: string;
    }): Promise<PagamentoSandbox> {
      return pagamento(
        await chamar("POST", "/payments", {
          customer: p.customer,
          value: p.amount_cents / 100,
          dueDate: p.due_date,
          billingType: p.billing_type,
          externalReference: p.referencia,
          description: "Cobrança de teste",
        }),
      );
    },
    async localizar(referencia: string): Promise<PagamentoSandbox[]> {
      const lista = z
        .object({ data: z.array(z.unknown()), hasMore: z.boolean().optional() })
        .parse(
          await chamar(
            "GET",
            `/payments?externalReference=${encodeURIComponent(referencia)}&limit=100`,
          ),
        );
      if (lista.hasMore) throw new ProvedorSandboxError(false);
      return lista.data.map(pagamento);
    },
    async consultar(id: string): Promise<PagamentoSandbox> {
      return pagamento(await chamar("GET", `/payments/${encodeURIComponent(id)}`));
    },
    async cancelar(id: string): Promise<void> {
      await chamar("DELETE", `/payments/${encodeURIComponent(id)}`);
    },
  };
}
export type ProvedorSandbox = ReturnType<typeof provedorSandbox>;
