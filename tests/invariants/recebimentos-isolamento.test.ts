import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

const A = "a5550000-0000-4000-8000-000000000001";
const B = "b5550000-0000-4000-8000-000000000001";
const UA = "a5550000-1111-4000-8000-000000000001";
const UB = "b5550000-1111-4000-8000-000000000001";
const ATENDENTE = "a5550000-2222-4000-8000-000000000001";

function como(user: string, query: string) {
  return sql(`set role authenticated;
    select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',false);
    ${query};`)
    .split("\n")
    .at(-1);
}
beforeAll(() => {
  sql(`select public.fn_recebimentos_provisionar();
    insert into auth.users (id,email) values
      ('${UA}','admin-a@recebimentos.invalid'),('${UB}','admin-b@recebimentos.invalid'),
      ('${ATENDENTE}','atendente@recebimentos.invalid');
    insert into public.organizations (id,slug,legal_name,display_name) values
      ('${A}','recebimentos-teste-a','Empresa de teste A','Empresa de teste A'),
      ('${B}','recebimentos-teste-b','Empresa de teste B','Empresa de teste B');
    insert into public.user_organizations (user_id,organization_id,role,accepted_at) values
      ('${UA}','${A}','admin',now()),('${UB}','${B}','admin',now()),
      ('${ATENDENTE}','${A}','agent',now());
    insert into public.recebimentos_conexoes
      (organization_id,credential_ciphertext,credential_iv,credential_tag,credential_last4)
      values ('${A}',decode('aa','hex'),decode(repeat('11',12),'hex'),decode(repeat('22',16),'hex'),'1111'),
      ('${B}',decode('bb','hex'),decode(repeat('33',12),'hex'),decode(repeat('44',16),'hex'),'2222');`);
});
describe("RLS real: conexões de recebimentos", () => {
  it("cada administrador vê somente os metadados da própria empresa", () => {
    expect(como(UA, "select credential_last4 from public.recebimentos_conexoes")).toBe("1111");
    expect(como(UB, "select credential_last4 from public.recebimentos_conexoes")).toBe("2222");
  });
  it("filtrar explicitamente o ID de outra empresa não revela a conexão", () => {
    expect(
      como(UA, `select count(id) from public.recebimentos_conexoes where organization_id = '${B}'`),
    ).toBe("0");
    expect(
      como(UB, `select count(id) from public.recebimentos_conexoes where organization_id = '${A}'`),
    ).toBe("0");
  });
  it("um atendente não lê nem os metadados da sua empresa", () => {
    expect(como(ATENDENTE, "select count(id) from public.recebimentos_conexoes")).toBe("0");
  });
  it("nem o administrador lê a cifra diretamente pelo papel do navegador", () => {
    expect(() =>
      como(UA, "select credential_ciphertext from public.recebimentos_conexoes"),
    ).toThrow(/permission denied/i);
  });
  it("a instalação repetida preserva as duas conexões", () => {
    sql(
      "select public.fn_recebimentos_provisionar(); select public.fn_recebimentos_provisionar();",
    );
    expect(sql("select count(*) from public.recebimentos_conexoes")).toBe("2");
  });
});
