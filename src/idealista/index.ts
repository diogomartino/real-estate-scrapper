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

class Idealista extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "idealista";
  }

  private getUuidFromUrl = (url: string): string | null => {
    const match = url.match(/\/i(\d+)(?:$|[/?#])/i);

    return match?.[1] ?? null;
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: ".item",
      waitForLoadState: "domcontentloaded",
    });

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $(".item > .item-info-container > a").each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) {
        return;
      }

      links.add(new URL(href, url).toString());
    });

    // process.exit(0);

    // const nextPageLink = $(".list-pagination-next").attr("href");

    // return {
    //   links: Array.from(links),
    //   nextPageUrl: nextPageLink
    //     ? new URL(nextPageLink, url).toString()
    //     : undefined,
    // };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = this.getUuidFromUrl(url)!;
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: "h1, h2, .property-info",
      waitForLoadState: "domcontentloaded",
    });
    const $ = cheerio.load(html);

    const title =
      $("h2").first().text().trim() || $("h1").first().text().trim();
    const description = $(".detail-info-description-txt").first().text().trim();
    const price = $(".property-price").first().text().trim();
    const location = $(".property-list-title").first().text().trim();
    const refText = $(".property-features-ref").first().text().trim();
    const ref = refText ? refText.replace("Ref:", "").trim() : undefined;
    const energyEfficiency = $(".energetic-value").first().text().trim();
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
      energyEfficiency: energyEfficiency || undefined,
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

  public buildUrl = ({
    type,
    minPrice,
    maxPrice,
    city,
  }: TSearchOptions): string => {
    const types = type.join(",");

    const url = new URL(
      `https://www.idealista.pt/comprar-casas/${city}/com-preco-max_${maxPrice},preco-min_${minPrice},${types},elevador,garagem/?ordem=atualizado-desc`,
    );

    return url.toString();
  };
}

const idealista = new Idealista();

export { idealista };
