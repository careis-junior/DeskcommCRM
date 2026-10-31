-- manifest: Cobranças Sandbox avulsas ou de agendamento com intenção única, RLS e envio rastreável, sem baixa financeira automática.

create or replace function public.fn_recebimentos_validar_vinculos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if not exists (select 1 from public.recebimentos_conexoes c where c.id=new.connection_id and c.organization_id=new.organization_id)
    or not exists (select 1 from public.contacts c where c.id=new.contact_id and c.organization_id=new.organization_id)
    or (new.appointment_id is not null and not exists (select 1 from public.calendar_appointments a where a.id=new.appointment_id and a.organization_id=new.organization_id and a.contact_id=new.contact_id))
    or (new.conversation_id is not null and not exists (select 1 from public.conversations c where c.id=new.conversation_id and c.organization_id=new.organization_id and c.contact_id=new.contact_id))
  then raise exception 'recebimentos_invalid_source' using errcode='23514'; end if;
  if tg_op='UPDATE' and (old.organization_id,old.connection_id,old.credential_fingerprint,old.operation_id,old.request_hash,old.contact_id,old.appointment_id,old.amount_cents,old.currency,old.due_date,old.billing_type)
    is distinct from (new.organization_id,new.connection_id,new.credential_fingerprint,new.operation_id,new.request_hash,new.contact_id,new.appointment_id,new.amount_cents,new.currency,new.due_date,new.billing_type)
  then raise exception 'recebimentos_immutable_intent' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.reason is distinct from new.reason and not exists
    (select 1 from public.contacts c where c.id=new.contact_id and c.organization_id=new.organization_id and c.is_anonymized)
  then raise exception 'recebimentos_immutable_intent' using errcode='23514'; end if;
  return new;
end;
$f$;
revoke execute on function public.fn_recebimentos_validar_vinculos() from public, anon, authenticated;
grant execute on function public.fn_recebimentos_validar_vinculos() to service_role;

create or replace function public.fn_recebimentos_preparar_cobrancas()
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  create table if not exists public.recebimentos_cobrancas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    connection_id uuid not null references public.recebimentos_conexoes(id),
    credential_fingerprint text not null,
    operation_id uuid not null,
    request_hash text not null,
    contact_id uuid not null references public.contacts(id),
    appointment_id uuid references public.calendar_appointments(id),
    amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 9007199254740991),
    currency text not null default 'BRL' check (currency = 'BRL'),
    due_date date not null,
    billing_type text not null check (billing_type in ('UNDEFINED','PIX','BOLETO','CREDIT_CARD')),
    reason text not null check (char_length(reason) between 3 and 300),
    status text not null default 'criando' check (status in ('criando','criacao_indeterminada','pendente','confirmada','recebida','vencida','cancelada','cancelando','revertida','revisao_manual')),
    provider_customer_id text,
    provider_payment_id text,
    provider_status text,
    invoice_url text,
    diagnostic text,
    revision bigint not null default 1,
    send_state text not null default 'nao_enviada' check (send_state in ('nao_enviada','enviando','sent','delivered','read','queued','failed','revisao_manual')),
    send_operation_id uuid,
    message_id uuid,
    conversation_id uuid references public.conversations(id),
    send_requested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id,operation_id),
    unique (organization_id,appointment_id),
    unique (connection_id,provider_payment_id)
  );
  create index if not exists recebimentos_cobrancas_org_contato on public.recebimentos_cobrancas (organization_id, contact_id, created_at desc);
  alter table public.recebimentos_cobrancas enable row level security;
  revoke all on public.recebimentos_cobrancas from public, anon, authenticated;
  grant select (id,organization_id,contact_id,appointment_id,amount_cents,currency,due_date,billing_type,reason,status,provider_status,invoice_url,diagnostic,revision,send_state,message_id,conversation_id,send_requested_at,created_at,updated_at) on public.recebimentos_cobrancas to authenticated;
  grant all on public.recebimentos_cobrancas to service_role;
  drop policy if exists tenant_isolation_recebimentos_cobrancas_all on public.recebimentos_cobrancas;
  -- Forma em duas linhas: update.sh até v1.63 não deve cobrar tabela opcional ausente.
  create policy tenant_isolation_recebimentos_cobrancas_all
    on public.recebimentos_cobrancas for select to authenticated
    using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'admin'));
  drop trigger if exists recebimentos_validar_vinculos on public.recebimentos_cobrancas;
  create trigger recebimentos_validar_vinculos before insert or update on public.recebimentos_cobrancas for each row execute function public.fn_recebimentos_validar_vinculos();
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;
revoke execute on function public.fn_recebimentos_preparar_cobrancas() from public, anon, authenticated;
grant execute on function public.fn_recebimentos_preparar_cobrancas() to service_role;

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
  -- Compatibilidade com update.sh v1.39–v1.63: a policy opcional não deve
  -- entrar na varredura de regras já existentes antes da instalação do módulo.
  create policy tenant_isolation_recebimentos_conexoes_all
    on public.recebimentos_conexoes
    for select to authenticated
    using (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'));
  perform public.fn_proteger_modulo_provisionado();
  perform public.fn_recebimentos_preparar_cobrancas();
end;
$f$;
revoke execute on function public.fn_recebimentos_provisionar() from public, anon, authenticated;
grant execute on function public.fn_recebimentos_provisionar() to service_role;

do $f$ begin
  if exists (select 1 from public.modulos_instalados where modulo = 'recebimentos' and estado = 'ativo') then
    perform public.fn_recebimentos_provisionar();
  end if;
end;
$f$;
notify pgrst, 'reload schema';

insert into public.modulo_secoes_lgpd (modulo,tabela,ligacao,colunas,colunas_rotulo)
values ('recebimentos','recebimentos_cobrancas','organization_id = $1 and contact_id = $2',array['invoice_url','diagnostic'],array['reason'])
on conflict (modulo,tabela) do update set ligacao=excluded.ligacao,colunas=excluded.colunas,colunas_rotulo=excluded.colunas_rotulo;
