import { describe, expect, it } from "vitest";
import { eventBody, eventTitle, findDate } from "../src/sources/dated";

describe("dates in quotations", () => {
  it("finds the most specific date", () => {
    expect(findDate("On 10 June 1342 the fleet sailed, after 1300.")?.date).toBe("10 June 1342");
    expect(findDate("It began June 3, 1348 in the port.")?.date).toBe("June 3 1348");
    expect(findDate("In 1066 the king died.")?.date).toBe("1066");
    expect(findDate("Written in 1998-04-02.")?.date).toBe("1998-04-02");
  });
  it("reads circa, BC and century forms", () => {
    expect(findDate("about c. 1200 the wall rose")?.date).toBe("c. 1200");
    expect(findDate("in 586 BC Jerusalem fell")?.date).toBe("586 BC");
    expect(findDate("the 13th century")?.date).toBe("13th century");
  });
  it("returns null when there is no date", () => {
    expect(findDate("Page 12 of the text, no dates here.")).toBeNull();
  });
  it("names an event and writes its note", () => {
    expect(eventTitle("The fleet sailed from the harbour at dawn, said the chronicler.")).toBe("The fleet sailed from the harbour at");
    expect(eventTitle("  ...  ")).toBe("Event");
    expect(eventBody("A line", "[@key, p. 3]")).toBe("> A line\n\n— [@key, p. 3]\n");
  });
});
