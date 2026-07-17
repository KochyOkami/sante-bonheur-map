-- ============================================================
--  Carte du Monde — schéma Supabase
--  À exécuter dans Supabase : SQL Editor > New query > coller > Run
-- ============================================================

-- 1) Table qui stocke royaumes ET lieux (une ligne par élément)
create table if not exists public.features (
  id          text primary key,
  type        text not null check (type in ('kingdom','place')),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Index pour filtrer par type rapidement
create index if not exists features_type_idx on public.features (type);

-- 2) Sécurité au niveau des lignes (RLS)
alter table public.features enable row level security;

-- Lecture : ouverte à tous (le site est public en lecture)
drop policy if exists "lecture publique" on public.features;
create policy "lecture publique"
  on public.features for select
  using (true);

-- Écriture : autorisée à la clé publique (anon).
-- L'accès à l'édition est protégé par mot de passe DANS le site.
-- (Pour une vraie sécurité serveur, voir la note en bas.)
drop policy if exists "ecriture anon" on public.features;
create policy "ecriture anon"
  on public.features for all
  using (true)
  with check (true);

-- 3) Temps réel : diffuser les changements aux visiteurs connectés
alter publication supabase_realtime add table public.features;

-- ============================================================
--  Terminé. Ta table "features" est prête.
--
--  NOTE SÉCURITÉ (optionnel, pour plus tard) :
--  Ici la clé anon peut écrire (le mot de passe ne protège que l'UI).
--  Pour empêcher toute écriture directe non autorisée, on remplacerait
--  la policy "ecriture anon" par une lecture seule, et les écritures
--  passeraient par une Edge Function qui vérifie le mot de passe côté
--  serveur. Demande-le si tu veux durcir.
-- ============================================================
