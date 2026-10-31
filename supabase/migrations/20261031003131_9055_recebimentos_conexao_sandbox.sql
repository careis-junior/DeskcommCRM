-- manifest: Provisiona a conexão Asaas Sandbox de cada empresa somente quando o módulo recebimentos é instalado; mantém credenciais cifradas fora da leitura do navegador e protege atualizações por revisão.
-- Alocação: main oficial e 87 PRs abertos consultados em 30/10/2026;
-- maior NNNN observado 9054. Base da instalação preservada em v1.85.

create or replace function public.fn_recebimentos_provisionar()
returns void language plpgsql security definer
set search_path = public, pg_temp as $f$
begin
  create table if not exists public.recebimentos_conexoes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    provider text not null default 'asaas' check (provider = 'asaas'),
    ambiente text not null default 'sandbox' check (ambiente = 'sandbox'),
    credential_ciphertext bytea not null check (octet_length(credential_ciphertext) > 0),
    credential_iv bytea not null check (octet_length(credential_iv) = 12),
    credential_tag bytea not null check (octet_length(credential_tag) = 16),
    credential_last4 text not null check (char_length(credential_last4) = 4),
    status text not null default 'nao_testada'
      check (status in ('nao_testada','validada','chave_invalida','sem_permissao','indisponivel','desativada')),
    revision bigint not null default 1 check (revision between 1 and 9007199254740991),
    validated_at timestamptz,
    tested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, provider, ambiente),
    check (status <> 'validada' or validated_at is not null)
  );
  alter table public.recebimentos_conexoes enable row level security;
  -- O default ACL do Supabase concede tudo. Retirar explicitamente as duas
  -- origens, antes de devolver SOMENTE as colunas públicas ao administrador.
  revoke all on public.recebimentos_conexoes from public, anon, authenticated;
  grant select (id,organization_id,provider,ambiente,status,credential_last4,
    revision,validated_at,tested_at,created_at,updated_at)
    on public.recebimentos_conexoes to authenticated;
  grant all on public.recebimentos_conexoes to service_role;
  drop policy if exists tenant_isolation_recebimentos_conexoes_all on public.recebimentos_conexoes;
  create policy tenant_isolation_recebimentos_conexoes_all on public.recebimentos_conexoes
    for select to authenticated
    using (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'));
  perform public.fn_proteger_modulo_provisionado();
end $f$;
revoke execute on function public.fn_recebimentos_provisionar() from public, anon, authenticated;
grant execute on function public.fn_recebimentos_provisionar() to service_role;

do $f$ begin
  if exists (select 1 from public.modulos_instalados where modulo = 'recebimentos' and estado = 'ativo') then
    perform public.fn_recebimentos_provisionar();
  end if;
end $f$;
notify pgrst, 'reload schema';
