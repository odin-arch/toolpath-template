import { describe, expect, it } from 'vitest'
import type { CatalogTool, Holder, HolderProfile } from '@toolpath/catalog-data'
import { mastercamLibrary } from '@toolpath/tool-support/export/mastercam'
import type { ExportNote } from '@toolpath/tool-support/export'
import { mastercamInput, mastercamReport, type StackRequest } from './mastercam-input'
import type { OrderedStack } from './export-input'

/**
 * The seam between this catalog and `@toolpath/tool-support/export/mastercam`.
 *
 * The exporter's own rules are tested where they live, against Mastercam's
 * pinned schema. What is tested here is only what this application decides:
 * which of the order list's rows become one tool and which become two, which
 * guid a record gets, which arm of the holder union travels, and how a note
 * comes back as something a machinist can read.
 */

/** Every length in millimetres, as the catalog stores them whatever the vendor published. */
const endMill: CatalogTool = {
  guid: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
  familyId: 'example_square_4fl',
  brand: 'Example',
  vendor: 'Example Tools Inc',
  catalogNumber: 'TDMX0600',
  materialNumber: null,
  toolType: 'endmill',
  form: 'flat end mill',
  unitSystem: 'millimeters',
  geometry: { DC: 6, SFDM: 6, OAL: 57, LCF: 18, NOF: 4, LBH: 24 },
  materialGroups: ['N'],
  productLine: null,
  threadMethod: null,
  productLink: 'https://example.test/TDMX0600',
  provenance: {},
}

const holder: Holder = {
  guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  familyId: 'example_bt40_er32',
  brand: 'ExampleHold',
  vendor: 'ExampleHold GmbH',
  catalogNumber: 'BT40-ER32-100',
  materialNumber: null,
  contact: 'taper',
  taper: 'BT40',
  clamping: 'collet',
  boreDiameter: null,
  productLink: null,
  cadModelUrl: null,
  provenance: {},
  noseDiameter: 33,
  noseLength: 45,
  bodyDiameter: 45,
  bodyLength: 5,
  projection: 50,
  flangeDiameter: 63,
  gaugeLength: 50,
  colletSeries: 'ER32',
  colletProtrusion: null,
}

const otherHolder: Holder = {
  ...holder,
  guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  catalogNumber: 'BT40-ER32-150',
  projection: 100,
}

/** `[z, r]`, z running from the gage line toward the cutting end. */
const profile: HolderProfile = {
  guid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  catalogNumber: 'BT40-ER32-100',
  datum: 'gage-line',
  points: [
    [-30, 22],
    [0, 31.5],
    [40, 22.5],
    [60, 16.5],
  ],
  complete: true,
  shortfallMm: null,
}

/**
 * Deterministic guids, so a test can say which assembly is which.
 *
 * The fixtures above use real uuids rather than readable names on purpose:
 * Mastercam stores every identifier as sixteen bytes, so the exporter throws on
 * anything that is not one. Every guid in the catalog is a `uuid5` minted by
 * `@toolpath/tool-scraper` — all seventeen records of the committed sample are
 * — and a fixture spelled `cat-tool-1` would test a shape the application never
 * hands it. The same is true of what a {@link MintGuid} returns: production
 * mints with `crypto.randomUUID`, and a counter returning `guid-1` would pass
 * every assertion below while the real exporter refused it.
 */
const MINTED_PREFIX = ['00000000', '0000', '4000', '8000'].join('-')

/** The nth guid {@link counting} mints, for an expectation to name. */
const minted = (nth: number) => `${MINTED_PREFIX}-${String(nth).padStart(12, '0')}`

const counting = () => {
  let at = 0
  return () => {
    at += 1
    return minted(at)
  }
}

const oneStack = (over: Partial<OrderedStack> = {}): Array<OrderedStack> => [
  { key: 'row-1', tool: endMill, ...over },
]

