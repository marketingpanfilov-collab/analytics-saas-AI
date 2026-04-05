-- Ручной аудит billable seats для одной организации (Supabase SQL).
-- Замените ORG_UUID на uuid вашей организации (из organizations / organization_members).

-- 1) user_id из organization_members
SELECT 'organization_members' AS source, om.user_id::text AS user_id
FROM public.organization_members om
WHERE om.organization_id = 'ORG_UUID'::uuid
ORDER BY om.user_id;

-- 2) DISTINCT user_id из project_members по проектам этой организации
SELECT DISTINCT 'project_members' AS source, pm.user_id::text AS user_id
FROM public.project_members pm
INNER JOIN public.projects p ON p.id = pm.project_id
WHERE p.organization_id = 'ORG_UUID'::uuid
ORDER BY user_id;

-- 3) UNION DISTINCT (должен совпасть с billable_seat_count из API)
WITH org_u AS (
  SELECT DISTINCT user_id FROM public.organization_members WHERE organization_id = 'ORG_UUID'::uuid
),
proj_u AS (
  SELECT DISTINCT pm.user_id
  FROM public.project_members pm
  INNER JOIN public.projects p ON p.id = pm.project_id
  WHERE p.organization_id = 'ORG_UUID'::uuid
),
unioned AS (
  SELECT user_id FROM org_u
  UNION
  SELECT user_id FROM proj_u
)
SELECT COUNT(*)::int AS distinct_billable_seat_count FROM unioned;

-- 4) Только «скрытые» от экрана команды: есть в проектах, нет в organization_members
WITH org_u AS (
  SELECT user_id FROM public.organization_members WHERE organization_id = 'ORG_UUID'::uuid
),
proj_u AS (
  SELECT DISTINCT pm.user_id
  FROM public.project_members pm
  INNER JOIN public.projects p ON p.id = pm.project_id
  WHERE p.organization_id = 'ORG_UUID'::uuid
)
SELECT pu.user_id::text
FROM proj_u pu
WHERE NOT EXISTS (SELECT 1 FROM org_u o WHERE o.user_id = pu.user_id)
ORDER BY pu.user_id;
