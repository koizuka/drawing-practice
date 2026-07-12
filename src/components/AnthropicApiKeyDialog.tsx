import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  TextField,
} from '@mui/material';
import { getAnthropicApiKey, setAnthropicApiKey } from '../utils/anthropic';
import { t } from '../i18n';

interface AnthropicApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a key change (save or clear) so parents can re-check state. */
  onKeyChanged?: () => void;
}

interface AnthropicApiKeyDialogContentProps {
  onClose: () => void;
  onKeyChanged?: () => void;
}

function AnthropicApiKeyDialogBody({ onClose, onKeyChanged }: AnthropicApiKeyDialogContentProps) {
  const [value, setValue] = useState(() => getAnthropicApiKey());

  const handleSave = () => {
    setAnthropicApiKey(value.trim());
    onKeyChanged?.();
    onClose();
  };

  const handleClear = () => {
    setAnthropicApiKey('');
    setValue('');
    onKeyChanged?.();
    onClose();
  };

  return (
    <>
      <DialogTitle>{t('anthropicApiKeyTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('anthropicApiKeyDescription')}
          {' '}
          <Link href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener">
            console.anthropic.com
          </Link>
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          type="password"
          label={t('pexelsApiKeyInput')}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClear} color="warning">{t('pexelsApiKeyClear')}</Button>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={value.trim() === ''}>
          {t('pexelsApiKeySave')}
        </Button>
      </DialogActions>
    </>
  );
}

export function AnthropicApiKeyDialog({ open, onClose, onKeyChanged }: AnthropicApiKeyDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <AnthropicApiKeyDialogBody onClose={onClose} onKeyChanged={onKeyChanged} />}
    </Dialog>
  );
}
