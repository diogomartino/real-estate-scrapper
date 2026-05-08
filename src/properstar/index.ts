import {
  property,
  type IScrapper,
  type TPaginationResult,
  type TProperty,
  type TSearchOptions,
} from "../types";
import { BaseScrapper, scrapper } from "../scrapper";
import * as cheerio from "cheerio";
import { getPhotos, getPrice } from "./helpers";
import { db } from "../database";

class Properstar extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "properstar";
  }

  private getUuidFromUrl = (url: string): string | null => {
    const parts = url.split("/").filter(Boolean);

    return parts.at(-1) ?? null;
  };

  private getPageFromUrl = (url: string): number => {
    const pageParam = new URL(url).searchParams.get("p");
    const page = Number(pageParam);

    return Number.isFinite(page) && page > 0 ? page : 1;
  };

  private getNextPageUrl = (
    $: cheerio.CheerioAPI,
    url: string,
  ): string | undefined => {
    const nextPageButton = $(`[aria-label="Next page"]`).first();

    if (nextPageButton.length === 0 || nextPageButton.is(":disabled")) {
      return undefined;
    }

    const nextPageUrl = new URL(url);
    const currentPage = this.getPageFromUrl(url);

    nextPageUrl.searchParams.set("p", String(currentPage + 1));

    return nextPageUrl.toString();
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: `article`,
      waitForLoadState: "domcontentloaded",
    });

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $("article").each((_, element) => {
      const anchor = $(element).find("a").first();

      const href = anchor.attr("href")?.trim();

      if (!href) {
        return;
      }

      links.add(new URL(href, url).toString());
    });

    return {
      links: Array.from(links),
      nextPageUrl: this.getNextPageUrl($, url),
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = this.getUuidFromUrl(url)!;
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: ".listing-price-main",
      waitForLoadState: "domcontentloaded",
    });

    const $ = cheerio.load(html);

    const title = $(".main-info").text().trim();
    const location = $(".item-info-address-inner-address").text().trim();
    const price = getPrice($);
    const description = $(".collapse-description").text().trim() || undefined;
    const photos = getPhotos($);
    const energyEfficiency =
      $(".energy-rate-compact-value").text().trim() || undefined;

    return property.parse({
      portal: this.id,
      uuid,
      ref: undefined,
      title,
      description,
      price,
      location,
      link: url,
      energyEfficiency,
      photos: photos.length > 0 ? photos : undefined,
      lastUpdated: undefined,
    });
  };

  public scrap = async (options: TSearchOptions): Promise<TProperty[]> => {
    const url = this.buildUrl(options);

    this.log(`Starting scrape with URL: ${url}`);

    const seenUuids = new Set<string>();
    const properties: TProperty[] = [];

    let nextPageUrl: string | undefined = url;
    let page = 1;

    while (nextPageUrl) {
      const { links, nextPageUrl: newNextPageUrl } =
        await this.getPagination(nextPageUrl);

      let shouldStop = false;

      this.log(`Found ${links.length} properties on page ${page}`);

      for (const link of links) {
        const uuid = this.getUuidFromUrl(link);

        if (!uuid) {
          this.log(`Could not extract UUID from URL: ${link}`);
          continue;
        }

        if (seenUuids.has(uuid)) {
          this.log(`Already seen property with UUID ${uuid}, skipping`);
          continue;
        }

        if (db.hasProperty(uuid, this.id)) {
          this.log(`Property ${uuid} is already in the database, skipping`);

          if (options.stopOnKnown) {
            this.log(`Stopping scrape after finding known property ${uuid}`);
            shouldStop = true;

            break;
          }

          continue;
        }

        try {
          const property = await this.scrapProperty(link);

          this.logProperty(property);

          const hasInserted = db.insertProperty(property);

          if (hasInserted && options.onNewProperty) {
            options.onNewProperty(property);
          }

          properties.push(property);
          seenUuids.add(uuid);
        } catch (error) {
          this.log(`Error scraping property at ${link}:`, error);
        }
      }

      if (shouldStop || newNextPageUrl?.endsWith(`p=15`)) {
        break;
      }

      nextPageUrl = newNextPageUrl;
      page += 1;
    }

    return properties;
  };

  public buildUrl = ({ minPrice, maxPrice, city }: TSearchOptions): string => {
    const url = new URL(
      `https://www.properstar.pt/portugal/${city}-loc/venda/apartamento-casas/2p-quartos?price.min=${minPrice}&price.max=${maxPrice}&preferredAmenities=Garage&preferredAmenities=Lift`,
    );

    return url.toString();
  };
}

const properstar = new Properstar();

export { properstar };
