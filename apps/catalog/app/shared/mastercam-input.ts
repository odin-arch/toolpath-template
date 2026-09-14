import type { ExportNote } from '@toolpath/tool-support/export'
import type {
  CatalogHolder,
  LibraryRequest,
  MastercamSetup,
  MastercamToolRequest,
} from '@toolpath/tool-support/export/mastercam'
import {
  browserGuid,
  measuredShape,
  type ExportDiagnostic,
  type ExportReport,
  type MintGuid,
  type OrderedStack,
} from 'shared/export-input'

/**
 * The order list as `@toolpath/tool-support/export/mastercam` wants to be
 * asked.
 *
 * The Mastercam half of the seam `shared/export-input.ts` splits, and the same
 * division of labour `fusion-input.ts` keeps: the exporter is not this
 * application's — its 79 tables are Mastercam's own schema, pinned out of a
 * real `.TOOLDB` by `pnpm mastercam:adopt` upstream — and what is ours is only
 * the translation from the shapes this catalog stores.
 *
 * ## Why this reads so differently from the Fusion one
 *
 * A Fusion library embeds a holder **inside** the tool record, so a tool set up
 * in two holders is two tool records, and `fusion-input.ts` mints a guid per
 * stack to keep them apart. Mastercam's schema is relational and does not have
 * that problem: `TlTool` holds the tool, `TlAssembly` joins it to a holder, and
 * the exporter writes every row with `addOnce` keyed on the guid it is given.
 * So the shape this module builds is the order list **grouped**: one entry per
 * distinct tool carrying one {@link MastercamSetup} per stack, one entry per
 * distinct holder, and the catalog's own guids throughout.
 *
 * That is the better answer as well as the shorter one. Six stacks sharing an
 * ER32 chuck put one holder in the file rather than six, which is what a
 * machinist sees in Mastercam's own tree.
 *
 * ## The one guid this mints, and why it is allowed to
 *
 * An assembly's identifier is derived upstream from the tool and the holder,
 * which is stable across re-exports — but two stacks can be *the same tool in
 * the same holder at two different stickouts*, and that derivation cannot tell
 * them apart. Those two would collapse into one assembly and the second
 * stickout would be lost silently.
 *
 * So every setup states its own guid, minted per stack. The cost is that a
 * re-export is a fresh set of assemblies rather than an update of the last one
 * — the tools and holders under them keep their catalog guids and do update.
 * Justin Gray took that trade on 2026-09-12: "it's not critical that the guid
 * be the same each time it's exported at all". One rule with no condition on
 * it, rather than a derivation that is right until the day two rows collide.
 */

/** One stack, with what is needed to read the exporter's notes back to its row. */
export interface StackRequest {
  readonly key: string
  /** The catalog's own guid for the tool, which is what the file is keyed on. */
  readonly toolGuid: string
  /** The catalog's guid for its holder, or `null` where the stack has none. */
  readonly holderGuid: string | null
  /** What a machinist orders the tool by, for a message they can act on. */
  readonly catalogNumber: string
}

export interface MastercamInput {
  readonly request: LibraryRequest
  /** Every stack that went in, in order, for {@link mastercamReport}. */
  readonly stacks: ReadonlyArray<StackRequest>
}

/**
 * The holder as the exporter takes one: the shape, plus who made it.
 *
 * No unit system, unlike the Fusion one — the format has no metric mode and the
 * exporter converts every length to inches on the way in.
 */
const holderFor = (stack: OrderedStack): CatalogHolder | undefined => {
  const { holder, profile } = stack
  if (holder === undefined) {
    return undefined
  }
  return {
    guid: holder.guid,
    holder: measuredShape(holder, profile) ?? holder,
    description: `${holder.brand} ${holder.catalogNumber}`,
    vendor: holder.brand,
    catalogNumber: holder.catalogNumber,
    label: `${holder.brand} ${holder.catalogNumber}`,
  }
}

/**
 * Every ordered stack, as a request the exporter can be handed.
 *
 * `number` is the stack's place in this list rather than its place among the
 * tools that survive the export, so a tool the format refuses leaves a gap in
 * the carousel numbering — the same trade `fusion-input.ts` makes and for the
 * same reason. It rides on the *setup* here rather than on the tool, because
 * Mastercam holds a tool number per assembly: one tool at two positions is
 * ordinary rather than a conflict, and the exporter says so in a note when it
 * has to write the base row's single value.
 */
