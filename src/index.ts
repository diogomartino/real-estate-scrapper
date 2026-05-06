import { CASA_YES_DEFAULT_SEARCH_OPTIONS, casaYes } from "./casa-yes";
import { casasSapo } from "./casas-sapo";
import { buildTelegramMessages, getRunBehavior, isRunMode } from "./helpers";
import { idealista } from "./idealista";
import { imovirtual } from "./imovirtual";
import { notifier } from "./notifier";
import { remax } from "./remax";
import { scrapper } from "./scrapper";
import { superCasa } from "./super-casa";
import type { TProperty, TSearchOptions } from "./types";

const DEFAULT_SEARCH_OPTIONS: TSearchOptions = {
  minPrice: 230000,
  maxPrice: 320000,
  city: "gondomar",
  type: ["t2", "t3", "t4"],
};

const mode = process.argv[2];

if (!isRunMode(mode)) {
  throw new Error("Usage: bun ./src/index.ts <scrap|notify>");
}

const behavior = getRunBehavior(mode);

const newProperties: TProperty[] = [];

const onNewProperty = (property: TProperty) => {
  newProperties.push(property);
};

await casasSapo.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

await casaYes.scrap({
  ...CASA_YES_DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

await superCasa.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

await remax.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  type: ["t2"],
  onNewProperty,
});

// const allProperties = [
//   ...casasSapoProperties,
//   ...casaYesProperties,
//   ...superCasaProperties,
//   ...remaxProperties,
// ];

console.log(`New properties found: ${newProperties.length}`);

if (newProperties.length > 0) {
  newProperties.forEach((property) => {
    console.log(`- ${property.title} (${property.link})`);
  });

  const messages = buildTelegramMessages(newProperties);

  for (const message of messages) {
    await notifier.sendTelegramNotification(message);
  }
} else {
  console.log("No new properties found.");

  await notifier.sendTelegramNotification(
    `Não foram encontradas novas propriedades. Última verificação: ${new Date().toLocaleString("pt-PT")}`,
  );
}

await notifier.sendTelegramNotification("===================================");

await scrapper.close();

process.exit(0);
