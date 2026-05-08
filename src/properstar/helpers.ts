import * as cheerio from "cheerio";

const getPrice = ($: cheerio.CheerioAPI): number => {
  const price = $(".listing-price-main").first().text().trim();

  const numericPrice = price.replace(/[^0-9]/g, "");

  return parseInt(numericPrice, 10);
};

const getPhotos = ($: cheerio.CheerioAPI): string[] => {
  const photos = new Set<string>();

  $("source").each((_, element) => {
    const srcset = $(element).attr("srcset")?.trim();

    if (!srcset) {
      return;
    }

    const first = srcset.split(",")[0]?.split(" ")[0];

    if (
      first &&
      first.startsWith("https://files-api.properstar.com/api/v2/files/")
    ) {
      photos.add(first);
    }
  });

  return Array.from(photos);
};

export { getPrice, getPhotos };
