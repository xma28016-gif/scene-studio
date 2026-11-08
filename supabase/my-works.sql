begin;

create table if not exists public.scene_works (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ratio text not null check (ratio in ('1:1','3:4','4:3','2:3','3:2','16:9','9:16')),
  scene text not null check (scene in ('两种都要','纯商品展示场景','人机交互场景')),
  requested_count smallint not null check (requested_count between 1 and 4),
  original_name text not null check (char_length(original_name) between 1 and 255),
  original_mime text not null check (original_mime in ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp','image/tiff')),
  original_bytes bigint not null check (original_bytes between 1 and 80000000),
  original_path text not null unique,
  preview_mime text not null check (preview_mime in ('image/jpeg','image/png','image/webp','image/gif')),
  preview_path text not null unique,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (split_part(original_path,'/',1) = user_id::text and split_part(original_path,'/',2) = id::text),
  check (split_part(preview_path,'/',1) = user_id::text and split_part(preview_path,'/',2) = id::text)
);

create table if not exists public.scene_work_images (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  unique (work_id, position),
  foreign key (work_id, user_id) references public.scene_works(id, user_id) on delete cascade,
  check (storage_path = user_id::text || '/' || work_id::text || '/result-' || position::text || '-' || id::text || '.jpg')
);

create index if not exists scene_works_owner_time on public.scene_works(user_id, created_at desc, id desc);
create index if not exists scene_work_images_owner_work on public.scene_work_images(user_id, work_id, position);

alter table public.scene_works enable row level security;
alter table public.scene_work_images enable row level security;
revoke all on public.scene_works, public.scene_work_images from public, anon, authenticated;
grant select on public.scene_works, public.scene_work_images to authenticated;
grant insert (id,user_id,ratio,scene,requested_count,original_name,original_mime,original_bytes,original_path,preview_mime,preview_path) on public.scene_works to authenticated;
grant insert (id,work_id,user_id,position,storage_path) on public.scene_work_images to authenticated;

drop policy if exists scene_works_owner_boundary on public.scene_works;
create policy scene_works_owner_boundary on public.scene_works as restrictive for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists scene_works_read_own on public.scene_works;
create policy scene_works_read_own on public.scene_works for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scene_works_insert_own on public.scene_works;
create policy scene_works_insert_own on public.scene_works for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists scene_work_images_owner_boundary on public.scene_work_images;
create policy scene_work_images_owner_boundary on public.scene_work_images as restrictive for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists scene_work_images_read_own on public.scene_work_images;
create policy scene_work_images_read_own on public.scene_work_images for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scene_work_images_insert_own on public.scene_work_images;
create policy scene_work_images_insert_own on public.scene_work_images for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.scene_works w where w.id = work_id and w.user_id = (select auth.uid()) and position <= w.requested_count
  ));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('scene-works','scene-works',false,80000000,array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif','image/bmp','image/tiff'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Restrictive boundaries still apply if other permissive Storage policies exist.
-- These boundaries leave all other buckets unchanged.
drop policy if exists scene_storage_owner_boundary on storage.objects;
create policy scene_storage_owner_boundary on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'scene-works' or (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id <> 'scene-works' or (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists scene_storage_no_anon on storage.objects;
create policy scene_storage_no_anon on storage.objects as restrictive for all to anon
  using (bucket_id <> 'scene-works') with check (bucket_id <> 'scene-works');

drop policy if exists scene_storage_read_own on storage.objects;
create policy scene_storage_read_own on storage.objects for select to authenticated
  using (bucket_id='scene-works' and (storage.foldername(name))[1]=(select auth.uid())::text and (
    exists (select 1 from public.scene_works w where w.user_id=(select auth.uid()) and (w.original_path=name or w.preview_path=name))
    or exists (select 1 from public.scene_work_images i where i.user_id=(select auth.uid()) and i.storage_path=name)
  ));
drop policy if exists scene_storage_insert_own on storage.objects;
create policy scene_storage_insert_own on storage.objects for insert to authenticated
  with check (bucket_id='scene-works' and (storage.foldername(name))[1]=(select auth.uid())::text and exists (
    select 1 from public.scene_works w
    where w.id::text=(storage.foldername(name))[2] and w.user_id=(select auth.uid())
      and (name=w.original_path or name=w.preview_path or name ~ ('^' || w.user_id::text || '/' || w.id::text || '/result-[1-4]-[0-9a-f-]{36}\.jpg$'))
  ));

notify pgrst, 'reload schema';
commit;
