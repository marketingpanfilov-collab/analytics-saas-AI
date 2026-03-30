-- Сфера компании (CRM): справочник ключей совпадает с app/lib/companySphere.ts (COMPANY_SPHERE_KEYS).

ALTER TABLE public.organization_crm_profiles
  ADD COLUMN IF NOT EXISTS company_sphere text;

ALTER TABLE public.organization_crm_profiles
  DROP CONSTRAINT IF EXISTS organization_crm_profiles_company_sphere_check;

ALTER TABLE public.organization_crm_profiles
  ADD CONSTRAINT organization_crm_profiles_company_sphere_check
  CHECK (
    company_sphere IS NULL
    OR company_sphere IN (
      'it_software_saas',
      'internet_digital',
      'telecom',
      'cybersecurity',
      'gaming',
      'edtech',
      'fintech',
      'healthtech',
      'martech_adtech',
      'ecommerce',
      'retail',
      'wholesale',
      'import_export',
      'consumer_goods_fmcg',
      'fashion_retail',
      'beauty_cosmetics',
      'horeca',
      'manufacturing',
      'industrial_equipment',
      'automotive',
      'aerospace',
      'chemical',
      'metal_mining',
      'oil_gas_mining',
      'food_production',
      'textile',
      'wood_paper',
      'printing_packaging',
      'agriculture',
      'construction',
      'real_estate',
      'architecture_design',
      'finance_banking',
      'insurance',
      'investment_vc_pe',
      'consulting',
      'audit_accounting',
      'legal',
      'marketing_advertising_pr',
      'hr_recruiting',
      'education',
      'media_publishing',
      'events_entertainment',
      'sports_fitness',
      'tourism_travel',
      'healthcare',
      'pharma_biotech',
      'transport_logistics',
      'energy_utilities',
      'government',
      'ngo_nonprofit',
      'science_research',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS idx_organization_crm_profiles_company_sphere
  ON public.organization_crm_profiles (company_sphere)
  WHERE company_sphere IS NOT NULL;
