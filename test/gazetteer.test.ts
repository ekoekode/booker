import { describe, it, expect } from "vitest";
import { buildCityIndex, geocode, norm, parseAdmin1, parseCountries, pickConfident, searchCities, searchPostal } from "../src/project/gazetteer";

const city = (name: string, asc: string, lat: number, lng: number, cc: string, a1: string, pop: number) =>
  ["1", name, asc, "", String(lat), String(lng), "P", "PPL", cc, "", a1, "", "", "", String(pop)].join("\t");

const CITIES = [
  city("Paris", "Paris", 48.85341, 2.3488, "FR", "11", 2138551),
  city("Paris", "Paris", 33.66094, -95.55551, "US", "TX", 24782),
  city("Springfield", "Springfield", 39.80172, -89.64371, "US", "IL", 114394),
  city("Springfield", "Springfield", 42.10148, -72.58981, "US", "MA", 153606),
  city("Zürich", "Zurich", 47.36667, 8.55, "CH", "25", 341730),
  city("London", "London", 51.50853, -0.12574, "GB", "ENG", 8961989),
  city("London", "London", 42.98339, -81.23304, "CA", "08", 383822),
  city("Rio de Janeiro", "Rio de Janeiro", -22.90642, -43.18223, "BR", "21", 6211223),
].join("\n");
const COUNTRIES = parseCountries(["#header", "FR\tFRA\t250\tFR\tFrance", "US\tUSA\t840\tUS\tUnited States", "CH\tCHE\t756\tSZ\tSwitzerland", "GB\tGBR\t826\tUK\tUnited Kingdom", "CA\tCAN\t124\tCA\tCanada", "BR\tBRA\t76\tBR\tBrazil"].join("\n"));
const ADMIN1 = parseAdmin1(["FR.11\tÎle-de-France\tIle-de-France\t3012874", "US.TX\tTexas\tTexas\t4736286", "US.IL\tIllinois\tIllinois\t4896861", "US.MA\tMassachusetts\tMassachusetts\t6254926", "GB.ENG\tEngland\tEngland\t6269513", "CA.08\tOntario\tOntario\t6093943"].join("\n"));
const ix = buildCityIndex(CITIES, COUNTRIES, ADMIN1);

const post = (cc: string, code: string, place: string, state: string, st: string, lat: number, lng: number) => [cc, code, place, state, st, "", "", "", "", String(lat), String(lng), "4"].join("\t");
const POSTAL = [
  post("US", "10001", "New York", "New York", "NY", 40.75, -73.99),
  post("US", "75460", "Paris", "Texas", "TX", 33.66, -95.55),
  post("FR", "75001", "Paris 01", "Île-de-France", "11", 48.86, 2.34),
  post("GB", "SW1A", "London", "England", "ENG", 51.5, -0.13),
  post("CA", "M5V", "Toronto", "Ontario", "ON", 43.64, -79.4),
].join("\n");

describe("gazetteer", () => {
  it("normalises accents and punctuation", () => {
    expect(norm("Zürich")).toBe("zurich");
    expect(norm("  St. John's ")).toBe("st john s");
  });
  it("puts the biggest city first for a bare name", () => {
    const h = searchCities(ix, "Paris");
    expect(h[0].cc).toBe("FR");
    expect(h.map((x) => x.cc)).toContain("US");
  });
  it("uses state and country words to choose", () => {
    expect(searchCities(ix, "Paris, Texas")[0].cc).toBe("US");
    expect(searchCities(ix, "Paris TX")[0].label).toBe("Paris, Texas, United States");
    expect(searchCities(ix, "Paris, France")[0].cc).toBe("FR");
    expect(searchCities(ix, "London, Ontario, Canada")[0].cc).toBe("CA");
    expect(searchCities(ix, "London UK")[0].cc).toBe("GB");
    expect(searchCities(ix, "Springfield, IL")[0].lat).toBeCloseTo(39.8, 1);
    expect(searchCities(ix, "springfield massachusetts")[0].label).toContain("Massachusetts");
  });
  it("finds names with accents and spaces", () => {
    expect(searchCities(ix, "zurich")[0].cc).toBe("CH");
    expect(searchCities(ix, "Rio de Janeiro Brazil")[0].cc).toBe("BR");
  });
  it("returns nothing for an unknown place", () => {
    expect(searchCities(ix, "Atlantis")).toEqual([]);
    expect(geocode({ cities: ix, postal: null }, "")).toEqual([]);
  });
  it("looks up postal codes", () => {
    expect(searchPostal(POSTAL, "10001", ix)[0].label).toBe("New York, New York, United States (10001)");
    expect(searchPostal(POSTAL, "75001 FR", ix)[0].cc).toBe("FR");
    expect(searchPostal(POSTAL, "TX 75460", ix)[0].label).toContain("Paris, Texas");
    expect(searchPostal(POSTAL, "SW1A 1AA", ix)[0].cc).toBe("GB");
    expect(searchPostal(POSTAL, "M5V 3L9", ix)[0].label).toContain("Toronto");
    expect(searchPostal(POSTAL, "99999", ix)).toEqual([]);
    expect(searchPostal(POSTAL, "Paris", ix)).toEqual([]);
  });
  it("puts the likelier country first when a code is shared and none is given", () => {
    const shared = [post("DZ", "10001", "Bouira", "Bouira", "10", 36.35, 3.84), post("EE", "10001", "Tallinn", "Harju", "37", 59.43, 24.79), post("US", "10001", "New York", "New York", "NY", 40.75, -73.99)].join("\n");
    expect(searchPostal(shared, "10001", ix).map((h) => h.cc)).toEqual(["US", "DZ", "EE"].sort((a, b) => (a === "US" ? -1 : b === "US" ? 1 : 0)));
    expect(searchPostal(shared, "10001 EE", ix)[0].cc).toBe("EE");
  });
  it("shortens long postal place names", () => {
    const long = post("CA", "M5V", "Downtown Toronto (CN Tower / King and Spadina)", "Ontario", "ON", 43.64, -79.4);
    expect(searchPostal(long, "M5V", ix)[0].label).toBe("Downtown Toronto, Ontario, Canada (M5V)");
  });
  it("combines cities and postal codes", () => {
    const src = { cities: ix, postal: () => POSTAL };
    expect(geocode(src, "10001")[0].kind).toBe("postal");
    expect(geocode(src, "Paris, Texas")[0].kind).toBe("city");
    expect(geocode({ cities: null, postal: () => POSTAL }, "10001")).toHaveLength(1);
  });
  it("is confident only when one reading clearly wins", () => {
    expect(pickConfident(searchCities(ix, "Paris, Texas"))?.cc).toBe("US");
    expect(pickConfident(searchCities(ix, "Springfield"))).toBeNull();
    expect(pickConfident([])).toBeNull();
  });
});
