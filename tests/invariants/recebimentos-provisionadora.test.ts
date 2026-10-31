import { describe, expect, it } from "vitest";
import { moldeDeProvisionadora } from "./molde-de-provisionadora";
import { sql } from "./gov-helpers";

moldeDeProvisionadora({
  modulo: "recebimentos",
  tabelas: ["recebimentos_conexoes", "recebimentos_cobrancas"],
  protecaoPropria: ["recebimentos_conexoes", "recebimentos_cobrancas"],
});

describe("credencial de recebimentos fica fora do navegador", () => {
  it("nem authenticated nem anon recebem leitura do ciphertext/IV/tag ou escrita", () => {
    sql("select public.fn_recebimentos_provisionar();");
    for (const coluna of ["credential_ciphertext", "credential_iv", "credential_tag"]) {
      for (const role of ["authenticated", "anon"]) {
        expect(
          sql(
            `select has_column_privilege('${role}','public.recebimentos_conexoes','${coluna}','SELECT')`,
          ),
        ).toBe("f");
      }
    }
    for (const permissao of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(
        sql(
          `select has_table_privilege('authenticated','public.recebimentos_conexoes','${permissao}')`,
        ),
      ).toBe("f");
    }
    expect(
      sql(
        "select has_column_privilege('authenticated','public.recebimentos_conexoes','credential_last4','SELECT')",
      ),
    ).toBe("t");
  });
});
