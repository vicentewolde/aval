import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Listing, ListingSchema } from "./claims/schema.ts";

/** Plain files under .aval/: easy to inspect, diff and back up. */
export class Store {
  readonly root: string;

  constructor(root = ".aval") {
    this.root = root;
  }

  listingDir(id: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error(`Invalid listing id: ${id}`);
    return join(this.root, "listings", id);
  }

  saveListing(listing: Listing): void {
    const dir = this.listingDir(listing.id);
    mkdirSync(join(dir, "evidence"), { recursive: true });
    writeFileSync(
      join(dir, "listing.json"),
      `${JSON.stringify(ListingSchema.parse(listing), null, 2)}\n`,
    );
  }

  loadListing(id: string): Listing | null {
    const path = join(this.listingDir(id), "listing.json");
    if (!existsSync(path)) return null;
    return ListingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }

  listListings(): Listing[] {
    const dir = join(this.root, "listings");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((id) => this.loadListing(id))
      .filter((l): l is Listing => l !== null);
  }

  appendJsonl(name: string, value: unknown): void {
    mkdirSync(this.root, { recursive: true });
    appendFileSync(join(this.root, name), `${JSON.stringify(value)}\n`);
  }

  readJsonl<T>(name: string): T[] {
    const path = join(this.root, name);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  }
}
