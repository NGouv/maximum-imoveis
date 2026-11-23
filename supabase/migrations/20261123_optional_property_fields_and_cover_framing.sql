begin;

alter table public.imoveis
  alter column descricao drop not null,
  alter column nome_empreendimento drop not null,
  alter column construtora drop not null,
  alter column endereco drop not null,
  alter column quartos drop not null,
  alter column suites drop not null,
  alter column banheiros drop not null,
  alter column vagas drop not null;

alter table public.imoveis
  add column if not exists enquadramento_capa jsonb not null
  default '{"card":{"x":50,"y":50,"zoom":1},"detail":{"x":50,"y":50,"zoom":1}}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.imoveis'::regclass
      and conname = 'imoveis_enquadramento_capa_object_check'
  ) then
    alter table public.imoveis
      add constraint imoveis_enquadramento_capa_object_check
      check (jsonb_typeof(enquadramento_capa) = 'object');
  end if;
end;
$$;

commit;
