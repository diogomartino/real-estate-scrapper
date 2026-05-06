import { chromium, type Browser, type Page } from "playwright";
import UserAgent from "user-agents";
import type { TProperty } from "./types";
import chalk from "chalk";

const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

const PROXY_URL = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

const TOO_MANY_REQUESTS_STATUS = [429, 403];
const SERVICE_UNAVAILABLE_STATUS = 503;
const FETCH_INTERVAL_MS = 1000;
const MAX_SERVICE_UNAVAILABLE_RETRIES = 10;
const SERVICE_UNAVAILABLE_RETRY_STEP_MS = 2000;
const DEFAULT_GOTO_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_FOR_LOAD_STATE_TIMEOUT_MS = 30_000;

const isTooManyRequestsStatus = (status: number | undefined): boolean =>
  status !== undefined ? TOO_MANY_REQUESTS_STATUS.includes(status) : false;

type GotoWaitUntilState =
  | "commit"
  | "domcontentloaded"
  | "load"
  | "networkidle";

type LoadState = "domcontentloaded" | "load" | "networkidle";

type GetRenderedHtmlOptions = {
  waitForSelector?: string;
  waitUntil?: GotoWaitUntilState;
  waitForLoadState?: LoadState;
  gotoTimeoutMs?: number;
  waitForSelectorTimeoutMs?: number;
  waitForLoadStateTimeoutMs?: number;
  postNavigationDelayMs?: number;
  onAfterGoto?: (page: Page) => Promise<void> | void;
};

type ScrapperFetchOptions = RequestInit & {
  proxy?: {
    url: string;
  };
  verbose?: boolean;
};

type BrowserMode = "direct" | "proxy";

class Scrapper {
  private static nextFetchAt = 0;
  private static fetchQueue = Promise.resolve();

  private proxiedHosts = new Set<string>();
  private browserPromises = new Map<BrowserMode, Promise<Browser>>();

  private getHost = (url: string): string => new URL(url).host;

  private getBrowserMode = (useProxy: boolean): BrowserMode =>
    useProxy ? "proxy" : "direct";

  private createUserAgent = (): string => new UserAgent().toString();

  private shouldUseProxy = (url: string): boolean =>
    this.proxiedHosts.has(this.getHost(url));

  private enableProxyForHost = (url: string): void => {
    this.proxiedHosts.add(this.getHost(url));
  };

  private getFetchOptions = (useProxy: boolean): ScrapperFetchOptions => {
    return {
      verbose: false,
      keepalive: false,
      headers: {
        "User-Agent": this.createUserAgent(),
      },
      ...(useProxy
        ? {
            proxy: {
              url: PROXY_URL,
            },
          }
        : {}),
    };
  };

  private launchBrowser = (useProxy: boolean): Promise<Browser> =>
    chromium.launch({
      headless: true,
      ...(useProxy
        ? {
            proxy: {
              server: `http://${PROXY_HOST}:${PROXY_PORT}`,
              username: PROXY_USERNAME,
              password: PROXY_PASSWORD,
            },
          }
        : {}),
    });

  private getBrowser = async (useProxy: boolean): Promise<Browser> => {
    const browserMode = this.getBrowserMode(useProxy);
    const existingBrowserPromise = this.browserPromises.get(browserMode);

    if (existingBrowserPromise) {
      try {
        const existingBrowser = await existingBrowserPromise;

        if (existingBrowser.isConnected()) {
          return existingBrowser;
        }
      } catch {
        this.browserPromises.delete(browserMode);
      }
    }

    const browserPromise = this.launchBrowser(useProxy);

    this.browserPromises.set(browserMode, browserPromise);

    try {
      return await browserPromise;
    } catch (error) {
      this.browserPromises.delete(browserMode);
      throw error;
    }
  };

  private closeBrowser = async (useProxy: boolean): Promise<void> => {
    const browserMode = this.getBrowserMode(useProxy);
    const browserPromise = this.browserPromises.get(browserMode);

    if (!browserPromise) {
      return;
    }

    this.browserPromises.delete(browserMode);

    const browser = await browserPromise;

    if (browser.isConnected()) {
      await browser.close();
    }
  };

