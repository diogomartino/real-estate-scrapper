import * as cheerio from "cheerio";

const getImageUrls = ($: cheerio.CheerioAPI): string[] => {
  const imageUrls = new Set<string>();

  const addUrl = (value?: string) => {
    const normalizedValue = value?.trim();

    if (
      normalizedValue &&
      normalizedValue.startsWith("https://imagens.supercasa.pt/") &&
      !normalizedValue.includes("placeholder") &&
      !normalizedValue.startsWith("data:")
    ) {
      imageUrls.add(normalizedValue);
    }
  };

  $("img").each((_, element) => {
    const image = $(element);

    addUrl(image.attr("src"));
    addUrl(image.attr("data-src"));

    const srcset = image.attr("srcset") ?? image.attr("data-srcset");

    if (srcset) {
      srcset.split(",").forEach((candidate) => {
        const [url] = candidate.trim().split(" ");

        addUrl(url);
      });
    }
  });

  $("[style*='background-image']").each((_, element) => {
    const style = $(element).attr("style");
    const matches =
      style?.match(/https:\/\/imagens\.supercasa\.pt\/[^)\s"']+/g) ?? [];

    matches.forEach((url) => addUrl(url.replace(/^url\((.*)\)$/, "$1")));
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

const getLastUpdated = ($: cheerio.CheerioAPI): number | undefined => {
  try {
    const text = $(".property-lastupdate").first().text().trim();

    const monthMap: Record<string, number> = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    const match = text.match(
      /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})\s+às\s+(\d{2}):(\d{2})/,
    );

    if (!match) throw new Error("Date not found in text");

    const [, day, monthName, year, hours, minutes] = match;
    const month = monthMap[(monthName ?? "").toLowerCase()];

    if (month === undefined) throw new Error(`Unknown month: ${monthName}`);

    const date = new Date(+year!, month, +day!, +hours!, +minutes!);

    return date.getTime();
  } catch {
    return undefined;
  }
};

export { getFormattedValue, getImageUrls, getLastUpdated };
