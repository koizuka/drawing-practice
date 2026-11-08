import type { ReactNode } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { Boxes, Camera, FolderOpen, KeyRound, PersonStanding, Spline } from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { GitHubIcon } from './GitHubIcon';
import { t } from '../i18n';

/** Source / navigation tier button (see ui-design-principles §2). */
function SourceButton({
  icon,
  title,
  description,
  onClick,
  settings,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  /** Optional square settings button (API key) to the right of the source button. */
  settings?: { title: string; onClick: () => void };
}) {
  const button = (
    <Button
      variant="outlined"
      fullWidth
      onClick={onClick}
      startIcon={icon}
      sx={{ justifyContent: 'flex-start', py: 1, px: 2 }}
    >
      <Box sx={{ textAlign: 'left' }}>
        <Typography variant="body1" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
          {title}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'none', sm: 'block' } }}
        >
          {description}
        </Typography>
      </Box>
    </Button>
  );
  if (!settings) return button;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
      {button}
      <ToolbarTooltip title={settings.title}>
        <IconButton
          aria-label={settings.title}
          onClick={settings.onClick}
          sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5 }}
        >
          <KeyRound size={18} />
        </IconButton>
      </ToolbarTooltip>
    </Box>
  );
}

interface SourcePickerProps {
  onOpenSketchfab: () => void;
  onOpenPexels: () => void;
  onOpenPexelsKeySettings: () => void;
  onLoadLocalImage: () => void;
  onOpenTraceTemplate: () => void;
  onOpenPose: () => void;
  onOpenAnthropicKeySettings: () => void;
  /** The URL input row (rendered under the "URL" label). */
  urlInput: ReactNode;
  urlLoading: boolean;
  urlError: string | null;
}

/** The reference-empty screen: source buttons, URL input, build info. */
export function SourcePicker({
  onOpenSketchfab,
  onOpenPexels,
  onOpenPexelsKeySettings,
  onLoadLocalImage,
  onOpenTraceTemplate,
  onOpenPose,
  onOpenAnthropicKeySettings,
  urlInput,
  urlLoading,
  urlError,
}: SourcePickerProps) {
  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          gap: 1.5,
          px: 2,
          py: 2,
        }}
      >
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%', maxWidth: 480 }}
        >
          <SourceButton
            icon={<Boxes size={20} />}
            title={t('sketchfab')}
            description={t('sketchfabDescription')}
            onClick={onOpenSketchfab}
          />
          <SourceButton
            icon={<Camera size={20} />}
            title={t('pexels')}
            description={t('pexelsDescription')}
            onClick={onOpenPexels}
            settings={{ title: t('pexelsApiKeySettings'), onClick: onOpenPexelsKeySettings }}
          />
          <Box sx={{ mt: 0.5 }}>
            <SourceButton
              icon={<FolderOpen size={20} />}
              title={t('image')}
              description={t('imageDescription')}
              onClick={onLoadLocalImage}
            />
          </Box>
          <SourceButton
            icon={<Spline size={20} />}
            title={t('traceTemplate')}
            description={t('traceTemplateDescription')}
            onClick={onOpenTraceTemplate}
          />
          <SourceButton
            icon={<PersonStanding size={20} />}
            title={t('pose')}
            description={t('poseDescription')}
            onClick={onOpenPose}
            settings={{ title: t('anthropicApiKeyTitle'), onClick: onOpenAnthropicKeySettings }}
          />
        </Box>
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', maxWidth: 480 }}
        >
          <Typography variant="caption" color="text.secondary">
            {t('urlSectionLabel')}
          </Typography>
          {urlInput}
        </Box>
        {urlLoading && (
          <Typography variant="caption" color="text.secondary">
            {t('loading')}
          </Typography>
        )}
        {urlError && (
          <Typography variant="caption" color="error">
            {urlError}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.disabled">
            {t('buildDate')}:{new Date(import.meta.env.BUILD_DATE as string).toLocaleString()}
          </Typography>
          <a
            href="https://github.com/koizuka/drawing-practice"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', color: '#888' }}
          >
            <GitHubIcon />
          </a>
        </Box>
      </Box>
    </Box>
  );
}
