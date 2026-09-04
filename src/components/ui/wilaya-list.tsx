import { WILAYAS } from "@/domain/wilayas";

export const WILAYA_LIST_ID = "wilayas-58";

/**
 * The 58 wilayas under any `<input list={WILAYA_LIST_ID}>`.
 *
 * A datalist and not a select, on purpose: the field stays free text — see
 * src/domain/wilayas.ts — and the list is what the browser offers as the
 * person types. Rendered once per form that needs it; a page with two such
 * fields renders it once and points both at it.
 */
export function WilayaList() {
  return (
    <datalist id={WILAYA_LIST_ID}>
      {WILAYAS.map(([code, name]) => (
        <option key={code} value={name}>
          {code} — {name}
        </option>
      ))}
    </datalist>
  );
}
