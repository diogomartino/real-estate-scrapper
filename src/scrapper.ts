import { chromium, type BrowserContext, type Page } from "playwright";
import UserAgent from "user-agents";
import type { TProperty } from "./types";
import chalk from "chalk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

const PROXY_URL = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

const TOO_MANY_REQUESTS_STATUS = [429, 403];
const SERVICE_UNAVAILABLE_STATUS = 503;
const FETCH_INTERVAL_MS = 1000;
const FETCH_JITTER_MS_MIN = 150;
const FETCH_JITTER_MS_MAX = 700;
const MAX_SERVICE_UNAVAILABLE_RETRIES = 10;
const SERVICE_UNAVAILABLE_RETRY_STEP_MS = 2000;
const DEFAULT_GOTO_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_FOR_LOAD_STATE_TIMEOUT_MS = 30_000;
const BROWSER_PROFILES_DIR = resolve(process.cwd(), ".playwright", "profiles");
const DIRECT_BROWSER_PROFILE_DIR = resolve(BROWSER_PROFILES_DIR, "direct");
const PROXY_BROWSER_PROFILE_DIR = resolve(BROWSER_PROFILES_DIR, "proxy");
const USER_AGENTS_PATH = resolve(
  process.cwd(),
  ".playwright",
  "user-agents.json",
);
const DEFAULT_ACCEPT_LANGUAGE = "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7";
const DEFAULT_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

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
type UserAgentsByMode = Partial<Record<BrowserMode, string>>;

type ModeSettings = {
  locale: string;
  timezoneId: string;
  viewport: {
    width: number;
    height: number;
  };
  acceptLanguage: string;
};

const MODE_SETTINGS: Record<BrowserMode, ModeSettings> = {
  direct: {
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    viewport: { width: 1920, height: 1080 },
    acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
  },
  proxy: {
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    viewport: { width: 1920, height: 1080 },
    acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
  },
};

class Scrapper {
  private static nextFetchAtByDomain = new Map<string, number>();
  private static fetchQueueByDomain = new Map<string, Promise<void>>();

  private proxiedHosts = new Set<string>();
  private contextPromises = new Map<BrowserMode, Promise<BrowserContext>>();
  private userAgentsByMode: UserAgentsByMode = {};
  private hasLoadedUserAgents = false;

  private getHost = (url: string): string => new URL(url).host;

  private getBrowserMode = (useProxy: boolean): BrowserMode =>
    useProxy ? "proxy" : "direct";

  private createUserAgent = (): string => new UserAgent().toString();

  private getModeSettings = (useProxy: boolean): ModeSettings =>
    MODE_SETTINGS[this.getBrowserMode(useProxy)];

  private getDomainPacingKey = (url: string, useProxy: boolean): string =>
    `${this.getBrowserMode(useProxy)}:${this.getHost(url)}`;

  private getFetchJitterMs = (): number => {
    return (
      FETCH_JITTER_MS_MIN +
      Math.floor(
        Math.random() * (FETCH_JITTER_MS_MAX - FETCH_JITTER_MS_MIN + 1),
      )
    );
  };

  private getCommonRequestHeaders = (userAgent: string): HeadersInit => ({
    "User-Agent": userAgent,
    Accept: DEFAULT_ACCEPT_HEADER,
    "Accept-Language": DEFAULT_ACCEPT_LANGUAGE,
  });

  private ensureBrowserProfilesDirectory = async (): Promise<void> => {
    await mkdir(BROWSER_PROFILES_DIR, { recursive: true });
  };

  private loadUserAgents = async (): Promise<void> => {
    if (this.hasLoadedUserAgents) {
      return;
    }

    this.hasLoadedUserAgents = true;

    try {
      const file = await readFile(USER_AGENTS_PATH, "utf8");
      this.userAgentsByMode = JSON.parse(file) as UserAgentsByMode;
    } catch {
      this.userAgentsByMode = {};
    }
  };

  private persistUserAgents = async (): Promise<void> => {
    await mkdir(resolve(process.cwd(), ".playwright"), { recursive: true });
    await writeFile(
      USER_AGENTS_PATH,
      `${JSON.stringify(this.userAgentsByMode, null, 2)}\n`,
      "utf8",
    );
  };

  private getStableUserAgent = async (useProxy: boolean): Promise<string> => {
    await this.loadUserAgents();

    const mode = this.getBrowserMode(useProxy);
    const existingUserAgent = this.userAgentsByMode[mode];

    if (existingUserAgent) {
      return existingUserAgent;
    }

    const newUserAgent = this.createUserAgent();
    this.userAgentsByMode[mode] = newUserAgent;
    await this.persistUserAgents();

    return newUserAgent;
  };

