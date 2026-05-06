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
  getFeatureValueByTitle,
  getFirstImageUrl,
  getFormattedValue,
} from "./helpers";
import { db } from "../database";

class CasasSapo extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "casas-sapo";
  }

  private getUuidFromUrl = (url: string): string | null => {
    const match = url.match(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    );

    return match ? match[0] : null;
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getHtml(url);
    const $ = cheerio.load(html);

    const links: string[] = [];

    $(".property").each((_, element) => {
      const link = $(element)
        .find(".property-info-content")
        .find("a")
        .attr("href");

      if (link) {
        links.push(`https://casa.sapo.pt/comprar-apartamentos${link}`);
      }
    });

    const nextPageLink = $(".pagination a")
      .toArray()
      .map((element) => $(element))
      .find((element) => element.text().trim().startsWith("Seguinte"))
      ?.attr("href");

    return {
      links,
      nextPageUrl: nextPageLink
        ? new URL(nextPageLink, url).toString()
        : undefined,
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = this.getUuidFromUrl(url)!;
    const html = await scrapper.getHtml(url);
    const $ = cheerio.load(html);

    const title = $(".detail-title h1").first().text().trim();
    const location = $(".detail-title-location:last").text().trim();
    const description = $(".detail-description-text:last").text().trim();
    const price = $(".detail-title-price-value:last").text().trim();
    const energyEfficiency = getFeatureValueByTitle(
      $,
      "Certificação Energética",
    );

    const photos: string[] = [];

    $("picture.property-photos").each((_, element) => {
      const picture = $(element);
      const source = picture
        .children("source[srcset], source[data-srcset]")
        .first();
      const image = picture.children("img[data-src], img[src]").first();
      const firstUrl = getFirstImageUrl(
        source.attr("srcset") ?? source.attr("data-srcset"),
        image.attr("data-src") ?? image.attr("src"),
      );

      if (firstUrl) {
        photos.push(firstUrl);
      }
    });

    const ref = getFeatureValueByTitle($, "Referência");

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
    city,
    minPrice,
    maxPrice,
  }: TSearchOptions): string => {
    const url = new URL("https://casa.sapo.pt/comprar-apartamentos");

    if (type.length > 0) {
      url.pathname += `/${type.join(",")}`;
    }

    url.pathname += `/mais-recentes/com-garagem-estacionamento/${city}/`;

    if (minPrice) {
      url.searchParams.set("lp", minPrice.toString());
    }

    if (maxPrice) {
      url.searchParams.set("gp", maxPrice.toString());
    }

    return url.toString();
  };
}

const casasSapo = new CasasSapo();

export { casasSapo };
