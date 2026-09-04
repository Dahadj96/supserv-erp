/**
 * The 58 wilayas, as the loi n° 19-12 of 11 December 2019 (ten new wilayas in
 * the south, effective 2021) left them — code and name, in the official
 * French spelling.
 *
 * A LIST, not a constraint. Every `wilaya` column in this system is free text
 * and stays so: "Adrar centre", "In Salah (base ENAGEO)" and the name of a
 * daïra are things people actually type on a delivery note, and a select
 * that refuses them would be refusing the truth. What the list gives is the
 * suggestion under the field — type "Ti" and see Tiaret, Timimoun, Tindouf,
 * Tipaza, Tissemsilt, Tizi Ouzou — and the standard spelling on the papers
 * where a wilaya is printed in full.
 */
export const WILAYAS = [
  ["01", "Adrar"],
  ["02", "Chlef"],
  ["03", "Laghouat"],
  ["04", "Oum El Bouaghi"],
  ["05", "Batna"],
  ["06", "Béjaïa"],
  ["07", "Biskra"],
  ["08", "Béchar"],
  ["09", "Blida"],
  ["10", "Bouira"],
  ["11", "Tamanrasset"],
  ["12", "Tébessa"],
  ["13", "Tlemcen"],
  ["14", "Tiaret"],
  ["15", "Tizi Ouzou"],
  ["16", "Alger"],
  ["17", "Djelfa"],
  ["18", "Jijel"],
  ["19", "Sétif"],
  ["20", "Saïda"],
  ["21", "Skikda"],
  ["22", "Sidi Bel Abbès"],
  ["23", "Annaba"],
  ["24", "Guelma"],
  ["25", "Constantine"],
  ["26", "Médéa"],
  ["27", "Mostaganem"],
  ["28", "M'Sila"],
  ["29", "Mascara"],
  ["30", "Ouargla"],
  ["31", "Oran"],
  ["32", "El Bayadh"],
  ["33", "Illizi"],
  ["34", "Bordj Bou Arréridj"],
  ["35", "Boumerdès"],
  ["36", "El Tarf"],
  ["37", "Tindouf"],
  ["38", "Tissemsilt"],
  ["39", "El Oued"],
  ["40", "Khenchela"],
  ["41", "Souk Ahras"],
  ["42", "Tipaza"],
  ["43", "Mila"],
  ["44", "Aïn Defla"],
  ["45", "Naâma"],
  ["46", "Aïn Témouchent"],
  ["47", "Ghardaïa"],
  ["48", "Relizane"],
  ["49", "Timimoun"],
  ["50", "Bordj Badji Mokhtar"],
  ["51", "Ouled Djellal"],
  ["52", "Béni Abbès"],
  ["53", "In Salah"],
  ["54", "In Guezzam"],
  ["55", "Touggourt"],
  ["56", "Djanet"],
  ["57", "El M'Ghair"],
  ["58", "El Meniaa"],
] as const;

export type WilayaCode = (typeof WILAYAS)[number][0];

/** "Adrar" for "01", "adrar", "01 - Adrar" or "Adrar centre". Null when nothing matches. */
export function wilayaOf(
  text: string | null | undefined,
): { code: WilayaCode; name: string } | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const code = raw.match(/^\d{1,2}\b/)?.[0]?.padStart(2, "0");
  if (code) {
    const byCode = WILAYAS.find(([c]) => c === code);
    if (byCode) return { code: byCode[0], name: byCode[1] };
  }
  const plain = fold(raw);
  // Longest name first, so "Bordj Badji Mokhtar" is not read as "Bordj Bou Arréridj"
  // and "Aïn Témouchent" is not read as "Aïn Defla".
  const ranked = [...WILAYAS].sort((a, b) => b[1].length - a[1].length);
  const hit = ranked.find(([, name]) => plain === fold(name) || plain.startsWith(`${fold(name)} `));
  return hit ? { code: hit[0], name: hit[1] } : null;
}

/** Lower-case, accents and apostrophes gone, so "Bejaia" finds "Béjaïa". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .trim();
}
