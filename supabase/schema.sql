create extension if not exists pgcrypto with schema extensions;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

create table if not exists public.imoveis (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  descricao text not null default '',
  nome_empreendimento text not null check (char_length(btrim(nome_empreendimento)) between 1 and 160),
  construtora text not null check (char_length(btrim(construtora)) between 1 and 160),
  categoria text not null default 'Apartamento' check (categoria = 'Apartamento'),
  padrao text not null check (padrao in ('Alto padrão', 'Altíssimo padrão')),
  regiao text not null check (regiao in ('Zona Sul', 'Zona Oeste', 'Zona Leste', 'Zona Norte', 'Centro', 'Outra')),
  bairro text not null check (char_length(btrim(bairro)) between 1 and 120),
  cidade text not null check (char_length(btrim(cidade)) between 1 and 120),
  estado text not null check (char_length(btrim(estado)) = 2),
  endereco text not null default '',
  preco numeric(14, 2) check (preco is null or preco >= 0),
  area_m2 numeric(9, 2) not null check (area_m2 > 0),
  quartos smallint not null check (quartos >= 1),
  suites smallint not null check (suites >= 0 and suites <= quartos),
  banheiros smallint not null check (banheiros >= 0),
  vagas smallint not null check (vagas >= 0),
  data_entrega date,
  imagem_capa text check (
    imagem_capa is null
    or imagem_capa ~ '^https?://[^/]+/storage/v1/object/authenticated/imoveis/.+$'
  ),
  video_url text check (video_url is null or video_url ~ '^https?://'),
  planta_url text check (planta_url is null or planta_url ~ '^https?://'),
  destaque boolean not null default false,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.imagens_imoveis (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  url text not null unique check (
    url ~ '^https?://[^/]+/storage/v1/object/authenticated/imoveis/.+$'
  ),
  ordem integer not null default 0 check (ordem >= 0),
  created_at timestamptz not null default now(),
  unique (imovel_id, ordem)
);

create table if not exists public.configuracoes (
  id smallint primary key default 1 check (id = 1),
  nome text not null default 'Maximum Imóveis',
  logotipo text,
  telefone text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  instagram text not null default '',
  endereco text not null default '',
  updated_at timestamptz not null default now()
);

grant select on public.imoveis to anon, authenticated;
grant insert, update, delete on public.imoveis to authenticated;
grant select on public.imagens_imoveis to anon, authenticated;
grant insert, update, delete on public.imagens_imoveis to authenticated;
grant select on public.configuracoes to anon, authenticated;
grant insert, update, delete on public.configuracoes to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists imoveis_set_updated_at on public.imoveis;
create trigger imoveis_set_updated_at
before update on public.imoveis
for each row execute function public.set_updated_at();

drop trigger if exists configuracoes_set_updated_at on public.configuracoes;
create trigger configuracoes_set_updated_at
before update on public.configuracoes
for each row execute function public.set_updated_at();

create or replace function public.validate_delivery_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data_entrega > (current_date + interval '36 months')::date then
    raise exception 'A data de entrega deve estar dentro dos próximos 36 meses.';
  end if;
  return new;
end;
$$;

drop trigger if exists imoveis_validate_delivery_window on public.imoveis;
create trigger imoveis_validate_delivery_window
before insert or update of data_entrega on public.imoveis
for each row execute function public.validate_delivery_window();

create index if not exists imoveis_publicados_created_idx
  on public.imoveis (created_at desc) where status = 'publicado';
create index if not exists imoveis_regiao_status_idx
  on public.imoveis (regiao, status);
create index if not exists imoveis_destaque_status_idx
  on public.imoveis (destaque, status);
alter table public.imoveis enable row level security;
alter table public.imagens_imoveis enable row level security;
alter table public.configuracoes enable row level security;

drop policy if exists "Public can read published properties" on public.imoveis;
create policy "Public can read published properties"
  on public.imoveis for select
  using (status = 'publicado' or (select public.is_admin()));
drop policy if exists "Admins can insert properties" on public.imoveis;
create policy "Admins can insert properties"
  on public.imoveis for insert
  with check ((select public.is_admin()));
drop policy if exists "Admins can update properties" on public.imoveis;
create policy "Admins can update properties"
  on public.imoveis for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
drop policy if exists "Admins can delete properties" on public.imoveis;
create policy "Admins can delete properties"
  on public.imoveis for delete
  using ((select public.is_admin()));

drop policy if exists "Public can read published property images" on public.imagens_imoveis;
create policy "Public can read published property images"
  on public.imagens_imoveis for select
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.imoveis
      where imoveis.id = imagens_imoveis.imovel_id
        and imoveis.status = 'publicado'
    )
  );
drop policy if exists "Admins can insert property images" on public.imagens_imoveis;
create policy "Admins can insert property images"
  on public.imagens_imoveis for insert
  with check ((select public.is_admin()));
drop policy if exists "Admins can update property images" on public.imagens_imoveis;
create policy "Admins can update property images"
  on public.imagens_imoveis for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
drop policy if exists "Admins can delete property images" on public.imagens_imoveis;
create policy "Admins can delete property images"
  on public.imagens_imoveis for delete
  using ((select public.is_admin()));

drop policy if exists "Public can read institutional settings" on public.configuracoes;
create policy "Public can read institutional settings"
  on public.configuracoes for select
  using (true);
drop policy if exists "Admins can insert institutional settings" on public.configuracoes;
create policy "Admins can insert institutional settings"
  on public.configuracoes for insert
  with check ((select public.is_admin()));
drop policy if exists "Admins can update institutional settings" on public.configuracoes;
create policy "Admins can update institutional settings"
  on public.configuracoes for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
drop policy if exists "Admins can delete institutional settings" on public.configuracoes;
create policy "Admins can delete institutional settings"
  on public.configuracoes for delete
  using ((select public.is_admin()));

insert into public.configuracoes (id, nome, telefone, whatsapp, email, instagram, endereco)
values (
  1,
  'Maximum Imóveis',
  '+55 11 99549-3953',
  '5511995493953',
  'maximumimoveis@gmail.com',
  '@maximum.imoveis',
  'São Paulo — SP'
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imoveis', 'imoveis', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

drop policy if exists "Admins can upload property images" on storage.objects;
create policy "Admins can upload property images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imoveis' and (select public.is_admin()));
drop policy if exists "Admins can update property images in storage" on storage.objects;
create policy "Admins can update property images in storage"
  on storage.objects for update to authenticated
  using (bucket_id = 'imoveis' and (select public.is_admin()))
  with check (bucket_id = 'imoveis' and (select public.is_admin()));
drop policy if exists "Admins can delete property images from storage" on storage.objects;
create policy "Admins can delete property images from storage"
  on storage.objects for delete to authenticated
  using (bucket_id = 'imoveis' and (select public.is_admin()));
drop policy if exists "Admins and published property visitors can read images" on storage.objects;
create policy "Admins and published property visitors can read images"
  on storage.objects for select
  using (
    bucket_id = 'imoveis'
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.imoveis
        where imoveis.status = 'publicado'
          and regexp_replace(
            imoveis.imagem_capa,
            '^https?://[^/]+/storage/v1/object/authenticated/imoveis/',
            ''
          ) = storage.objects.name
      )
      or exists (
        select 1 from public.imagens_imoveis
        join public.imoveis on imoveis.id = imagens_imoveis.imovel_id
        where imoveis.status = 'publicado'
          and regexp_replace(
            imagens_imoveis.url,
            '^https?://[^/]+/storage/v1/object/authenticated/imoveis/',
            ''
          ) = storage.objects.name
      )
    )
  );