export const mastercamInput = (
  stacks: ReadonlyArray<OrderedStack>,
  mintGuid: MintGuid = browserGuid,
): MastercamInput => {
  const tools = new Map<string, { tool: OrderedStack['tool']; assemblies: Array<MastercamSetup> }>()
  const holders = new Map<string, CatalogHolder>()
  const written: Array<StackRequest> = []

  stacks.forEach((stack, index) => {
    const { tool } = stack
    const holder = holderFor(stack)
    if (holder !== undefined && !holders.has(holder.guid)) {
      holders.set(holder.guid, holder)
    }

    const entry = tools.get(tool.guid) ?? { tool, assemblies: [] }
    if (holder !== undefined) {
      entry.assemblies.push({
        holderGuid: holder.guid,
        stickout: stack.stickout ?? tool.geometry.LBH ?? null,
        number: index + 1,
        guid: mintGuid(),
      })
    }
    tools.set(tool.guid, entry)

    written.push({
      key: stack.key,
      toolGuid: tool.guid,
      holderGuid: holder?.guid ?? null,
      catalogNumber: tool.catalogNumber,
    })
  })

  const requests: Array<MastercamToolRequest> = [...tools.values()].map(({ tool, assemblies }) => ({
    tool: {
      form: tool.form,
      guid: tool.guid,
      unit: tool.unitSystem,
      geometry: tool.geometry,
      threadMethod: tool.threadMethod,
      description: `${tool.brand} ${tool.catalogNumber}`,
      vendor: tool.brand,
      catalogNumber: tool.catalogNumber,
      label: `${tool.brand} ${tool.catalogNumber}`,
      ...(tool.productLink === null ? {} : { productLink: tool.productLink }),
      number: assemblies[0]?.number ?? 0,
    },
    assemblies,
  }))

  return { request: { tools: requests, holders: [...holders.values()] }, stacks: written }
}

/**
 * What the export has to say for itself, read back off the notes.
 *
 * **The notes are the only evidence there is**, which is the one real
 * difference from `fusionReport`. That function tests membership in the Fusion
 * document, because a Fusion library is a JSON object it can look inside. A
 * `.TOOLDB` is a SQLite file, and parsing one back to ask whether a row landed
 * would be a second implementation of the format in this application.
 *
 * The notes carry the answer exactly. `mastercamTool` returns `written: null`
 * on the same line it pushes a `skipped` note and on no other path, so a
 * `skipped` note against a tool's guid means that tool is not in the file — and
 * unlike the Fusion exporter, nothing here writes a `skipped` note about a
 * record that went out anyway.
 *
 * `filled` notes are not surfaced, for the reason `fusionReport` gives: they
 * are conventions the format demands rather than anything a shop has to act on.
 */
export const mastercamReport = (
  stacks: ReadonlyArray<StackRequest>,
  notes: ReadonlyArray<ExportNote>,
): ExportReport => {
  const skipped: Array<ExportDiagnostic> = []
  const warnings: Array<ExportDiagnostic> = []
  const refused = new Set(
    notes.filter((note) => note.kind === 'skipped').map((note) => note.subject),
  )
  // One tool can sit on several rows of the order list, and a note names the
  // tool. Counting the rows would say a tool was skipped twice.
  const counted = new Set<string>()

  for (const stack of stacks) {
    const { catalogNumber, toolGuid, holderGuid } = stack
    if (refused.has(toolGuid)) {
      if (!counted.has(toolGuid)) {
        counted.add(toolGuid)
        const said = notes
          .filter((note) => note.subject === toolGuid && note.kind === 'skipped')
          .map((note) => note.message)
        skipped.push({
          catalogNumber,
          reason: said.length === 0 ? 'Mastercam has no tool type this fits' : said.join('; '),
        })
      }
      continue
    }
    for (const note of notes) {
      const about =
        note.subject === toolGuid || (holderGuid !== null && note.subject === holderGuid)
      if (!about || (note.kind !== 'dropped' && note.kind !== 'coerced')) {
        continue
      }
      const already = warnings.some(
        (each) => each.catalogNumber === catalogNumber && each.reason === note.message,
      )
      if (!already) {
        warnings.push({ catalogNumber, reason: note.message })
      }
    }
  }

  // Rows of the order list that reached the file, which is the same thing
  // `fusionReport` counts — one Fusion record per stack — so that one dialog
  // showing either number is showing the same quantity. Not the tool rows in
  // the database: six stacks sharing an end mill are deliberately one `TlTool`
  // there, and a shop that ordered six assemblies would read "1" as a failure.
  //
  // A holder the exporter refused takes its assemblies with it and the tool
  // still lands, so those rows count as exported and carry a warning.
  const exported = stacks.filter((stack) => !refused.has(stack.toolGuid)).length

  return { exported, skipped, warnings }
}
