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
  getLocation,
  getPhotos,
  getPrice,
} from "./helpers";
import { db } from "../database";

class Zome extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "zome";
  }

  private getUuidFromUrl = (url: string): string | null => {
    const path = new URL(url).pathname;
    const parts = path.split("/").filter(Boolean);
    const lastPart = parts.at(-1) ?? null;

    if (lastPart && /^[A-Za-z0-9]+$/.test(lastPart)) {
      return lastPart;
    }

    const slugMatch = lastPart?.match(/-([A-Za-z0-9]+)$/);

    if (slugMatch?.[1]) {
      return slugMatch[1];
    }

    return null;
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: `[aria-label="Pagination"]`,
      waitForLoadState: "domcontentloaded",
      onAfterGoto: async (page) => {
        await page.waitForSelector(`img[alt="Imagem"]`, {
          state: "visible",
          timeout: 10000,
        });

        const firstImage = await page.$(`img[alt="Imagem"]`);

        if (firstImage) {
          await firstImage
            .waitForElementState("stable", { timeout: 5000 })
            .finally(() => {})
            .catch(() => {});
        }
      },
    });

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $(".ListingPreviewItem").each((_, element) => {
      const anchor = $(element).find("a").first();
      const href = anchor.attr("href")?.trim();

      if (href && href.includes("apartamento")) {
        links.add(new URL(href, url).toString());
      }
    });

    const nextPageLink = $(`[aria-label="Go to next page"]`);
    const isDisabled = nextPageLink.attr("aria-disabled") === "true";
    const hasMorePages = !isDisabled && nextPageLink.length > 0;

    let nextPageUrl: string | undefined;

    if (hasMorePages) {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split("/").filter(Boolean);
      const lastSegment = pathSegments[pathSegments.length - 1];
      const match = lastSegment?.match(/p-(\d+)/);

      if (match) {
        const currentPage = Number(match[1]);
        const nextPage = currentPage + 1;
        pathSegments[pathSegments.length - 1] = `p-${nextPage}`;
        urlObj.pathname = "/" + pathSegments.join("/");
        nextPageUrl = urlObj.toString();
      }
    }

    return {
      links: Array.from(links),
      nextPageUrl,
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = this.getUuidFromUrl(url)!;
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: "h3.title",
      waitForLoadState: "domcontentloaded",
    });
    const $ = cheerio.load(html);

    const price = getPrice($);
    const title = $("h3.title").first().text().trim();
    const description = $(".txt-detail-items").eq(1).text().trim();
    const ref = $(".txt-zmid").first().text().trim() || undefined;
    const energyEfficiency = getEnergyEfficiency($);
    const photos = getPhotos($);
    const location = getLocation($);

    return property.parse({
      portal: this.id,
      uuid,
      ref,
      title,
      description: description || undefined,
      price,
      location,
      link: url,
      energyEfficiency: energyEfficiency || undefined,
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

      console.log("links", links);

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
    const types = type.join("/");

    const url = new URL(
      `https://www.zome.pt/pt/pesquisar/comprar-casa/${types}/l1-porto/l2-${city}/total-min-${minPrice}/total-max-${maxPrice}/a-elevador/a-garagem/ordenacao-recentes/p-1`,
    );

    return url.toString();
  };
}

const zome = new Zome();

export { zome };
