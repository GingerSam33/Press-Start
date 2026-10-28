-- =====================================================================
-- Press Start · schéma Supabase
-- À coller dans Supabase : SQL Editor → New query → Run
-- =====================================================================

-- 1. Table unique qui contient toutes les fiches (jeux, consoles, réglages…)
create table if not exists public.docs (
  col        text        not null,               -- collection : games, consoles, meta, licences…
  id         text        not null,               -- identifiant de la fiche
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists docs_col_idx on public.docs (col);

-- 2. Sécurité : seul un utilisateur connecté (toi) peut lire et écrire
alter table public.docs enable row level security;
grant select, insert, update, delete on public.docs to authenticated;

drop policy if exists "docs lecture"      on public.docs;
drop policy if exists "docs ajout"        on public.docs;
drop policy if exists "docs modification" on public.docs;
drop policy if exists "docs suppression"  on public.docs;
create policy "docs lecture"      on public.docs for select to authenticated using (true);
create policy "docs ajout"        on public.docs for insert to authenticated with check (true);
create policy "docs modification" on public.docs for update to authenticated using (true) with check (true);
create policy "docs suppression"  on public.docs for delete to authenticated using (true);

-- 3. Mises à jour en direct (synchronisation entre onglets / appareils)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 4. Stockage des images (jaquettes, photos, logos…)
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

drop policy if exists "assets ajout"        on storage.objects;
drop policy if exists "assets modification" on storage.objects;
drop policy if exists "assets suppression"  on storage.objects;
create policy "assets ajout"        on storage.objects for insert to authenticated with check (bucket_id = 'assets');
create policy "assets modification" on storage.objects for update to authenticated using (bucket_id = 'assets') with check (bucket_id = 'assets');
create policy "assets suppression"  on storage.objects for delete to authenticated using (bucket_id = 'assets');
