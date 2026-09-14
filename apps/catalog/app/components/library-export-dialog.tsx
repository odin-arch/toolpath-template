import { useState } from 'react'
import { Button, Card, Input } from '@toolpath/ui'
import type { ExportReport } from 'shared/export-input'
import { useEscape } from 'shared/use-escape'
import { SECTION_LABEL } from 'shared/type'

/** Everything one CAM format changes about this dialog, and nothing else. */
export interface LibraryFormat {
  /** The format in a machinist's words — `Fusion`, `Mastercam`. */
  readonly name: string
  /** What the file is called at the end, `.json` or `.TOOLDB`. */
  readonly extension: string
  /** One line under the heading saying what is about to be written. */
  readonly blurb: string
}

export interface LibraryExportDialogProps {
  readonly format: LibraryFormat
  readonly initialName: string
  readonly onCancel: () => void
  readonly onExport: (name: string) => Promise<ExportReport>
}

/**
 * The one last question before the bill becomes a file: what to call it.
 *
 * It asked two more until the exporter moved to
 * `@toolpath/tool-support/export/fusion` — a workpiece material and a maximum
 * spindle speed, which were PreTool's inputs for the feeds and speeds it wrote
 * into `start-values`. What goes out now is `defaultPreset`, a placeholder of
 * 1s that exists so the library loads at all, and it needs neither answer. The
 * two questions come back with `pretool-presets.ts`, and not before: asking a
 * shop for its spindle ceiling and then writing a 1 would be worse than not
 * asking.
 *
 * **It serves both formats** (2026-09-12). Only four strings differ between a
 * Fusion export and a Mastercam one — the name, the extension, the blurb and
 * what the report is called — so a second copy of this would be a hundred and
 * thirty lines kept in step by hand, and the first thing to fall out of step is
 * whichever of the two nobody used that week. `ExportReport` is shared for the
 * same reason and is why `exported` means the same quantity in both: rows of
 * the order list that reached the file.
 */
export const LibraryExportDialog = ({
  format,
  initialName,
  onCancel,
  onExport,
}: LibraryExportDialogProps) => {
  const [name, setName] = useState(initialName)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<ExportReport | null>(null)
  const canExport = name.trim() !== '' && !working

  useEscape(true, onCancel)

  const submit = async () => {
    if (!canExport) {
      return
    }
    setWorking(true)
    try {
      setResult(await onExport(name.trim()))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Export ${format.name} tool library`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !working) {
          onCancel()
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <Card className="w-full max-w-md overflow-hidden shadow-xl">
        <div className="border-b border-zinc-800 px-4 py-3">
          <p className="text-sm font-semibold text-zinc-100">{format.name} tool library</p>
          <p className="mt-1 text-xs text-zinc-400">{format.blurb}</p>
        </div>
        <div className="space-y-4 p-4">
          <label className="flex flex-col gap-1">
            <span className={SECTION_LABEL}>Library name</span>
            <Input
              id="library-export-name"
              name="library-export-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Library name"
            />
            <span className="text-2xs text-zinc-500">
              {format.name} will use this filename for the library.
            </span>
          </label>
          {result === null ? null : (
            <div
              aria-live="polite"
              className="space-y-2 rounded border border-zinc-800 bg-zinc-900/70 p-3 text-xs"
            >
              <p className="font-semibold text-zinc-200">
                {result.exported === 0
                  ? `No ${format.name} library was downloaded.`
                  : `Downloaded ${result.exported} tool ${result.exported === 1 ? 'assembly' : 'assemblies'}.`}
              </p>
              {result.skipped.map((each) => (
                <p key={`${each.catalogNumber}:${each.reason}`} className="text-warning">
                  {each.catalogNumber} skipped — {each.reason}
                </p>
              ))}
              {result.warnings.map((each) => (
                <p key={`${each.catalogNumber}:${each.reason}`} className="text-zinc-400">
                  {each.catalogNumber} — {each.reason}.
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <Button
            type="button"
            size="md"
            variant="muted"
            onClick={onCancel}
            disabled={working}
            className="min-w-20"
          >
            Close
          </Button>
          <Button
            type="button"
            size="md"
            variant="secondary"
            onClick={submit}
            disabled={!canExport}
            className="min-w-32"
          >
            {working ? 'Preparing…' : `Download ${format.extension}`}
          </Button>
        </div>
      </Card>
    </div>
  )
}

/** The two formats this catalog writes, in the words the dialog shows. */
export const FUSION_FORMAT: LibraryFormat = {
  name: 'Fusion',
  extension: '.json',
  blurb: 'Every assembly on this bill, with its holder. Feeds and speeds are left for Fusion.',
}

export const MASTERCAM_FORMAT: LibraryFormat = {
  name: 'Mastercam',
  extension: '.TOOLDB',
  blurb: 'Every assembly on this bill, with its holder. Feeds and speeds are left for Mastercam.',
}
