import * as cheerio from "cheerio";

type TCasaYesEncodedProperty = {
  listingEnergyEfficiencyLabel?: string;
};

const getPublicIdFromUrl = (url: string): string | null => {
  const trimmedUrl = url.replace(/\/$/, "");
  const publicId = trimmedUrl.split("/").pop();

  return publicId && /^[A-Za-z0-9]+$/.test(publicId) ? publicId : null;
};

const getPhotos = ($: cheerio.CheerioAPI): string[] => {
  const photos = new Set<string>();

  $("img").each((_, element) => {
    const candidate = $(element).attr("src")?.trim();

    if (
      candidate &&
      candidate.startsWith("https://i.casayes.pt/") &&
      candidate.includes("/listings/")
    ) {
      photos.add(candidate);
    }
  });

  return Array.from(photos);
};

const getLastUpdated = ($: cheerio.CheerioAPI): number | undefined => {
  const timeElement = $("time").last();
  const datetime = timeElement.attr("datetime")?.trim();

  if (datetime) {
    const timestamp = Date.parse(datetime);

    if (!isNaN(timestamp)) {
      return timestamp;
    }
  }

  return undefined;
};

const getEncodedProperty = (
  encodedValue?: string,
): TCasaYesEncodedProperty | undefined => {
  if (!encodedValue) {
    return undefined;
  }

  try {
    const decodedValue = Buffer.from(encodedValue, "base64").toString("utf-8");

    return JSON.parse(decodedValue) as TCasaYesEncodedProperty;
  } catch {
    return undefined;
  }
};

export { getEncodedProperty, getPhotos, getPublicIdFromUrl, getLastUpdated };
