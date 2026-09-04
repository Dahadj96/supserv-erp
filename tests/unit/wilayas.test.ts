import { describe, expect, it } from "vitest";
import { WILAYAS, wilayaOf } from "@/domain/wilayas";

describe("the 58 wilayas", () => {
  it("are fifty-eight, numbered 01 to 58 without a gap or a repeat", () => {
    expect(WILAYAS).toHaveLength(58);
    expect(WILAYAS.map(([code]) => code)).toEqual(
      Array.from({ length: 58 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(new Set(WILAYAS.map(([, name]) => name)).size).toBe(58);
  });

  it("start with Adrar and end with the ten of 2019", () => {
    expect(WILAYAS[0]).toEqual(["01", "Adrar"]);
    expect(WILAYAS[48]).toEqual(["49", "Timimoun"]);
    expect(WILAYAS[57]).toEqual(["58", "El Meniaa"]);
  });
});

describe("wilayaOf", () => {
  it("reads a code, a name, a name with the code in front, and a name with more after it", () => {
    expect(wilayaOf("01")).toEqual({ code: "01", name: "Adrar" });
    expect(wilayaOf("1")).toEqual({ code: "01", name: "Adrar" });
    expect(wilayaOf("Adrar")).toEqual({ code: "01", name: "Adrar" });
    expect(wilayaOf("01 - Adrar")).toEqual({ code: "01", name: "Adrar" });
    expect(wilayaOf("Adrar centre")).toEqual({ code: "01", name: "Adrar" });
  });

  it("forgives accents, case and apostrophes", () => {
    expect(wilayaOf("bejaia")?.name).toBe("Béjaïa");
    expect(wilayaOf("MSILA")?.name).toBe("M'Sila");
    expect(wilayaOf("el m’ghair")?.name).toBe("El M'Ghair");
  });

  it("does not confuse the wilayas that share a first word", () => {
    expect(wilayaOf("Bordj Badji Mokhtar")?.code).toBe("50");
    expect(wilayaOf("Bordj Bou Arreridj")?.code).toBe("34");
    expect(wilayaOf("Aïn Témouchent")?.code).toBe("46");
    expect(wilayaOf("In Guezzam")?.code).toBe("54");
  });

  it("returns null for nothing and for a place that is not a wilaya", () => {
    expect(wilayaOf("")).toBeNull();
    expect(wilayaOf(null)).toBeNull();
    expect(wilayaOf("Reggane")).toBeNull();
  });
});
