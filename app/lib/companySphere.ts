/**
 * Сфера деятельности компании (ключи в БД — стабильные snake_case).
 * Должны совпадать с CHECK в миграции
 * `supabase/migrations/20260403120000_organization_crm_profiles_company_sphere.sql`.
 */

export type CompanySphereGroup = {
  label: string;
  options: readonly { key: string; label: string }[];
};

export const COMPANY_SPHERE_GROUPS: readonly CompanySphereGroup[] = [
  {
    label: "Технологии и цифра",
    options: [
      { key: "it_software_saas", label: "IT, разработка ПО, SaaS" },
      { key: "internet_digital", label: "Интернет и digital-услуги" },
      { key: "telecom", label: "Телекоммуникации" },
      { key: "cybersecurity", label: "Информационная безопасность" },
      { key: "gaming", label: "Игровая индустрия" },
      { key: "edtech", label: "EdTech" },
      { key: "fintech", label: "FinTech" },
      { key: "healthtech", label: "HealthTech" },
      { key: "martech_adtech", label: "MarTech / AdTech" },
    ],
  },
  {
    label: "Торговля и потребительский рынок",
    options: [
      { key: "ecommerce", label: "E-commerce, маркетплейсы" },
      { key: "retail", label: "Розничная торговля" },
      { key: "wholesale", label: "Оптовая торговля и дистрибуция" },
      { key: "import_export", label: "Импорт и экспорт" },
      { key: "consumer_goods_fmcg", label: "Потребительские товары (FMCG)" },
      { key: "fashion_retail", label: "Мода, одежда, обувь" },
      { key: "beauty_cosmetics", label: "Красота и косметика" },
      { key: "horeca", label: "HoReCa (отели, рестораны, кафе)" },
    ],
  },
  {
    label: "Производство и промышленность",
    options: [
      { key: "manufacturing", label: "Производство (общее)" },
      { key: "industrial_equipment", label: "Промышленное оборудование и машиностроение" },
      { key: "automotive", label: "Автомобилестроение и автобизнес" },
      { key: "aerospace", label: "Авиация и космос" },
      { key: "chemical", label: "Химия и нефтехимия" },
      { key: "metal_mining", label: "Металлургия, добыча металлов" },
      { key: "oil_gas_mining", label: "Нефть, газ, полезные ископаемые" },
      { key: "food_production", label: "Пищевая промышленность" },
      { key: "textile", label: "Текстиль и лёгкая промышленность" },
      { key: "wood_paper", label: "Деревообработка, целлюлозно-бумажная отрасль" },
      { key: "printing_packaging", label: "Полиграфия и упаковка" },
      { key: "agriculture", label: "Сельское хозяйство и агробизнес" },
    ],
  },
  {
    label: "Строительство и недвижимость",
    options: [
      { key: "construction", label: "Строительство" },
      { key: "real_estate", label: "Недвижимость и девелопмент" },
      { key: "architecture_design", label: "Архитектура и проектирование" },
    ],
  },
  {
    label: "Финансы, консалтинг, право",
    options: [
      { key: "finance_banking", label: "Банки и финансовые услуги" },
      { key: "insurance", label: "Страхование" },
      { key: "investment_vc_pe", label: "Инвестиции, венчур, private equity" },
      { key: "consulting", label: "Консалтинг (управленческий)" },
      { key: "audit_accounting", label: "Аудит и бухгалтерия" },
      { key: "legal", label: "Юридические услуги" },
    ],
  },
  {
    label: "Маркетинг, реклама, HR",
    options: [
      { key: "marketing_advertising_pr", label: "Маркетинг, реклама, PR" },
      { key: "hr_recruiting", label: "HR, рекрутинг, аутсорсинг персонала" },
    ],
  },
  {
    label: "Образование, медиа, сервисы",
    options: [
      { key: "education", label: "Образование и корпоративное обучение" },
      { key: "media_publishing", label: "СМИ, издательства, контент" },
      { key: "events_entertainment", label: "Мероприятия и event-индустрия" },
      { key: "sports_fitness", label: "Спорт и фитнес" },
      { key: "tourism_travel", label: "Туризм и путешествия" },
    ],
  },
  {
    label: "Медицина и фарма",
    options: [
      { key: "healthcare", label: "Здравоохранение и медицинские услуги" },
      { key: "pharma_biotech", label: "Фармацевтика и биотехнологии" },
    ],
  },
  {
    label: "Инфраструктура и логистика",
    options: [
      { key: "transport_logistics", label: "Транспорт и логистика" },
      { key: "energy_utilities", label: "Энергетика и коммунальные услуги" },
    ],
  },
  {
    label: "Госсектор, наука, прочее",
    options: [
      { key: "government", label: "Государственный сектор" },
      { key: "ngo_nonprofit", label: "НКО и благотворительность" },
      { key: "science_research", label: "Наука и исследования" },
      { key: "other", label: "Другое" },
    ],
  },
] as const;

const FLAT: { key: string; label: string }[] = COMPANY_SPHERE_GROUPS.flatMap((g) => [...g.options]);

export const COMPANY_SPHERE_KEYS = FLAT.map((o) => o.key) as readonly string[];

const LABEL_MAP = new Map(FLAT.map((o) => [o.key, o.label]));

export function formatCompanySphereLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return LABEL_MAP.get(value) ?? value;
}

export function isCompanySphereValue(v: unknown): v is string {
  return typeof v === "string" && LABEL_MAP.has(v);
}

export type CompanySphereGroupedSelect = {
  includeUnset: boolean;
  groups: { label: string; options: { value: string; label: string }[] }[];
};

/** Сгруппированные опции для select + optgroup. «Не указано» только пока значение пустое. */
export function getCompanySphereGroupedSelect(includeUnset: boolean): CompanySphereGroupedSelect {
  const groups = COMPANY_SPHERE_GROUPS.map((g) => ({
    label: g.label,
    options: g.options.map((o) => ({ value: o.key, label: o.label })),
  }));
  return { includeUnset, groups };
}
