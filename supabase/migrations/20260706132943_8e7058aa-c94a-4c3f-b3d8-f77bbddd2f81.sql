
CREATE POLICY "Owners read bible refs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'bible-refs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owners upload bible refs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bible-refs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owners update bible refs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'bible-refs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owners delete bible refs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'bible-refs' AND auth.uid()::text = (storage.foldername(name))[1]);
