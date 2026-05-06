import chalk from "chalk";
import {
  property,
  type IScrapper,
  type TPaginationResult,
  type TProperty,
  type TSearchOptions,
} from "../types";
import { BaseScrapper, scrapper } from "../scrapper";
import * as cheerio from "cheerio";
import {
  getEnergyEfficiency,
  getImageUrls,
  getLocation,
  getPrice,
  getRef,
  getTitle,
} from "./helpers";
import { db } from "../database";

class Remax extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "remax";
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
    const nextPageButton = $("button[aria-label='Go to next page']").first();

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
      waitForSelector: `[data-id="listing-card-link"], button[aria-label="Go to next page"], [data-id="favorite-add-button"]`,
      waitForLoadState: "domcontentloaded",
      onAfterGoto: async (page) => {
        let catches = 0;

        // wait for #caralho
        await page
          .waitForSelector(`[data-id="listing-card-link"]`, { timeout: 5000 })
          .catch(() => {
            catches += 1;
          });

        // find the first image that's descendant of a listing card link and wait for it to load
        const firstImage = await page.$(`[data-id="listing-card-link"] img`);

        if (firstImage) {
          await firstImage
            .waitForElementState("stable", { timeout: 5000 })
            .catch(() => {
              catches += 1;
            });
        } else {
          catches += 1;
        }

        if (catches > 2) {
          this.log(
            "Page seems to be taking too long to load necessary elements, proceeding anyway after 5 seconds...",
          );

          await Bun.sleep(5000);
        }
      },
    });

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $("a[data-id='listing-card-link']").each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) return;

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
      waitForSelector: "#details",
      waitForLoadState: "domcontentloaded",
    });

    const $ = cheerio.load(html);
    const photos = getImageUrls($);

    return property.parse({
      portal: this.id,
      uuid,
      ref: getRef($),
      title: getTitle($),
      description: $(".custom-description").first().text().trim() || undefined,
      price: getPrice($) || undefined,
      location: getLocation($),
      link: url,
      energyEfficiency: getEnergyEfficiency($) || undefined,
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

      if (shouldStop) {
        break;
      }

      nextPageUrl = newNextPageUrl;
      page += 1;
    }

    return properties;
  };

  public buildUrl = ({
    type,
    minPrice,
    maxPrice,
    city,
  }: TSearchOptions): string => {
    const maxType = type.at(-1) ?? "t1";

    const url = new URL(
      `https://remax.pt/pt/comprar/imoveis/habitacao/porto/${city}/r/${maxType},preco_${minPrice}_${maxPrice},com-lugar-estacionamento,com-garagem,com-elevador`,
    );

    return url.toString();
  };
}

const remax = new Remax();

export { remax };
