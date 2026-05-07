import { casaYes } from "./casa-yes";
import { casasSapo } from "./casas-sapo";
import { custoJusto } from "./custo-justo";
import { buildTelegramMessages, getRunBehavior, isRunMode } from "./helpers";
import { idealista } from "./idealista";
import { imovirtual } from "./imovirtual";
import { notifier } from "./notifier";
import { remax } from "./remax";
import { scrapper } from "./scrapper";
import { superCasa } from "./super-casa";
import type { TProperty, TSearchOptions } from "./types";
import { zome } from "./zome";

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

await zome.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

await casasSapo.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

await casaYes.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
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

await custoJusto.scrap({
  ...DEFAULT_SEARCH_OPTIONS,
  ...behavior,
  onNewProperty,
});

scrapper.close();

console.log(`New properties found: ${newProperties.length}`);

if (mode === "notify") {
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

  await notifier.sendTelegramNotification(
    "===================================",
  );
}

process.exit(0);
