import * as cheerio from "cheerio";

const getTitleContainer = ($: cheerio.CheerioAPI) => {
  const titleContainer = $("p")
    .filter((_, element) => {
      const text = $(element).text().trim().toLowerCase();
      return text.includes("à venda");
    })
    .first()
    .parent();

  return titleContainer;
};

const getTitle = ($: cheerio.CheerioAPI): string => {
  const titleContainer = getTitleContainer($);

  const title = titleContainer
    .find("p")
    .filter((_, element) => {
      const text = $(element).text().trim();
      return text.length > 0;
    })
    .first()
    .text()
    .trim();

  return title;
};

const getLocation = ($: cheerio.CheerioAPI): string => {
  const titleContainer = getTitleContainer($);

  const location = titleContainer
    .children("div")
    .filter((_, element) => {
      const text = $(element).text().trim();

      return text.length > 0;
    })
    .first()
    .text()
    .trim();

  return location;
};

const getPrice = ($: cheerio.CheerioAPI): number => {
  const price = $("span")
    .filter((_, element) => {
      const classList = $(element).attr("class")?.split(/\s+/) ?? [];
      return classList.includes("leading-[130%]");
    })
    .first()
    .text()
    .trim();

  const numericPrice = price.replace(/\s/g, "").replace("€", "");
  const priceNumber = parseFloat(numericPrice);

  return isNaN(priceNumber) ? 0 : priceNumber;
};

const getRef = ($: cheerio.CheerioAPI): string | undefined => {
  const refText = $("div")
    .filter((_, element) => {
      const text = $(element).text().trim().toLowerCase();
      return text.startsWith("id.");
    })
    .first()
    .text()
    .trim();

  if (refText.length === 0) {
    return undefined;
  }

  return refText.replace(/^id\.\s*/i, "");
};

const getEnergyEfficiency = ($: cheerio.CheerioAPI): string | undefined => {
  const energyEfficiency = $("img")
    .filter((_, element) => {
      const src = $(element).attr("src") ?? "";
      return src.includes("eficiencia-energetica");
    })
    .first()
    .attr("src")
    ?.split("/")
    .pop()
    ?.split(".")
    .shift();

  return energyEfficiency || undefined;
};

const getImageUrls = ($: cheerio.CheerioAPI): string[] => {
  const imageUrls = new Set<string>();

  $("img").each((_, element) => {
    const src = $(element).attr("src")?.trim();

    if (
      src &&
      src.startsWith("https://i.maxwork.pt/l-feat/listings/") &&
      src.endsWith(".jpg")
    ) {
      imageUrls.add(src);
    }
  });

  return Array.from(imageUrls);
};

export {
  getTitle,
  getLocation,
  getPrice,
  getRef,
  getEnergyEfficiency,
  getImageUrls,
};
