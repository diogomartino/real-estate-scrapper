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
  getEncodedProperty,
  getLastUpdated,
  getPhotos,
  getPublicIdFromUrl,
} from "./helpers";

const CASA_YES_DEFAULT_SEARCH_OPTIONS: TSearchOptions = {
  type: ["t2", "t3", "t4"],
  minPrice: 200000,
  maxPrice: 320000,
  city: "gondomar",
};

type TCasaYesSearchResults = {
  totalPages: number;
};

type TCasaYesNextData = {
  props?: {
    pageProps?: {
      initialSearchResultsInfo?: TCasaYesSearchResults;
    };
  };
};

class CasaYes extends BaseScrapper implements IScrapper {
  constructor() {
    super();
    this.id = "casa-yes";
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

  private getSearchResults = (html: string): TCasaYesSearchResults => {
    const $ = cheerio.load(html);
    const nextData = $("#__NEXT_DATA__").text().trim();

    if (!nextData) {
      throw new Error("Could not find Casa Yes __NEXT_DATA__ payload");
    }

    const parsedData = JSON.parse(nextData) as TCasaYesNextData;
    const searchResults = parsedData.props?.pageProps?.initialSearchResultsInfo;

    if (!searchResults) {
      throw new Error(
        "Could not find Casa Yes search results in __NEXT_DATA__",
      );
    }

    return searchResults;
  };

  private getPropertyPayload = ($: cheerio.CheerioAPI): Record<string, any> => {
    const payload = $("script[type='application/json']").first().text().trim();

    if (!payload) {
      throw new Error("Could not find Casa Yes property payload");
    }

    return JSON.parse(payload) as Record<string, any>;
  };

  private getRequestedPageNumber = (url: string): number => {
    const pageValue = new URL(url).searchParams.get("p");
    const pageNumber = Number.parseInt(pageValue ?? "1", 10);

    return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  };

  private getPropertyUrls = (html: string): string[] => {
    const $ = cheerio.load(html);
    const propertyUrls = new Set<string>();

    $("a[data-id='listing-card-link']").each((_, element) => {
      const href = $(element).attr("href")?.trim();

      if (!href) {
        return;
      }

      propertyUrls.add(new URL(href, "https://casayes.pt").toString());
    });

    return Array.from(propertyUrls);
  };

  public getPagination = async (url: string): Promise<TPaginationResult> => {
    const html = await scrapper.getRenderedHtml(url, {
      waitUntil: "load",
      waitForSelector: `[data-id="listing-card-link"]`,
      waitForLoadState: "networkidle",
      postNavigationDelayMs: 1000,
    });

    const searchResults = this.getSearchResults(html);

    const pageNumber = this.getRequestedPageNumber(url);
    const links = this.getPropertyUrls(html);
    const hasNextPage = pageNumber < searchResults.totalPages;
    const nextPageUrl = hasNextPage
      ? (() => {
          const nextUrl = new URL(url);

          nextUrl.searchParams.set("p", (pageNumber + 1).toString());

          return nextUrl.toString();
        })()
      : undefined;

    return {
      links,
      nextPageUrl,
    };
  };

  public scrapProperty = async (url: string): Promise<TProperty> => {
    const uuid = getPublicIdFromUrl(url);

    if (!uuid) {
      throw new Error(`Could not extract Casa Yes public ID from URL: ${url}`);
    }

    const html = await scrapper.getRenderedHtml(url);
    const $ = cheerio.load(html);
    const lastUpdated = getLastUpdated($);
    const parsedData = this.getPropertyPayload($);
    const encodedProperty = getEncodedProperty(
      parsedData?.props?.pageProps?.listingEncoded,
    );

    const graph = parsedData?.props?.pageProps?.jsonLd?.["@graph"]?.[0];
    const photos = getPhotos($);

    return property.parse({
      portal: this.id,
      uuid,
      title: graph?.name,
      description: graph?.description,
      price: graph?.mainEntity?.price,
      location: graph?.name?.split(" em ").slice(1).join(" em "),
      link: url,
      energyEfficiency: encodedProperty?.listingEnergyEfficiencyLabel,
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

  public buildUrl = ({
    type,
    minPrice,
    maxPrice,
    city,
  }: TSearchOptions): string => {
    const cityConfig = {
      districtSlug: "porto",
      citySlug: city,
      cityLabel: city,
      propertyTypes: "1,2,10",
    };

    const url = new URL(
      `https://casayes.pt/pt/comprar/casaseapartamentos/${cityConfig.districtSlug}/${cityConfig.citySlug}/r/r/${this.getMinimumTypology(type)},garagem,p${minPrice}_${maxPrice}`,
    );

    url.searchParams.set(
      "f",
      JSON.stringify({
        rg: cityConfig.cityLabel,
        lt: cityConfig.propertyTypes,
      }),
    );

    url.searchParams.set("p", "1");
    url.searchParams.set("o", "-PublishingDate");

    return url.toString();
  };
}

const casaYes = new CasaYes();

export { CASA_YES_DEFAULT_SEARCH_OPTIONS, casaYes };