  private getBrowserProfilePath = (useProxy: boolean): string =>
    useProxy ? PROXY_BROWSER_PROFILE_DIR : DIRECT_BROWSER_PROFILE_DIR;

  private shouldUseProxy = (url: string): boolean =>
    this.proxiedHosts.has(this.getHost(url));

  private enableProxyForHost = (url: string): void => {
    this.proxiedHosts.add(this.getHost(url));
  };

  private getFetchOptions = async (
    useProxy: boolean,
  ): Promise<ScrapperFetchOptions> => {
    const userAgent = await this.getStableUserAgent(useProxy);
    const modeSettings = this.getModeSettings(useProxy);

    return {
      verbose: false,
      keepalive: false,
      headers: {
        ...this.getCommonRequestHeaders(userAgent),
        "Accept-Language": modeSettings.acceptLanguage,
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

  private launchContext = async (
    useProxy: boolean,
  ): Promise<BrowserContext> => {
    const userAgent = await this.getStableUserAgent(useProxy);
    const modeSettings = this.getModeSettings(useProxy);

    return chromium.launchPersistentContext(
      this.getBrowserProfilePath(useProxy),
      {
        headless: true,
        userAgent,
        locale: modeSettings.locale,
        extraHTTPHeaders: {
          "Accept-Language": modeSettings.acceptLanguage,
        },
        viewport: modeSettings.viewport,
        timezoneId: modeSettings.timezoneId,
        ...(useProxy
          ? {
              proxy: {
                server: `http://${PROXY_HOST}:${PROXY_PORT}`,
                username: PROXY_USERNAME,
                password: PROXY_PASSWORD,
              },
            }
          : {}),
      },
    );
  };

  private getContext = async (useProxy: boolean): Promise<BrowserContext> => {
    const browserMode = this.getBrowserMode(useProxy);
    const existingContextPromise = this.contextPromises.get(browserMode);

    if (existingContextPromise) {
      try {
        const existingContext = await existingContextPromise;
        const browser = existingContext.browser();

        if (browser?.isConnected()) {
          return existingContext;
        }
      } catch {
        this.contextPromises.delete(browserMode);
      }
    }

    await this.ensureBrowserProfilesDirectory();
    const contextPromise = this.launchContext(useProxy);

    this.contextPromises.set(browserMode, contextPromise);

    try {
      return await contextPromise;
    } catch (error) {
      this.contextPromises.delete(browserMode);
      throw error;
    }
  };

  private closeContext = async (useProxy: boolean): Promise<void> => {
    const browserMode = this.getBrowserMode(useProxy);
    const contextPromise = this.contextPromises.get(browserMode);

    if (!contextPromise) {
      return;
    }

    this.contextPromises.delete(browserMode);

    const context = await contextPromise;
    const browser = context.browser();

    if (browser?.isConnected()) {
      await context.close();
    }
  };

  private getRenderedHtmlWithBrowser = async (
    url: string,
    useProxy: boolean,
    options: GetRenderedHtmlOptions,
  ): Promise<{ html: string; status: number | undefined }> => {
    const context = await this.getContext(useProxy);
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
      await page.close();
    }
  };

  private waitForFetchSlot = async (
    url: string,
    useProxy: boolean,
  ): Promise<void> => {
    const domainPacingKey = this.getDomainPacingKey(url, useProxy);
    let releaseQueue: (() => void) | undefined;
    const previousQueue =
      Scrapper.fetchQueueByDomain.get(domainPacingKey) ?? Promise.resolve();

    Scrapper.fetchQueueByDomain.set(
      domainPacingKey,
      new Promise<void>((resolve) => {
        releaseQueue = resolve;
      }),
    );

    await previousQueue;

    const nextFetchAt = Scrapper.nextFetchAtByDomain.get(domainPacingKey) ?? 0;
    const waitTime = Math.max(0, nextFetchAt - Date.now());

    if (waitTime > 0) {
      await Bun.sleep(waitTime);
    }

    Scrapper.nextFetchAtByDomain.set(
      domainPacingKey,
      Date.now() + FETCH_INTERVAL_MS + this.getFetchJitterMs(),
    );
    releaseQueue?.();
  };

  private fetchHtml = async (
    url: string,
    useProxy: boolean,
  ): Promise<Response> => {
    await this.waitForFetchSlot(url, useProxy);

    return await fetch(url, await this.getFetchOptions(useProxy));
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
      await this.closeContext(false);
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
        Array.from(this.contextPromises.keys()).map((mode) =>
          this.closeContext(mode === "proxy"),
        ),
      );

      this.proxiedHosts.clear();
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
