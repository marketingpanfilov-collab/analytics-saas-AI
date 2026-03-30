-- Отдельная сущность для CRM/обзвонов: контакты и размер компании не смешиваем с ядром organizations.name/slug.

CREATE TABLE IF NOT EXISTS public.organization_crm_profiles (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  owner_full_name text,
  contact_phone text,
  company_size text,
  about_company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_crm_profiles_company_size_check CHECK (
    company_size IS NULL
    OR company_size IN ('0-20', '20-50', '50-100', '100-500', '500+')
  )
);

CREATE INDEX IF NOT EXISTS idx_organization_crm_profiles_contact_phone
  ON public.organization_crm_profiles (contact_phone)
  WHERE contact_phone IS NOT NULL AND contact_phone <> '';

COMMENT ON TABLE public.organization_crm_profiles IS
  'CRM-поля организации (обзвоны, отчёты). Название юр/отображения — в organizations.name.';

-- Перенос из legacy-колонок organizations (если миграция 20260401120000 уже применена).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'owner_full_name'
  ) THEN
    INSERT INTO public.organization_crm_profiles (
      organization_id,
      owner_full_name,
      contact_phone,
      company_size,
      about_company,
      created_at,
      updated_at
    )
    SELECT
      o.id,
      o.owner_full_name,
      o.contact_phone,
      o.company_size,
      o.about_company,
      now(),
      now()
    FROM public.organizations o
    ON CONFLICT (organization_id) DO UPDATE SET
      owner_full_name = COALESCE(EXCLUDED.owner_full_name, public.organization_crm_profiles.owner_full_name),
      contact_phone = COALESCE(EXCLUDED.contact_phone, public.organization_crm_profiles.contact_phone),
      company_size = COALESCE(EXCLUDED.company_size, public.organization_crm_profiles.company_size),
      about_company = COALESCE(EXCLUDED.about_company, public.organization_crm_profiles.about_company),
      updated_at = now();
  END IF;
END $$;

-- Пустая строка CRM для каждой организации без строки.
INSERT INTO public.organization_crm_profiles (organization_id, created_at, updated_at)
SELECT o.id, now(), now()
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_crm_profiles c WHERE c.organization_id = o.id
);

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_company_size_check;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS about_company,
  DROP COLUMN IF EXISTS owner_full_name,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS company_size;
