import type { TProperty, TRunBehavior, TRunMode } from "./types";
import fs from "fs/promises";
import path from "path";

const TELEGRAM_MAX_MESSAGE_SIZE = 4096;

const isRunMode = (value: string | undefined): value is TRunMode => {
  return value === "scrap" || value === "notify";
};

const getRunBehavior = (mode: TRunMode): TRunBehavior => {
  return {
    stopOnKnown: mode === "notify",
  };
};

const writeContent = async (content: string) => {
  const filePath = path.join(process.cwd(), `output-${Date.now()}.txt`);

  if (await fs.exists(filePath)) {
    await fs.unlink(filePath);
  }

  await fs.writeFile(filePath, content, "utf-8");
};

const formatPortalLabel = (portal: TProperty["portal"]): string => {
  return portal
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatPortalHeading = (portal: TProperty["portal"]): string => {
  return portal.replace(/-/g, " ").toUpperCase();
};

const formatPropertyPrice = (price: number): string => {
  return new Intl.NumberFormat("pt-PT", {
    maximumFractionDigits: 0,
  }).format(price);
};

const formatPropertyEntry = (property: TProperty, title: string): string => {
  return [
    `🏠 ${title}`,
    `💶 ${formatPropertyPrice(property.price)} €`,
    `🔗 ${property.link}`,
    "",
    "",
  ].join("\n");
};

const formatPropertyEntryWithinLimit = (
  property: TProperty,
  maxEntryLength: number,
): string => {
  const fullEntry = formatPropertyEntry(property, property.title);

  if (fullEntry.length <= maxEntryLength) {
    return fullEntry;
  }

  const baseEntry = formatPropertyEntry(property, "");
  const ellipsis = "...";
  const maxTitleLength = Math.max(
    0,
    maxEntryLength - baseEntry.length - ellipsis.length,
  );
  const truncatedTitle =
    maxTitleLength > 0
      ? `${property.title.slice(0, maxTitleLength)}${ellipsis}`
      : ellipsis;

  return formatPropertyEntry(property, truncatedTitle);
};

const groupPropertiesByPortal = (
  properties: TProperty[],
): Array<[TProperty["portal"], TProperty[]]> => {
  const groupedProperties = new Map<TProperty["portal"], TProperty[]>();

  properties.forEach((property) => {
    const portalProperties = groupedProperties.get(property.portal);

    if (portalProperties) {
      portalProperties.push(property);
      return;
    }

    groupedProperties.set(property.portal, [property]);
  });

  return Array.from(groupedProperties.entries());
};

const buildTelegramMessages = (properties: TProperty[]): string[] => {
  const header = `🏠 Encontradas ${properties.length} novas propriedades\n\n`;
  const footer = `\n⏰ Pesquisa realizada em ${new Date().toLocaleString("pt-PT")}`;
  const reservedFooterLength = footer.length;
  const firstMessageBodyCapacity =
    TELEGRAM_MAX_MESSAGE_SIZE - header.length - reservedFooterLength;
  const regularMessageBodyCapacity =
    TELEGRAM_MAX_MESSAGE_SIZE - reservedFooterLength;
  const portalGroups = groupPropertiesByPortal(properties);
  const messageBodies: string[] = [];

  let currentChunk = "";
  let currentChunkCapacity = firstMessageBodyCapacity;

  portalGroups.forEach(([portal, portalProperties]) => {
    const portalHeading = `🏢 ${formatPortalHeading(portal)}\n\n`;
    let isPortalOpenInCurrentChunk = false;

    portalProperties.forEach((property) => {
      const entryMaxLength = currentChunkCapacity - portalHeading.length;
      const entry = formatPropertyEntryWithinLimit(property, entryMaxLength);
      const nextContent = isPortalOpenInCurrentChunk
        ? entry
        : `${portalHeading}${entry}`;

      if (
        currentChunk.length > 0 &&
        currentChunk.length + nextContent.length > currentChunkCapacity
      ) {
        messageBodies.push(currentChunk);
        currentChunk = "";
        currentChunkCapacity = regularMessageBodyCapacity;
        isPortalOpenInCurrentChunk = false;
      }

      const nextEntryMaxLength = currentChunkCapacity - portalHeading.length;
      const nextEntry = formatPropertyEntryWithinLimit(
        property,
        nextEntryMaxLength,
      );

      if (!isPortalOpenInCurrentChunk) {
        currentChunk += `${portalHeading}${nextEntry}`;
        isPortalOpenInCurrentChunk = true;
        return;
      }

      currentChunk += nextEntry;
    });
  });

  if (currentChunk.length > 0) {
    messageBodies.push(currentChunk);
  }

  if (messageBodies.length === 0) {
    messageBodies.push("Sem propriedades novas.\n");
  }

  return messageBodies.map((chunk, index) => {
    const prefix = index === 0 ? header : "";
    const suffix = index === messageBodies.length - 1 ? footer : "";

    return `${prefix}${chunk}${suffix}`;
  });
};

export { isRunMode, getRunBehavior, writeContent, buildTelegramMessages };
