import { useContext } from 'react';
import { GuideContext, type GuideContextValue } from './GuideContext';

export function useGuides(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error('useGuides must be used within GuideProvider');
  return ctx;
}
