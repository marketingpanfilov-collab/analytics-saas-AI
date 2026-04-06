/**
 * ID пикселя не секрет. Поддерживаем оба имени: серверный META_PIXEL_ID и NEXT_PUBLIC_
 * (удобно для dev и когда важно явно прокинуть id в клиентский бандл).
 */
export function getMetaPixelIdFromEnv(): string {
  return (
    process.env.META_PIXEL_ID?.trim() ||
    process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ||
    ""
  );
}
