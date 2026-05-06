import chalk from "chalk";
import * as cheerio from "cheerio";
import { db } from "../database";
import { BaseScrapper, scrapper } from "../scrapper";
import {
  property,
  type IScrapper,
  type TPaginationResult,
  type TProperty,
  type TSearchOptions,
} from "../types";
import {
  getDescription,
  getInfoByLabel,
  getLastUpdated,
  getPhotos,
  getPrice,
  getPublicIdFromUrl,
  getTitle,
} from "./helpers";

class CustoJusto extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "custo-justo";
  }

  private getMinimumTypology = (types: string[]): string => {
    const minimumBedrooms = types
      .map((value) => Number.parseInt(value.replace(/^t/i, ""), 10))
      .filter((value) => Number.isInteger(value))
      .sort((first, second) => first - second)[0];

    if (!minimumBedrooms) {
      throw new Error("Casa Yes scraper requires at least one typology");
    }

    return `t${minimumBedrooms}`;
  };

  private getPropertyPayload = ($: cheerio.CheerioAPI): Record<string, any> => {
    const payload = $("script[type='application/json']").first().text().trim();

    if (!payload) {
      throw new Error("Could not find Casa Yes property payload");
    }

    return JSON.parse(payload) as Record<string, any>;
  };

  private getRequestedPageNumber = (url: string): number => {
    const pageValue = new URL(url).searchParams.get("o");
    const pageNumber = Number.parseInt(pageValue ?? "1", 10);

    return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  };

  private replacePageNumber = (url: string, pageNumber: number): string => {
    const newUrl = new URL(url);

    newUrl.searchParams.set("o", pageNumber.toString());

    return newUrl.toString();
  };

  private getPropertyUrls = (html: string): string[] => {
    const $ = cheerio.load(html);
    const propertyUrls = new Set<string>();

    $("a").each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) {
        return;
      }

      if (href.includes("/imobiliario/apartamentos/")) {
        propertyUrls.add(
          new URL(href, "https://www.custojusto.pt/").toString(),
        );
      }
    });

    return Array.from(propertyUrls);
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getHtml(url);

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $("a").each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) {
        return;
      }

      if (href.includes("/imobiliario/apartamentos/")) {
        links.add(new URL(href, "https://www.custojusto.pt/").toString());
      }
    });

    const nextPageButton = $(`[aria-label="Próximo"]`);
    const hasNextPage = nextPageButton.length > 0;

    const currentPageNumber = this.getRequestedPageNumber(url);

    const nextPageUrl = hasNextPage
      ? this.replacePageNumber(url, currentPageNumber + 1)
      : undefined;

    return {
      links: Array.from(links),
      nextPageUrl: nextPageUrl
        ? new URL(nextPageUrl, url).toString()
        : undefined,
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = getPublicIdFromUrl(url);
    const html = await scrapper.getHtml(url);
    const $ = cheerio.load(html);

    const title = getTitle($);
    const price = getPrice($);
    const description = getDescription($);
    const ref = getInfoByLabel($, "Id do anúncio");
    const location = getInfoByLabel($, "Freguesia");
    const energyEfficiency = getInfoByLabel($, "Classe Energética");
    const photos = getPhotos($);
    const lastUpdated = getLastUpdated($);

    return property.parse({
      portal: this.id,
      uuid,
      ref,
      title,
      description: description || undefined,
      price,
      location,
      link: url,
      energyEfficiency,
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
        const uuid = getPublicIdFromUrl(link);

        if (!uuid) {
          this.log(`Could not extract public ID from URL: ${link}`);
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

  public buildUrl = (_: TSearchOptions): string => {
    const url = new URL(
      `https://www.custojusto.pt/porto/gondomar/imobiliario/apartamentos-venda?ps=11&pe=15&ros=5&roe=7`,
    );

    return url.toString();
  };
}

const custoJusto = new CustoJusto();

export { custoJusto };
