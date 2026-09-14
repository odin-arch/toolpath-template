import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FUSION_FORMAT, LibraryExportDialog, MASTERCAM_FORMAT } from './library-export-dialog'

describe('LibraryExportDialog', () => {
  it('passes the trimmed library name to export and reports what landed', async () => {
    const onExport = vi.fn().mockResolvedValue({ exported: 1, skipped: [], warnings: [] })
    render(
      <LibraryExportDialog
        format={FUSION_FORMAT}
        initialName="Shop library"
        onCancel={vi.fn()}
        onExport={onExport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Download .json' }))

    await vi.waitFor(() => expect(onExport).toHaveBeenCalledWith('Shop library'))
    expect(await screen.findByText('Downloaded 1 tool assembly.')).toBeInTheDocument()
  })

  it('will not export under an empty name, which the CAM system shows as the library label', () => {
    render(
      <LibraryExportDialog
        format={FUSION_FORMAT}
        initialName="Shop library"
        onCancel={vi.fn()}
        onExport={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Library name'), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Download .json' })).toBeDisabled()
  })

  it('says which tool was left out, and which holder travelled short', async () => {
    const onExport = vi.fn().mockResolvedValue({
      exported: 1,
      skipped: [{ catalogNumber: 'TDMX0800', reason: 'Fusion requires RE and none is stated' }],
      warnings: [{ catalogNumber: 'TDMX0600', reason: 'the vendor publishes no gauge length' }],
    })
    render(
      <LibraryExportDialog
        format={FUSION_FORMAT}
        initialName="Shop library"
        onCancel={vi.fn()}
        onExport={onExport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Download .json' }))

    expect(
      await screen.findByText('TDMX0800 skipped — Fusion requires RE and none is stated'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('TDMX0600 — the vendor publishes no gauge length.'),
    ).toBeInTheDocument()
  })

  /**
   * The whole point of the generalisation: one dialog, and the format decides
   * its four strings. A second copy of this component is what this pins against.
   */
  /**
   * `aria-modal` is a promise about the keyboard, and these are the three
   * halves of keeping it. They are pinned because the markup makes the claim
   * whether or not the behaviour is there, so nothing else would notice it
   * going: a reader would simply be told the page behind is inert while Tab
   * walked onto it.
   */
  describe('the focus it holds while it is open', () => {
    it('puts the caret in the name, so the dialog is usable without a mouse', () => {
      render(
        <LibraryExportDialog
          format={FUSION_FORMAT}
          initialName="Shop library"
          onCancel={vi.fn()}
          onExport={vi.fn()}
        />,
      )

      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Library name' }))
    })

    it('keeps Tab inside itself rather than letting it walk onto the page behind', () => {
      render(
        <LibraryExportDialog
          format={FUSION_FORMAT}
          initialName="Shop library"
          onCancel={vi.fn()}
          onExport={vi.fn()}
        />,
      )

      const download = screen.getByRole('button', { name: 'Download .json' })
      download.focus()
      fireEvent.keyDown(document, { key: 'Tab' })

      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Library name' }))
    })

    it('hands the focus back to whatever opened it', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const view = render(
        <LibraryExportDialog
          format={FUSION_FORMAT}
          initialName="Shop library"
          onCancel={vi.fn()}
          onExport={vi.fn()}
        />,
      )
      expect(document.activeElement).not.toBe(opener)

      view.unmount()

      expect(document.activeElement).toBe(opener)
      opener.remove()
    })
  })

  it('takes its name, its extension and its blurb from the format it is given', async () => {
    const onExport = vi.fn().mockResolvedValue({ exported: 0, skipped: [], warnings: [] })
    render(
      <LibraryExportDialog
        format={MASTERCAM_FORMAT}
        initialName="Shop library"
        onCancel={vi.fn()}
        onExport={onExport}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'Export Mastercam tool library' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Mastercam tool library')).toBeInTheDocument()
    expect(
      screen.getByText('Mastercam will use this filename for the library.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Download .TOOLDB' }))

    expect(await screen.findByText('No Mastercam library was downloaded.')).toBeInTheDocument()
  })
})
