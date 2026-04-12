import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { SplitLayout } from './SplitLayout'

vi.mock('../storage/sessionStore', () => ({
  saveDraft: vi.fn().mockResolvedValue(undefined),
  loadDraft: vi.fn().mockResolvedValue(undefined),
  clearDraft: vi.fn().mockResolvedValue(undefined),
}))

describe('SplitLayout', () => {
  it('renders both panels', () => {
    render(<SplitLayout />)
    // ReferencePanel renders source buttons in center when no source selected
    expect(screen.getByText('Sketchfab')).toBeInTheDocument()
    expect(screen.getByText('Image File')).toBeInTheDocument()
    // DrawingPanel renders toolbar buttons
    expect(screen.getByLabelText(/^Pen/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Eraser/)).toBeInTheDocument()
  })

  describe('reference undo integration', () => {
    /**
     * Helper: find the Undo/Redo buttons in the DrawingPanel toolbar. They are
     * wrapped in <span> for disabled Tooltip support, which breaks the normal
     * label inheritance, so we look up the SVG icon by its lucide class name
     * and return the nearest button ancestor.
     */
    function findDrawingToolbarButton(container: HTMLElement, iconClass: string): HTMLButtonElement {
      const icon = container.querySelector(`svg.${iconClass}`)
      if (!icon) throw new Error(`icon ${iconClass} not found`)
      const button = icon.closest('button')
      if (!button) throw new Error(`no button wraps ${iconClass}`)
      return button as HTMLButtonElement
    }

    const undoBtn = (c: HTMLElement) => findDrawingToolbarButton(c, 'lucide-undo-2')
    const redoBtn = (c: HTMLElement) => findDrawingToolbarButton(c, 'lucide-redo-2')

    it('enables undo after opening Sketchfab and reverts to none on undo', () => {
      const { container } = render(<SplitLayout />)

      // Initial state: source selection visible, undo disabled
      expect(screen.getByText('Image File')).toBeInTheDocument()
      expect(undoBtn(container)).toBeDisabled()

      // Click the center "Sketchfab" button
      fireEvent.click(screen.getByText('Sketchfab'))

      // Selection buttons are gone (Sketchfab browse UI replaces them)
      expect(screen.queryByText('Image File')).not.toBeInTheDocument()
      // Undo is now enabled because a reference change was recorded
      expect(undoBtn(container)).not.toBeDisabled()

      // Click undo → back to none state
      fireEvent.click(undoBtn(container))

      expect(screen.getByText('Image File')).toBeInTheDocument()
      expect(undoBtn(container)).toBeDisabled()
      // Redo should now be enabled
      expect(redoBtn(container)).not.toBeDisabled()
    })

    it('restores the previous reference when Close is undone', () => {
      const { container } = render(<SplitLayout />)

      // Open Sketchfab
      fireEvent.click(screen.getByText('Sketchfab'))
      expect(screen.queryByText('Image File')).not.toBeInTheDocument()

      // Click the Close button (X icon in reference toolbar)
      const closeIcon = container.querySelector('svg.lucide-x')
      if (!closeIcon) throw new Error('close icon not found')
      const closeButton = closeIcon.closest('button')!
      fireEvent.click(closeButton)

      // Back to none state
      expect(screen.getByText('Image File')).toBeInTheDocument()

      // Undo → should return to Sketchfab browse mode
      fireEvent.click(undoBtn(container))
      expect(screen.queryByText('Image File')).not.toBeInTheDocument()

      // Another undo → back to initial none
      fireEvent.click(undoBtn(container))
      expect(screen.getByText('Image File')).toBeInTheDocument()
      expect(undoBtn(container)).toBeDisabled()
    })

    it('redo re-applies reference changes', () => {
      const { container } = render(<SplitLayout />)

      // Sketchfab → none → sketchfab chain via undo/redo
      fireEvent.click(screen.getByText('Sketchfab'))
      fireEvent.click(undoBtn(container))
      expect(screen.getByText('Image File')).toBeInTheDocument()
      expect(redoBtn(container)).not.toBeDisabled()

      // Redo re-applies
      fireEvent.click(redoBtn(container))
      expect(screen.queryByText('Image File')).not.toBeInTheDocument()
      expect(redoBtn(container)).toBeDisabled()
    })

    it('a new reference change clears the redo stack', () => {
      const { container } = render(<SplitLayout />)

      // Sketchfab → undo → Sketchfab again
      fireEvent.click(screen.getByText('Sketchfab'))
      fireEvent.click(undoBtn(container))
      expect(redoBtn(container)).not.toBeDisabled()

      // Click Sketchfab again — this records a new ref change, clearing redo
      fireEvent.click(screen.getByText('Sketchfab'))
      expect(redoBtn(container)).toBeDisabled()
    })
  })
})
