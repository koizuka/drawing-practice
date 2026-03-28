import { render, screen } from '@testing-library/react'
import { SplitLayout } from './SplitLayout'

describe('SplitLayout', () => {
  it('renders both panels', () => {
    render(<SplitLayout />)
    // ReferencePanel renders source buttons
    expect(screen.getByText('Sketchfab')).toBeInTheDocument()
    expect(screen.getByText('Image')).toBeInTheDocument()
    // DrawingPanel renders toolbar buttons
    expect(screen.getByLabelText('Pen')).toBeInTheDocument()
    expect(screen.getByLabelText('Eraser')).toBeInTheDocument()
  })
})
