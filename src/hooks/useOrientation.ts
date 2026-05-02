import { useState, useEffect } from 'react';

export type Orientation = 'landscape' | 'portrait';

function getOrientation(): Orientation {
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(getOrientation);

  useEffect(() => {
    const handleResize = () => {
      setOrientation(getOrientation());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return orientation;
}
