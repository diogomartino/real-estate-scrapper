import { Database } from "bun:sqlite";
import chalk from "chalk";
import type { TProperty } from "./types";

class Db {
  private db = new Database(process.cwd() + "/casas.db");

  constructor() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS properties (
        portal TEXT NOT NULL,
        uuid TEXT NOT NULL,
        ref TEXT,
        title TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        location TEXT NOT NULL,
        link TEXT NOT NULL,
        energy_efficiency TEXT,
        photos_json TEXT,
        last_updated INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (portal, uuid)
      )
  `);
  }

  public hasProperty = (uuid: string, portal: string): boolean => {
    const query = this.db.query(
      "SELECT 1 FROM properties WHERE portal = ?1 AND uuid = ?2 LIMIT 1",
    );

    return Boolean(query.get(portal, uuid));
  };

  public insertProperty = (property: TProperty): boolean => {
    const query = this.db.query(`
      INSERT OR IGNORE INTO properties (
        portal,
        uuid,
        ref,
        title,
        description,
        price,
        location,
        link,
        energy_efficiency,
        photos_json,
        last_updated
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `);

    const result = query.run(
      property.portal,
      property.uuid,
      property.ref ?? null,
      property.title,
      property.description ?? null,
      property.price,
      property.location,
      property.link,
      property.energyEfficiency ?? null,
      property.photos ? JSON.stringify(property.photos) : null,
      property.lastUpdated ?? null,
    );

    const hasInserted = result.changes > 0;

    if (hasInserted) {
      console.log(
        chalk.gray(`[db]`),
        `Inserted property ${property.uuid} from portal ${property.portal}`,
      );
    } else {
      console.log(
        chalk.gray(`[db]`),
        `Property ${property.uuid} from portal ${property.portal} already exists in the database`,
      );
    }

    return hasInserted;
  };
}

const db = new Db();

export { db };
