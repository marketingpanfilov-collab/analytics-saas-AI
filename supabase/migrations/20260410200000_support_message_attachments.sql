-- Optional file attachments on support messages (paths in private storage bucket).

ALTER TABLE public.support_ticket_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.support_ticket_messages.attachments IS 'Array of {path,name,size,content_type?} in bucket support-attachments.';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('support-attachments', 'support-attachments', false, 10485760)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;
