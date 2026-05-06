import * as cheerio from "cheerio";

const getFirstImageUrl = (
  srcset?: string,
  src?: string,
): string | undefined => {
  if (srcset) {
    const [candidate] = srcset.split(",");
    const [url] = candidate?.trim().split(" ") ?? [];

    if (url && !url.startsWith("data:")) {
      return url;
    }
  }

  const normalizedSrc = src?.trim();

  if (normalizedSrc && !normalizedSrc.startsWith("data:")) {
    return normalizedSrc;
  }

  return undefined;
};

const getFeatureValueByTitle = (
  $: cheerio.CheerioAPI,
  title: string,
): string | undefined => {
  let featureValue: string | undefined;

  $(".detail-main-features-item").each((_, element) => {
    const item = $(element);
    const itemTitle = item
      .find(".detail-main-features-item-title")
      .text()
      .trim();

    if (itemTitle === title) {
      const value = item.find(".detail-main-features-item-value").text().trim();

      featureValue = value || undefined;

      return false;
    }
  });

  return featureValue;
};

const getFormattedValue = (valueStr: string): number | null => {
  const cleanedValue = valueStr.replace(/[\s€\.]/g, "");
  const numericValue = parseFloat(cleanedValue);

  return isNaN(numericValue) ? null : numericValue;
};

export { getFirstImageUrl, getFeatureValueByTitle, getFormattedValue };
