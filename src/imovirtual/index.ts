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
import { getFormattedValue, getImageUrls, getLastUpdated } from "./helpers";
import { db } from "../database";

class Imovirtual extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "imovirtual";
  }

  private getUuidFromUrl = (url: string): string | null => {
    // https://www.imovirtual.com/pt/anuncio/t3-gondomar-green-ID1idIy

    const parts = url.split("-");
    const lastPart = parts.at(-1);

    if (!lastPart) {
      return null;
    }

    return lastPart.trim();
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: `[data-cy="listing-item-link"]`,
      waitForLoadState: "domcontentloaded",
    });

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $(`[data-cy="listing-item-link"]`).each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) {
        return;
      }

      links.add(new URL(href, url).toString());
    });

    const nextPageLink = $(`[aria-label="Go to next Page"]`).attr("href");

    return {
      links: Array.from(links),
      nextPageUrl: nextPageLink
        ? new URL(nextPageLink, url).toString()
        : undefined,
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = this.getUuidFromUrl(url)!;
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: "h1, h2, .property-info",
      waitForLoadState: "domcontentloaded",
    });
    const $ = cheerio.load(html);

    const title = $(`[data-cy="adPageAdTitle"]`).first().text().trim();
    const description = $(`[data-cy="adPageAdDescription"]`)
      .first()
      .text()
      .trim();
    const price = $(`[data-cy="adPageHeaderPrice"]`).first().text().trim();
    const location = $(`[data-sentry-source-file="MapLink.tsx"]`)
      .first()
      .text()
      .trim();
    const ref = $(`[data-sentry-element="ExternalId"]`).first().text().trim();
    const lastUpdated = getLastUpdated($);
    const photos = getImageUrls($);

    return property.parse({
      portal: this.id,
      uuid,
      ref,
      title,
      description: description || undefined,
      price: getFormattedValue(price),
      location,
      link: url,
      energyEfficiency: undefined,
      photos: photos.length > 0 ? photos : undefined,
      lastUpdated,
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

  public buildUrl = ({ minPrice, maxPrice, city }: TSearchOptions): string => {
    const url = new URL(
      `https://www.imovirtual.com/pt/resultados/comprar/apartamento/porto/${city}?limit=36&ownerTypeSingleSelect=ALL&priceMin=${minPrice}&roomsNumber=%5BTHREE%2CFOUR%2CFIVE%2CSIX_OR_MORE%5D&extras=%5BGARAGE%2CLIFT%5D&priceMax=${maxPrice}&by=LATEST&direction=DESC`,
    );

    return url.toString();
  };
}

const imovirtual = new Imovirtual();

export { imovirtual };
