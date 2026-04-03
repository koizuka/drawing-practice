import { render, screen } from '@testing-library/react'
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
    expect(screen.getByLabelText('Pen')).toBeInTheDocument()
    expect(screen.getByLabelText('Eraser')).toBeInTheDocument()
  })
})
