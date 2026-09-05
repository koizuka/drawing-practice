import { useContext } from 'react';
import { TraceScoringContext, type TraceScoringValue } from './traceScoringValue';

export function useTraceScoring(): TraceScoringValue {
  const ctx = useContext(TraceScoringContext);
  if (!ctx) throw new Error('useTraceScoring must be inside a TraceScoringProvider');
  return ctx;
}
