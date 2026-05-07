import * as cheerio from "cheerio";

const getPrice = ($: cheerio.CheerioAPI): number | undefined => {
  // .content-price
  // text is "330.000 €"
  const priceElement = $(".content-price").first();

  if (priceElement.length === 0) {
    return undefined;
  }

  const priceText = priceElement.text().trim();

  const match = priceText.match(/([\d.,]+)\s*€/);

  if (!match) {
    return undefined;
  }

  const numericPart = match[1]?.replace(/\./g, "").replace(/,/g, ".");

  const price = Number(numericPart);

  return isNaN(price) ? undefined : price;
};

const getEnergyEfficiency = ($: cheerio.CheerioAPI): string | undefined => {
  // find "img" that where in the "title" attribute it starts with "Certificado Energético"
  // the actual energy efficiency is after "Certificado Energético", for example "Certificado Energético: A"
  const img = $("img[title^='Certificado Energético']").first();

  if (img.length === 0) {
    return undefined;
  }

  const title = img.attr("title")?.trim();

  if (!title) {
    return undefined;
  }

  const match = title.match(/Certificado Energético[:\s]+([A-G])/i);

  if (!match) {
    return undefined;
  }

  return match[1]?.toUpperCase() || undefined;
};

const getPhotos = ($: cheerio.CheerioAPI): string[] => {
  const photos = new Set<string>();

  $("img").each((_, element) => {
    const candidate = $(element);
    const src = candidate.attr("src")?.trim();

    if (src && src.startsWith("https://images.zome.pt/listings/")) {
      photos.add(src);
    }
  });

  return Array.from(photos);
};

const getLocation = ($: cheerio.CheerioAPI): string | undefined => {
  const heading = $("h2:contains('para venda')").first();

  if (heading.length === 0) {
    return undefined;
  }

  const locationElement = heading.next();

  if (locationElement.length === 0) {
    return undefined;
  }

  const rawLocation = locationElement.text().trim();

  const location = rawLocation
    .split("›")
    .map((part) => part.trim())
    .join(", ");

  return location || undefined;
};

export { getPrice, getEnergyEfficiency, getPhotos, getLocation };
