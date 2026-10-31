import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";
const A = "a5610000-0000-4000-8000-000000000001";
const B = "b5610000-0000-4000-8000-000000000001";
const UA = "a5610000-1111-4000-8000-000000000001";
const UB = "b5610000-1111-4000-8000-000000000001";
const AGENT = "a5610000-2222-4000-8000-000000000001";
const CA = "a5610000-3333-4000-8000-000000000001";
const CB = "b5610000-3333-4000-8000-000000000001";
const CONA = "a5610000-4444-4000-8000-000000000001";
const CONB = "b5610000-4444-4000-8000-000000000001";
function como(user: string, query: string) {
  return sql(
    `set role authenticated; select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',false); ${query};`,
  )
    .split("\n")
    .at(-1);
}
function inserir(org: string, contato: string, conexao: string, op = "gen_random_uuid()") {
  return `insert into public.recebimentos_cobrancas (organization_id,connection_id,credential_fingerprint,operation_id,request_hash,contact_id,amount_cents,due_date,billing_type,reason) values ('${org}','${conexao}','fingerprint',${op},'hash','${contato}',1000,'2099-11-01','PIX','Teste interno');`;
}
beforeAll(() => {
  sql(`select public.fn_recebimentos_provisionar();
    insert into auth.users (id,email) values ('${UA}','a@recebimentos-cobrancas.invalid'),('${UB}','b@recebimentos-cobrancas.invalid'),('${AGENT}','agent@recebimentos-cobrancas.invalid');
    insert into public.organizations (id,slug,legal_name,display_name) values ('${A}','recebimentos-cobrancas-a','Empresa A','Empresa A'),('${B}','recebimentos-cobrancas-b','Empresa B','Empresa B');
    insert into public.user_organizations (user_id,organization_id,role,accepted_at) values ('${UA}','${A}','admin',now()),('${UB}','${B}','admin',now()),('${AGENT}','${A}','agent',now());
    insert into public.contacts (id,organization_id,name) values ('${CA}','${A}','Pagador A'),('${CB}','${B}','Pagador B');
    insert into public.recebimentos_conexoes (id,organization_id,credential_ciphertext,credential_iv,credential_tag,credential_last4) values ('${CONA}','${A}',decode('aa','hex'),decode(repeat('11',12),'hex'),decode(repeat('22',16),'hex'),'1111'),('${CONB}','${B}',decode('bb','hex'),decode(repeat('33',12),'hex'),decode(repeat('44',16),'hex'),'2222');
    ${inserir(A, CA, CONA)} ${inserir(B, CB, CONB)}
  `);
});
describe("cobranças opcionais com RLS e vínculos de tenant", () => {
  it("admin vê só sua cobrança, atendente não vê nenhum valor", () => {
    expect(como(UA, "select count(id) from public.recebimentos_cobrancas")).toBe("1");
    expect(como(UB, "select count(id) from public.recebimentos_cobrancas")).toBe("1");
    expect(
      como(UA, `select count(id) from public.recebimentos_cobrancas where organization_id='${B}'`),
    ).toBe("0");
    expect(como(AGENT, "select count(id) from public.recebimentos_cobrancas")).toBe("0");
  });
  it("navegador não escreve nem lê fingerprint ou referência interna", () => {
    expect(() =>
      como(UA, "select credential_fingerprint from public.recebimentos_cobrancas"),
    ).toThrow(/permission denied/i);
    expect(() => como(UA, inserir(A, CA, CONA))).toThrow(/permission denied/i);
  });
  it("até service role não vincula contato ou conexão de outra empresa", () => {
    expect(() => sql(inserir(A, CB, CONA))).toThrow(/recebimentos_invalid_source/i);
    expect(() => sql(inserir(A, CA, CONB))).toThrow(/recebimentos_invalid_source/i);
  });
  it("reserva única e intenção imutável sobrevivem à reexecução", () => {
    const op = "'a5610000-5555-4000-8000-000000000001'";
    sql(inserir(A, CA, CONA, op));
    expect(() => sql(inserir(A, CA, CONA, op))).toThrow(/duplicate key/i);
    expect(() =>
      sql(`update public.recebimentos_cobrancas set amount_cents=20 where operation_id=${op};`),
    ).toThrow(/recebimentos_immutable_intent/i);
    sql(
      "select public.fn_recebimentos_provisionar(); select public.fn_recebimentos_provisionar();",
    );
    expect(sql(`select count(*) from public.recebimentos_cobrancas where operation_id=${op}`)).toBe(
      "1",
    );
  });
  it("anonimização redige motivo e link, sem alterar valores nem apagar a obrigação", () => {
    sql(
      `update public.recebimentos_cobrancas set invoice_url='https://sandbox.asaas.com/i/teste' where contact_id='${CA}'; update public.contacts set is_anonymized=true, anonymized_at=now() where id='${CA}' and organization_id='${A}';`,
    );
    expect(
      sql(
        `select count(*) from public.recebimentos_cobrancas where contact_id='${CA}' and invoice_url is null and reason like 'Cliente Anonimizado #%' and amount_cents=1000`,
      ),
    ).toBe("2");
  });
});
