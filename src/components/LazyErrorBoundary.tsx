import { Component, type ReactNode } from 'react';
import { Alert, Button } from '@mui/material';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Catches errors thrown by React.lazy() chunk loads so a transient network
// failure or a stale tab referencing chunks that were removed by a redeploy
// doesn't crash the entire surrounding panel. Offers a one-click reload.
export class LazyErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert
          severity="error"
          action={(
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              {t('reload')}
            </Button>
          )}
          sx={{ m: 2 }}
        >
          {t('lazyChunkLoadFailed')}
        </Alert>
      );
    }
    return this.props.children;
  }
}
