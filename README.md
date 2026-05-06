# casas

To install dependencies:

```bash
bun install
```

To run a full scrape without notifications:

```bash
bun run scrap
```

This mode traverses the full result set for both providers, but skips listings that are already in the database before fetching the property details page.

To scrape only new listings and stop each provider when it reaches a known one:

```bash
bun run notify
```

This mode also skips known listings, and stops each provider as soon as a known property is found in the newest-first results. `onNewProperty` is only triggered for listings that were actually inserted into the database.

This project was created using `bun init` in bun v1.3.12. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
