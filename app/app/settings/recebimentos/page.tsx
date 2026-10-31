import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { CobrancasDeRecebimentos } from "./_cobrancas";
import { ConexaoDeRecebimentos } from "./_client";

export const dynamic = "force-dynamic";

export default async function RecebimentosPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/onboarding");
  if (!roleAtLeast(org.role, "admin")) redirect("/403");
  if (!(await moduloLigado(createAdminClient(), "recebimentos"))) notFound();
  const t = (texto: string) => traduzir(texto, user.idioma);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{t("Recebimentos")}</h1>
        <p className="text-sm text-text-muted">
          {t("Conecte a conta de testes do Asaas desta empresa.")}
        </p>
      </header>
      <ConexaoDeRecebimentos key={org.orgId} orgId={org.orgId} podeEditar={!user.support} />
      <CobrancasDeRecebimentos
        key={`cobrancas-${org.orgId}`}
        orgId={org.orgId}
        podeEditar={!user.support}
      />
    </div>
  );
}
