import { useEffect, useRef } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { BUNDLED_TEMPLATES } from '../templates/bundled';
import type { TraceTemplate } from '../templates/types';
import { t } from '../i18n';

interface BundledTemplatePickerProps {
  onSelect: (template: TraceTemplate) => void;
}

const THUMB_SIZE = 140;
const THUMB_PADDING = 8;

function TemplateThumbnail({ template }: { template: TraceTemplate }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = THUMB_SIZE * dpr;
    canvas.height = THUMB_SIZE * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);

    const inner = THUMB_SIZE - THUMB_PADDING * 2;
    const scale = Math.min(inner / template.viewBox.w, inner / template.viewBox.h);
    ctx.save();
    ctx.translate(THUMB_SIZE / 2, THUMB_SIZE / 2);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(60, 60, 80, 0.85)';
    ctx.lineWidth = 1.5 / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of template.strokes) {
      if (s.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }, [template]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: THUMB_SIZE, height: THUMB_SIZE, display: 'block' }}
    />
  );
}

export function BundledTemplatePicker({ onSelect }: BundledTemplatePickerProps) {
  return (
    <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
        {t('selectTraceTemplate')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 1,
        }}
      >
        {BUNDLED_TEMPLATES.map(tmpl => (
          // ButtonBase (instead of a plain Box) so the card is reachable via
          // Tab and activatable via Enter/Space — MUI handles the keyboard
          // semantics and adds the proper role/aria-pressed treatment.
          <ButtonBase
            key={tmpl.id}
            onClick={() => onSelect(tmpl)}
            focusRipple
            aria-label={t(tmpl.titleKey)}
            sx={{
              'border': '1px solid #ddd',
              'borderRadius': 1,
              'overflow': 'hidden',
              'bgcolor': '#fff',
              '&:hover': { borderColor: 'primary.main' },
              '&:focus-visible': { borderColor: 'primary.main', outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              'display': 'flex',
              'flexDirection': 'column',
              'alignItems': 'center',
              'p': 1,
              'textAlign': 'center',
            }}
          >
            <TemplateThumbnail template={tmpl} />
            <Typography variant="caption" sx={{ mt: 0.5 }}>
              {t(tmpl.titleKey)}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