describe('the tool an order-list row becomes', () => {
  const { request } = mastercamInput(oneStack({ holder }), counting())
  const [only] = request.tools ?? []

  it('answers the catalog’s unitSystem to the exporter’s unit', () => {
    // The one rename ingestion makes that the exporter's input does not.
    expect(only?.tool.unit).toBe('millimeters')
  })

  it('states the vendor, the order number and the link the catalog holds', () => {
    expect(only?.tool.vendor).toBe('Example')
    expect(only?.tool.catalogNumber).toBe('TDMX0600')
    expect(only?.tool.productLink).toBe('https://example.test/TDMX0600')
    expect(only?.tool.description).toBe('Example TDMX0600')
  })

  it('turns a catalog null into an absent field, not an empty string', () => {
    const { request: without } = mastercamInput(
      oneStack({ tool: { ...endMill, productLink: null }, holder }),
      counting(),
    )
    expect(without.tools?.[0]?.tool).not.toHaveProperty('productLink')
  })

  it('falls back to the catalog’s own LBH when no stickout was chosen', () => {
    expect(only?.assemblies?.[0]?.stickout).toBe(24)
  })

  it('prefers the stickout the stack was set up at', () => {
    const { request: chosen } = mastercamInput(oneStack({ holder, stickout: 31 }), counting())
    expect(chosen.tools?.[0]?.assemblies?.[0]?.stickout).toBe(31)
  })

  it('numbers the carousel by the row’s place on the list, on the set-up', () => {
    // Mastercam holds a tool number per assembly rather than per tool, which is
    // what lets one end mill sit at two positions without a conflict.
    const { request: two } = mastercamInput(
      [
        { key: 'row-1', tool: endMill, holder },
        {
          key: 'row-2',
          tool: { ...endMill, guid: '6f9619ff-8b86-d011-b42d-00cf4fc964f2' },
          holder,
        },
      ],
      counting(),
    )
    expect(two.tools?.flatMap((each) => each.assemblies ?? []).map((each) => each.number)).toEqual([
      1, 2,
    ])
  })

  it('leaves a tool with no holder decided as a tool with no assembly', () => {
    // Deciding the cutter and leaving the holding for later is a real state of
    // a job; the tool still belongs in the library.
    const { request: bare } = mastercamInput(oneStack(), counting())
    expect(bare.tools).toHaveLength(1)
    expect(bare.tools?.[0]?.assemblies).toEqual([])
    expect(bare.holders).toEqual([])
  })
})

describe('identity is the catalog’s, and only the assembly is minted', () => {
  const { request } = mastercamInput(
    [
      { key: 'row-1', tool: endMill, holder },
      { key: 'row-2', tool: endMill, holder: otherHolder },
    ],
    counting(),
  )

  it('gives one tool in two holders one tool entry and two set-ups', () => {
    // The whole reason this reads differently from `fusion-input.ts`. A Fusion
    // library embeds the holder in the tool record and needs two records;
    // Mastercam joins them relationally, so six stacks of one end mill are one
    // `TlTool` row and six assemblies — which is what a machinist sees in
    // Mastercam's own tree.
    expect(request.tools).toHaveLength(1)
    expect(request.tools?.[0]?.assemblies).toHaveLength(2)
  })

  it('carries the catalog’s own guids for the tool and its holders', () => {
    // Minting these is what would make a re-export look like a new tool.
    expect(request.tools?.[0]?.tool.guid).toBe('6f9619ff-8b86-d011-b42d-00cf4fc964f1')
    expect(request.holders?.map((each) => each.guid)).toEqual([
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    ])
  })

  it('mints an identifier for every set-up', () => {
    // Justin Gray, 2026-09-12. The upstream derivation is stable across
    // re-exports but cannot tell apart one tool in one holder at two
    // stickouts, and those two would silently collapse into one assembly. One
    // rule with no condition on it, at the cost of a re-export being a fresh
    // set of assemblies.
    expect(request.tools?.[0]?.assemblies?.map((each) => each.guid)).toEqual([minted(1), minted(2)])
  })

  it('keeps two stacks apart when the tool and the holder are both the same', () => {
    // The case the derivation cannot see, and the reason for the rule above.
    const { request: twice } = mastercamInput(
      [
        { key: 'row-1', tool: endMill, holder, stickout: 20 },
        { key: 'row-2', tool: endMill, holder, stickout: 40 },
      ],
      counting(),
    )
    const setups = twice.tools?.[0]?.assemblies ?? []
    expect(setups.map((each) => each.stickout)).toEqual([20, 40])
    expect(new Set(setups.map((each) => each.guid)).size).toBe(2)
  })

  it('writes one holder entry however many stacks name it', () => {
    const { request: shared } = mastercamInput(
      [
        { key: 'row-1', tool: endMill, holder },
        {
          key: 'row-2',
          tool: { ...endMill, guid: '6f9619ff-8b86-d011-b42d-00cf4fc964f2' },
          holder,
        },
      ],
      counting(),
    )
    expect(shared.holders).toHaveLength(1)
  })
})

