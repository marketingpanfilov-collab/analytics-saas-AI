import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BoardIQ",
    short_name: "BoardIQ",
    description:
      "BoardIQ объединяет рекламные данные, атрибуцию DDA и управленческие рекомендации в единой аналитической платформе.",
    start_url: "/",
    display: "standalone",
    background_color: "#030303",
    theme_color: "#030303",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
