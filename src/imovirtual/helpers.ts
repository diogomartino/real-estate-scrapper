import * as cheerio from "cheerio";

const getLastUpdated = ($: cheerio.CheerioAPI): number | undefined => {
  try {
    const pElement = $("p")
      .filter((_, element) =>
        $(element).text().trim().startsWith("Última atualização"),
      )
      .first();

    const text = pElement.text().trim();
    const datePart = text.split(":")[1]?.trim();

    if (!datePart) {
      return undefined;
    }

    const dateParts = datePart.split(".");

    if (dateParts.length !== 3) {
      return undefined;
    }

    const [dayStr, monthStr, yearStr] = dateParts;
    const day = Number(dayStr);
    const month = Number(monthStr);
    const year = Number(yearStr);

    if (
      isNaN(day) ||
      isNaN(month) ||
      isNaN(year) ||
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12
    ) {
      return undefined;
    }

    const date = new Date(year, month - 1, day);

    return date.getTime();
  } catch {
    return undefined;
  }
};

const getImageUrls = ($: cheerio.CheerioAPI): string[] => {
  const imageUrls = new Set<string>();

  $("picture").each((_, element) => {
    const img = $(element).find("img").first();
    const src = img.attr("src")?.trim();

    if (src) {
      imageUrls.add(src);
    }
  });

  return Array.from(imageUrls);
};

const getFormattedValue = (valueStr: string): number | null => {
  const cleanedValue = valueStr
    .replace(/[€\s]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const numericValue = parseFloat(cleanedValue);

  return isNaN(numericValue) ? null : numericValue;
};

export { getLastUpdated, getImageUrls, getFormattedValue };