describe('which arm of the holder union travels', () => {
  it('sends the measured silhouette where the catalog has a complete one', () => {
    const { request } = mastercamInput(oneStack({ holder, profile }), counting())
    expect(request.holders?.[0]?.holder).toMatchObject({
      points: profile.points,
      datum: 'gage-line',
      colletSeries: 'ER32',
    })
  })

  it('sends the published dimensions where the model stops short', () => {
    // An incomplete model is missing its cutting end, which is the end that
    // fouls the part — see `measuredShape`.
    const { request } = mastercamInput(
      oneStack({ holder, profile: { ...profile, complete: false } }),
      counting(),
    )
    expect(request.holders?.[0]?.holder).toBe(holder)
  })
})

describe('what the export has to say for itself', () => {
  const stacks: ReadonlyArray<StackRequest> = [
    {
      key: 'row-1',
      toolGuid: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
      holderGuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      catalogNumber: 'TDMX0600',
    },
    {
      key: 'row-2',
      toolGuid: '6f9619ff-8b86-d011-b42d-00cf4fc964f2',
      holderGuid: null,
      catalogNumber: 'TDMX0800',
    },
  ]

  it('counts the rows that reached the file, not the rows of the database', () => {
    // The same quantity `fusionReport` counts, because one dialog shows either.
    expect(mastercamReport(stacks, []).exported).toBe(2)
  })

  it('reads a skip off the note the exporter wrote', () => {
    const notes: ReadonlyArray<ExportNote> = [
      {
        subject: '6f9619ff-8b86-d011-b42d-00cf4fc964f2',
        kind: 'skipped',
        message: 'the catalog states no overall length',
      },
    ]
    const report = mastercamReport(stacks, notes)
    expect(report.exported).toBe(1)
    expect(report.skipped).toEqual([
      { catalogNumber: 'TDMX0800', reason: 'the catalog states no overall length' },
    ])
  })

  it('says a tool was skipped once however many rows ordered it', () => {
    // A note names the tool, and one tool can sit on six rows of the list.
    const twice: ReadonlyArray<StackRequest> = [
      stacks[0] as StackRequest,
      { ...(stacks[0] as StackRequest), key: 'row-2' },
    ]
    const notes: ReadonlyArray<ExportNote> = [
      {
        subject: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
        kind: 'skipped',
        message: 'no Mastercam type draws this',
      },
    ]
    expect(mastercamReport(twice, notes).skipped).toHaveLength(1)
  })

  it('carries a dropped or coerced note about a tool or its holder as a warning', () => {
    const notes: ReadonlyArray<ExportNote> = [
      {
        subject: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        kind: 'skipped',
        message: 'the vendor states no nose diameter',
      },
      {
        subject: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
        kind: 'dropped',
        field: 'TlAssembly',
        message: 'the assembly names a holder which is not in this library',
      },
      {
        subject: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
        kind: 'coerced',
        field: 'MCToolType',
        message: 'written as a bore',
      },
    ]
    const report = mastercamReport(stacks, notes)
    expect(report.warnings.map((each) => each.reason)).toEqual([
      'the assembly names a holder which is not in this library',
      'written as a bore',
    ])
    // The holder was refused, not the tool: the row still reached the file.
    expect(report.exported).toBe(2)
    expect(report.skipped).toEqual([])
  })

  it('does not surface a filled note', () => {
    // Conventions the format demands, not anything a shop has to act on.
    const notes: ReadonlyArray<ExportNote> = [
      {
        subject: '6f9619ff-8b86-d011-b42d-00cf4fc964f1',
        kind: 'filled',
        field: 'HelixAngle',
        message: 'assumed 30°',
      },
    ]
    expect(mastercamReport(stacks, notes).warnings).toEqual([])
  })
})

/**
 * One pass through the real exporter.
 *
 * Not a test of the format — that lives upstream against Mastercam's own
 * schema. It is the sensor for a field this module spells wrongly: the request
 * shape is structural, so a renamed key would otherwise be caught by nothing
 * here and by nobody until a shop opened the file.
 */
describe('against the exporter itself', () => {
  it('is accepted, and writes a SQLite database with both set-ups in it', () => {
    const { request, stacks } = mastercamInput(
      [
        { key: 'row-1', tool: endMill, holder, stickout: 30 },
        { key: 'row-2', tool: endMill, holder: otherHolder, stickout: 45 },
      ],
      counting(),
    )
    const { document, notes } = mastercamLibrary(request)

    expect(new TextDecoder().decode(document.subarray(0, 15))).toBe('SQLite format 3')
    const report = mastercamReport(stacks, notes)
    expect(report.exported).toBe(2)
    expect(report.skipped).toEqual([])
  })
})
