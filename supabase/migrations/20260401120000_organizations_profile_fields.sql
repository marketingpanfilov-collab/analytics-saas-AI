-- Company profile fields for Settings → Общая информация (owner-editable).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS about_company text,
  ADD COLUMN IF NOT EXISTS owner_full_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS company_size text;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_company_size_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_company_size_check
  CHECK (
    company_size IS NULL
    OR company_size IN ('0-20', '20-50', '50-100', '100-500', '500+')
  );
