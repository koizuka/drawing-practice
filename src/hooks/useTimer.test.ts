import { formatTime } from './useTimer'

describe('formatTime', () => {
  it('formats 0ms', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds', () => {
    expect(formatTime(5000)).toBe('0:05')
    expect(formatTime(59000)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(60000)).toBe('1:00')
    expect(formatTime(90000)).toBe('1:30')
    expect(formatTime(3661000)).toBe('61:01')
  })

  it('truncates milliseconds', () => {
    expect(formatTime(1500)).toBe('0:01')
    expect(formatTime(999)).toBe('0:00')
  })
})
