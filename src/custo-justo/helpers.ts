import * as cheerio from "cheerio";

const getPublicIdFromUrl = (url: string): string | null => {
  const trimmedUrl = url.replace(/\/$/, "");
  const publicId = trimmedUrl.split("-").pop();

  return publicId && /^[A-Za-z0-9]+$/.test(publicId) ? publicId : null;
};

const getInfoByLabel = (
  $: cheerio.CheerioAPI,
  label: string,
): string | undefined => {
  const labelElement = $(`span:contains("${label}")`)
    .filter((_, element) => {
      return $(element).text().trim() === label;
    })
    .first();

  if (labelElement.length === 0) {
    return undefined;
  }

  const valueElement = labelElement.next();

  if (valueElement.length === 0) {
    return undefined;
  }

  return valueElement.text().trim() || undefined;
};

const getProductSnippet = ($: cheerio.CheerioAPI) => {
  const snippetElement = $("#product_snippet").first().text().trim();
  const data = JSON.parse(snippetElement);

  return data;
};

const getTitle = ($: cheerio.CheerioAPI): string => {
  const snippet = getProductSnippet($);

  return snippet.name.trim();
};

const getDescription = ($: cheerio.CheerioAPI): string => {
  const snippet = getProductSnippet($);

  return snippet.description.trim();
};

const getPrice = ($: cheerio.CheerioAPI): number | undefined => {
  const snippet = getProductSnippet($);

  return Number(snippet.offers?.price) || undefined;
};

const getPhotos = ($: cheerio.CheerioAPI): string[] => {
  const photos = new Set<string>();

  $("img").each((_, element) => {
    const candidate = $(element);
    const className = candidate.attr("class");

    if (className && className.includes("carousel_SPLIDE")) {
      const src = candidate.attr("src")?.trim();

      if (src) {
        photos.add(src);
      }
    }
  });

  return Array.from(photos);
};

const getLastUpdated = ($: cheerio.CheerioAPI): number | undefined => {
  const timeElement = $("i.far.undefined").siblings("p").first();

  if (timeElement.length === 0) {
    return undefined;
  }

  const timeText = timeElement.text().trim();
  const normalized = timeText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .toLowerCase();

  const match = normalized.match(/^(\d{1,2})\s+([a-z]+),\s*(\d{1,2}):(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const [, dayRaw, monthRaw, hourRaw, minuteRaw] = match;
  const monthMap: Record<string, number> = {
    jan: 0,
    fev: 1,
    mar: 2,
    abr: 3,
    mai: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    set: 8,
    out: 9,
    nov: 10,
    dez: 11,
  };

  if (!monthRaw || monthMap[monthRaw] === undefined) {
    return undefined;
  }

  const month = monthMap[monthRaw];

  if (month === undefined) {
    return undefined;
  }

  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const now = new Date();
  const date = new Date(now.getFullYear(), month, day, hour, minute, 0, 0);

  if (isNaN(date.getTime())) {
    return undefined;
  }

  return date.getTime();
};

export {
  getPublicIdFromUrl,
  getPrice,
  getTitle,
  getDescription,
  getInfoByLabel,
  getPhotos,
  getLastUpdated,
};
