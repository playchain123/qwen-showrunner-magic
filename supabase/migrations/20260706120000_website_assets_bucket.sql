-- Public storage bucket for website capture clips and hero screenshots
insert into storage.buckets (id, name, public)
values ('website-assets', 'website-assets', true)
on conflict (id) do nothing;

create policy "Authenticated users upload website assets"
on storage.objects for insert
to authenticated
with check (bucket_id = 'website-assets' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Public read website assets"
on storage.objects for select
to public
using (bucket_id = 'website-assets');

create policy "Service role manages website assets"
on storage.objects for all
to service_role
using (bucket_id = 'website-assets')
with check (bucket_id = 'website-assets');
