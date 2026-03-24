import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/api/", "/reset", "/login"],
      },
    ],
    sitemap: "https://boardiq.kz/sitemap.xml",
    host: "https://boardiq.kz",
  };
}
