import type BookerPlugin from "../main";
import { buildCityIndex, geocode, parseAdmin1, parseCountries, type CityIndex, type PlaceHit } from "../project/gazetteer";

/**
 * The downloaded place data (GeoNames, CC BY 4.0) and the lookups made from it. Files live in the plugin folder under `places/`:
 *   cities15000.txt, admin1CodesASCII.txt, countryInfo.txt   from the "Places: cities" download
 *   postal.txt                                               from the "Places: postal codes" download
 * Nothing here goes online; the Resource manager does the downloading when the user presses its button.
 */
export const PLACES_FILES = { cities: "cities15000.txt", admin1: "admin1CodesASCII.txt", countries: "countryInfo.txt", postal: "postal.txt" } as const;

export class PlacesStore {
  private cities: CityIndex | null = null;
  private postalText: string | null = null;
  private postalTimer = 0;

  constructor(private plugin: BookerPlugin) {}

  dir(): string {
    return `${this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/booker`}/places`;
  }

  private path(file: string) {
    return `${this.dir()}/${file}`;
  }

  async status(): Promise<{ cities: boolean; postal: boolean }> {
    const a = this.plugin.app.vault.adapter;
    const has = (f: string) => a.exists(this.path(f));
    return { cities: (await has(PLACES_FILES.cities)) && (await has(PLACES_FILES.admin1)) && (await has(PLACES_FILES.countries)), postal: await has(PLACES_FILES.postal) };
  }

  /** Drop what is loaded, after a download or a removal. */
  reset() {
    this.cities = null;
    this.postalText = null;
    window.clearTimeout(this.postalTimer);
  }

  private async cityIndex(): Promise<CityIndex | null> {
    if (this.cities) return this.cities;
    const a = this.plugin.app.vault.adapter;
    if (!(await this.status()).cities) return null;
    const [c, ad, co] = await Promise.all([a.read(this.path(PLACES_FILES.cities)), a.read(this.path(PLACES_FILES.admin1)), a.read(this.path(PLACES_FILES.countries))]);
    this.cities = buildCityIndex(c, parseCountries(co), parseAdmin1(ad));
    return this.cities;
  }

  /** The postal file is large, so it is read when a lookup needs it and let go a minute later. */
  private async postal(): Promise<string | null> {
    if (this.postalText === null) {
      const a = this.plugin.app.vault.adapter;
      if (!(await a.exists(this.path(PLACES_FILES.postal)))) return null;
      this.postalText = await a.read(this.path(PLACES_FILES.postal));
    }
    window.clearTimeout(this.postalTimer);
    this.postalTimer = window.setTimeout(() => (this.postalText = null), 60_000);
    return this.postalText;
  }

  /** What the author typed, as places. Empty when nothing matches or no data is installed (see `status`). */
  async lookup(query: string): Promise<PlaceHit[]> {
    const cities = await this.cityIndex();
    const needsPostal = /\d/.test(query);
    const postal = needsPostal ? await this.postal() : null;
    return geocode({ cities, postal: postal === null ? null : () => postal }, query);
  }
}
