import type { CatalogTool, Holder, HolderProfile } from '@toolpath/catalog-data'
import type { HolderProfile as DomainProfile } from '@toolpath/tool-support'

/**
 * What the order list looks like on its way into somebody else's tool library,
 * whichever library that is.
 *
 * `fusion-input.ts` was the whole seam while Fusion was the only format. The
 * Mastercam exporter landed on 2026-09-12 taking the same `CatalogTool` and the
 * same `Holder | HolderProfile` union — `@toolpath/tool-support/export/catalog`
 * is shared between them by design — so what both adapters read is here and
 * what each format decides stays in its own module.
 *
 * The rule in AGENTS.md is that the second consumer is the trigger and that a
 * copy is a divergence with a delay on it. This is that extraction, inside one
 * application rather than out to a package: everything below still reaches for
 * this catalog's own record types, which is exactly the coupling that keeps it
 * out of `packages/`.
 */

/** One distinct stack on the order list, resolved through the current catalog. */
export interface OrderedStack {
  /** The order list's own key for the row, so a note can be sent back to it. */
  readonly key: string
  readonly tool: CatalogTool
  readonly holder?: Holder | undefined
  /**
   * The holder measured off the vendor's CAD model, where the catalog has one.
   *
   * Preferred over the published dimensions when it exists: a `Holder` states a
   * nose, a body and a flange, and an exporter draws three stepped cylinders
   * from them, where a profile is the vendor's own silhouette and carries the
   * V-flange groove and the thread relief. Both exporters cut it at their own
   * gage line, so the two arms agree about where the holder starts.
   */
  readonly profile?: HolderProfile | null | undefined
  /** The setout selected for this stack; absent means the catalog's LBH setup value. */
  readonly stickout?: number | undefined
}

/**
 * The measured silhouette in the shape the domain states one, or `null` to use
 * the vendor's published dimensions instead.
 *
 * Two things make this a conversion rather than a pass-through. This catalog's
 * `HolderProfile` is a *measurement record* — a guid, the catalog number, how
 * well the model agreed with the vendor's gage length — where the domain's is
 * the *shape*, and the two fields the shape needs and the measurement does not
 * carry, `colletSeries` and `colletProtrusion`, are on the holder beside it.
 *
 * **And an incomplete model is refused.** `complete: false` means the vendor's
 * STEP file stops short — five BTKV30 models end at the threaded nose and omit
 * the collet nut altogether. That missing piece is at the cutting end, which is
 * the end that fouls the part, so exporting the measurement would hand a CAM
 * system a holder shorter than the real one and let it clear material it
 * cannot. The published dimensions are the honest answer there, and `catalog.ts`
 * has already backfilled them from whatever the model did reach.
 */
export const measuredShape = (
  holder: Holder,
  profile: HolderProfile | null | undefined,
): DomainProfile | null => {
  if (profile === undefined || profile === null || !profile.complete) {
    return null
  }
  return {
    points: profile.points,
    datum: profile.datum,
    colletSeries: holder.colletSeries,
    colletProtrusion: holder.colletProtrusion,
  }
}

/**
 * A guid per exported record, minted here rather than taken from the catalog.
 *
 * **Neither exporter mints one**, and both are right not to: reusing a catalog
 * guid is what makes a re-exported library update a tool in a CAM system
 * instead of adding a second copy of it. But an order list is not a catalog,
 * and the two formats need different things from that fact — see
 * `fusion-input.ts` and `mastercam-input.ts`, each of which says what it mints
 * and why. This is the seam both take it through, so a test can hand them a
 * counter and say which record is which.
 */
export type MintGuid = () => string

export const browserGuid: MintGuid = () => globalThis.crypto.randomUUID()

/** One thing worth telling whoever pressed the button, in their words. */
export interface ExportDiagnostic {
  readonly catalogNumber: string
  readonly reason: string
}

/**
 * What an export has to say for itself, in the terms the dialog shows.
 *
 * `warnings` is the middle case and the one worth naming carefully: the record
 * went out, and something about it did not travel with it. A holder whose gauge
 * length nobody published, a tool set up at two carousel positions when the
 * format has room for one. Neither is a failure and neither is nothing.
 */
export interface ExportReport {
  readonly exported: number
  readonly skipped: ReadonlyArray<ExportDiagnostic>
  readonly warnings: ReadonlyArray<ExportDiagnostic>
}