  private getRenderedHtmlWithBrowser = async (
    url: string,
    useProxy: boolean,
    options: GetRenderedHtmlOptions,
  ): Promise<{ html: string; status: number | undefined }> => {
    const browser = await this.getBrowser(useProxy);
    const context = await browser.newContext({
      userAgent: this.createUserAgent(),
      viewport: { width: 1920, height: 1080 },
      timezoneId: "Europe/Lisbon",
    });
    const page = await context.newPage();

    try {
      const response = await page.goto(url, {
        waitUntil: options.waitUntil ?? "domcontentloaded",
        timeout: options.gotoTimeoutMs ?? DEFAULT_GOTO_TIMEOUT_MS,
      });

      if (options.onAfterGoto) {
        await options.onAfterGoto(page);
      }

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout:
            options.waitForSelectorTimeoutMs ??
            DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT_MS,
        });
      }

      if (options.waitForLoadState) {
        await page.waitForLoadState(options.waitForLoadState, {
          timeout:
            options.waitForLoadStateTimeoutMs ??
            DEFAULT_WAIT_FOR_LOAD_STATE_TIMEOUT_MS,
        });
      }

      if (options.postNavigationDelayMs) {
        await page.waitForTimeout(options.postNavigationDelayMs);
      }

      return {
        html: await page.content(),
        status: response?.status(),
      };
    } finally {
      await context.close();
    }
  };

  private waitForFetchSlot = async (): Promise<void> => {
    let releaseQueue: (() => void) | undefined;
    const previousQueue = Scrapper.fetchQueue;

    Scrapper.fetchQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousQueue;

    const waitTime = Math.max(0, Scrapper.nextFetchAt - Date.now());

    if (waitTime > 0) {
      await Bun.sleep(waitTime);
    }

    Scrapper.nextFetchAt = Date.now() + FETCH_INTERVAL_MS;
    releaseQueue?.();
  };

  private fetchHtml = async (
    url: string,
    useProxy: boolean,
  ): Promise<Response> => {
    await this.waitForFetchSlot();

    return await fetch(url, this.getFetchOptions(useProxy));
  };

  private fetchHtmlWithRetry = async (
    url: string,
    useProxy: boolean,
  ): Promise<Response> => {
    let attempt = 0;
    let response = await this.fetchHtml(url, useProxy);

    while (
      response.status === SERVICE_UNAVAILABLE_STATUS &&
      attempt < MAX_SERVICE_UNAVAILABLE_RETRIES
    ) {
      attempt += 1;
      await Bun.sleep(SERVICE_UNAVAILABLE_RETRY_STEP_MS * attempt);
      response = await this.fetchHtml(url, useProxy);
    }

    return response;
  };

  public getHtml = async (url: string): Promise<string> => {
    const useProxy = this.shouldUseProxy(url);

    let response = await this.fetchHtmlWithRetry(url, useProxy);

    if (!useProxy && isTooManyRequestsStatus(response.status)) {
      this.enableProxyForHost(url);
      response = await this.fetchHtmlWithRetry(url, true);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.text();
  };

  public getRenderedHtml = async (
    url: string,
    options: GetRenderedHtmlOptions = {},
  ): Promise<string> => {
    const useProxy = this.shouldUseProxy(url);

    let renderedPage = await this.getRenderedHtmlWithBrowser(
      url,
      useProxy,
      options,
    );

    if (!useProxy && isTooManyRequestsStatus(renderedPage.status)) {
      this.enableProxyForHost(url);
      await this.closeBrowser(false);
      renderedPage = await this.getRenderedHtmlWithBrowser(url, true, options);
    }

    if (renderedPage.status !== undefined && renderedPage.status >= 400) {
      throw new Error(`HTTP error! status: ${renderedPage.status}`);
    }

    return renderedPage.html;
  };

  public close = async (): Promise<void> => {
    try {
      await Promise.all(
        Array.from(this.browserPromises.keys()).map((mode) =>
          this.closeBrowser(mode === "proxy"),
        ),
      );

      this.proxiedHosts.clear();

      const browser = await this.getBrowser(false);

      await browser.close();
    } catch {
      // Ignore errors during close to ensure all browsers are attempted to be closed
    }
  };
}

const scrapper = new Scrapper();

class BaseScrapper {
  public id = "scrapper";

  public log = (...args: any[]): void => {
    console.log(chalk.green(`[${this.id}]`), ...args);
  };

  public logProperty = (property: TProperty): void => {
    this.log(`New property found: ${property.title} - ${property.price} €`);
  };
}

export { scrapper, BaseScrapper };
