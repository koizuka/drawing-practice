import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  TextField,
} from '@mui/material'
import { getPexelsApiKey, setPexelsApiKey } from '../utils/pexels'
import { t } from '../i18n'

interface PexelsApiKeyDialogProps {
  open: boolean
  onClose: () => void
  /** Called after a key change (save or clear) so parents can re-check state. */
  onKeyChanged?: () => void
}

interface PexelsApiKeyDialogContentProps {
  onClose: () => void
  onKeyChanged?: () => void
}

function PexelsApiKeyDialogBody({ onClose, onKeyChanged }: PexelsApiKeyDialogContentProps) {
  const [value, setValue] = useState(() => getPexelsApiKey())

  const handleSave = () => {
    setPexelsApiKey(value.trim())
    onKeyChanged?.()
    onClose()
  }

  const handleClear = () => {
    setPexelsApiKey('')
    setValue('')
    onKeyChanged?.()
    onClose()
  }

  return (
    <>
      <DialogTitle>{t('pexelsApiKeyTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t('pexelsApiKeyDescription')}{' '}
          <Link href="https://www.pexels.com/api/" target="_blank" rel="noreferrer noopener">
            pexels.com/api
          </Link>
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          type="password"
          label={t('pexelsApiKeyInput')}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
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
  )
}

export function PexelsApiKeyDialog({ open, onClose, onKeyChanged }: PexelsApiKeyDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <PexelsApiKeyDialogBody onClose={onClose} onKeyChanged={onKeyChanged} />}
    </Dialog>
  )
}
