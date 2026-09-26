import { GuideManager, findMaskAt, resolveMaskGesture } from './GuideManager';
import type { GuideLine, GuideState } from './types';
import { DEFAULT_PERSPECTIVE } from './types';

/** Simulates the legacy persisted format before GridMode migration */
interface LegacyGuideState {
  grid: { enabled: boolean; spacing: number };
  lines: GuideLine[];
}

describe('GuideManager', () => {
  let manager: GuideManager;

  beforeEach(() => {
    manager = new GuideManager();
  });

  describe('grid', () => {
    it('starts with grid mode none', () => {
      expect(manager.getGrid().mode).toBe('none');
    });

    it('sets grid mode', () => {
      manager.setGridMode('normal');
      expect(manager.getGrid().mode).toBe('normal');
      manager.setGridMode('large');
      expect(manager.getGrid().mode).toBe('large');
      manager.setGridMode('none');
      expect(manager.getGrid().mode).toBe('none');
    });

    it('fills default perspective settings when entering perspective mode', () => {
      manager.setGridMode('perspective');
      expect(manager.getGrid().mode).toBe('perspective');
      expect(manager.getGrid().perspective).toEqual(DEFAULT_PERSPECTIVE);
    });

    it('keeps perspective settings across mode switches', () => {
      manager.setGridMode('perspective');
      manager.setPerspective({ yaw: 30, strength: 0.8 });
      manager.setGridMode('normal');
      manager.setGridMode('perspective');
      expect(manager.getGrid().perspective).toMatchObject({ yaw: 30, strength: 0.8 });
    });

    it('keeps perspective memories across mode switches', () => {
      manager.setGridMode('perspective');
      manager.setPerspective({ yaw: 30 });
      manager.recordPerspectiveMemory();
      manager.setGridMode('normal');
      manager.setGridMode('perspective');
      expect(manager.getGrid().perspectiveMemories).toMatchObject([
        { seq: 1, settings: { yaw: 30 } },
      ]);
      // Labels stay consistent after the round-trip: the next memory takes
      // the next free number, not label 1 again.
      manager.setPerspective({ yaw: 60 });
      manager.recordPerspectiveMemory();
      expect(manager.getGrid().perspectiveMemories![1].seq).toBe(2);
    });
  });

  describe('recordPerspectiveMemory', () => {
    beforeEach(() => {
      manager.setGridMode('perspective');
    });

    it('appends snapshots oldest first with sequential labels', () => {
      manager.setPerspective({ yaw: 10 });
      expect(manager.recordPerspectiveMemory()).toBe(true);
      manager.setPerspective({ yaw: 20 });
      expect(manager.recordPerspectiveMemory()).toBe(true);
      expect(manager.getGrid().perspectiveMemories).toMatchObject([
        { seq: 1, settings: { yaw: 10 } },
        { seq: 2, settings: { yaw: 20 } },
      ]);
    });

    it('skips a snapshot identical to an existing memory', () => {
      manager.setPerspective({ yaw: 10 });
      manager.recordPerspectiveMemory();
      manager.setPerspective({ yaw: 20 });
      manager.recordPerspectiveMemory();
      // Recalling memory 1 and drawing again must not duplicate it.
      manager.setPerspective({ yaw: 10 });
      expect(manager.recordPerspectiveMemory()).toBe(false);
      expect(manager.getGrid().perspectiveMemories).toHaveLength(2);
    });

    it('evicts the oldest memory at the cap, reusing its freed label for the new entry', () => {
      for (let i = 0; i < 10; i++) {
        manager.setPerspective({ yaw: i * 5 });
        manager.recordPerspectiveMemory();
      }
      const memories = manager.getGrid().perspectiveMemories!;
      expect(memories).toHaveLength(9);
      // #1 (oldest) evicted; survivors keep #2..#9 and the newest entry
      // takes the freed #1 — labels never exceed one digit.
      expect(memories[0]).toMatchObject({ seq: 2, settings: { yaw: 5 } });
      expect(memories[8]).toMatchObject({ seq: 1, settings: { yaw: 45 } });
    });

    it('snapshots by value, not by reference to the live settings', () => {
      manager.setPerspective({ yaw: 10 });
      manager.recordPerspectiveMemory();
      manager.setPerspective({ yaw: 55 });
      expect(manager.getGrid().perspectiveMemories![0].settings.yaw).toBe(10);
    });
  });

  describe('removePerspectiveMemory', () => {
    beforeEach(() => {
      manager.setGridMode('perspective');
      for (const yaw of [10, 20, 30]) {
        manager.setPerspective({ yaw });
        manager.recordPerspectiveMemory();
      }
    });

    it('removes the targeted memory and keeps the other labels', () => {
      expect(manager.removePerspectiveMemory(2)).toBe(true);
      expect(manager.getGrid().perspectiveMemories).toMatchObject([{ seq: 1 }, { seq: 3 }]);
    });

    it('returns false for an unknown label', () => {
      expect(manager.removePerspectiveMemory(99)).toBe(false);
      expect(manager.getGrid().perspectiveMemories).toHaveLength(3);
    });

    it('reuses the smallest freed label for the next memory, appended last', () => {
      manager.removePerspectiveMemory(2);
      manager.setPerspective({ yaw: 40 });
      manager.recordPerspectiveMemory();
      // 1 2 3 → delete 2 → 1 3 → record → 1 3 2 (freed label, appended at the end).
      expect(manager.getGrid().perspectiveMemories).toMatchObject([
        { seq: 1 },
        { seq: 3 },
        { seq: 2, settings: { yaw: 40 } },
      ]);
    });
  });

  describe('setPerspective', () => {
    it('merges a partial patch over defaults', () => {
      manager.setGridMode('perspective');
      manager.setPerspective({ pitch: 45 });
      expect(manager.getGrid().perspective).toEqual({ ...DEFAULT_PERSPECTIVE, pitch: 45 });
    });

    it('clamps out-of-range values', () => {
      manager.setGridMode('perspective');
      manager.setPerspective({ yaw: 400, pitch: -400, strength: 3 });
      expect(manager.getGrid().perspective).toMatchObject({ yaw: 90, pitch: -90, strength: 1 });
    });

    it('falls back to defaults for non-finite values', () => {
      manager.setGridMode('perspective');
      manager.setPerspective({ yaw: 10 });
      manager.setPerspective({ yaw: Number.NaN, centerX: Number.POSITIVE_INFINITY });
      expect(manager.getGrid().perspective).toMatchObject({
        yaw: DEFAULT_PERSPECTIVE.yaw,
        centerX: DEFAULT_PERSPECTIVE.centerX,
      });
    });
  });

  describe('guide lines', () => {
    it('adds a line', () => {
      const line = manager.addLine(0, 0, 100, 100);
      expect(line.id).toBeTruthy();
      expect(manager.getLines()).toHaveLength(1);
    });

    it('removes a line by id', () => {
      const line = manager.addLine(0, 0, 100, 100);
      expect(manager.removeLine(line.id)).toBe(true);
      expect(manager.getLines()).toHaveLength(0);
    });

    it('returns false for non-existent id', () => {
      expect(manager.removeLine('nonexistent')).toBe(false);
    });

    it('clears all lines', () => {
      manager.addLine(0, 0, 100, 100);
      manager.addLine(50, 50, 200, 200);
      manager.clearLines();
      expect(manager.getLines()).toHaveLength(0);
    });
  });

  describe('importState', () => {
    it('restores grid and lines from state', () => {
      const state = {
        grid: { mode: 'normal' as const },
        lines: [
          { id: 'guide-100', x1: 0, y1: 0, x2: 100, y2: 100 },
          { id: 'guide-101', x1: 50, y1: 50, x2: 200, y2: 200 },
        ],
      };

      manager.importState(state);

      expect(manager.getGrid().mode).toBe('normal');
      expect(manager.getLines()).toHaveLength(2);
      expect(manager.getLines()[0].id).toBe('guide-100');
    });

    it('migrates legacy enabled/spacing format', () => {
      const legacyState: LegacyGuideState = {
        grid: { enabled: true, spacing: 50 },
        lines: [{ id: 'guide-100', x1: 0, y1: 0, x2: 100, y2: 100 }],
      };

      manager.importState(legacyState as unknown as GuideState);

      expect(manager.getGrid().mode).toBe('normal');
      expect(manager.getLines()).toHaveLength(1);
    });

    it('migrates legacy disabled format', () => {
      const legacyState: LegacyGuideState = {
        grid: { enabled: false, spacing: 100 },
        lines: [],
      };

      manager.importState(legacyState as unknown as GuideState);

      expect(manager.getGrid().mode).toBe('none');
    });

    it('fills default perspective settings when a stored perspective draft lacks them', () => {
      manager.importState({
        grid: { mode: 'perspective' },
        lines: [],
      });
      expect(manager.getGrid().perspective).toEqual(DEFAULT_PERSPECTIVE);
    });

    it('sanitizes and caps stored perspective memories', () => {
      const memories = Array.from({ length: 12 }, (_, i) => ({
        seq: i + 1,
        settings: { yaw: i * 5, pitch: 0, strength: 0.5, centerX: 0, centerY: 0 },
      }));
      memories[1] = {
        seq: 30,
        settings: { yaw: 400, pitch: Number.NaN, strength: 0.5, centerX: 0, centerY: 0 },
      };
      manager.importState({
        grid: { mode: 'perspective', perspectiveMemories: memories },
        lines: [],
      } as unknown as GuideState);
      const imported = manager.getGrid().perspectiveMemories!;
      expect(imported).toHaveLength(9);
      // Out-of-range label 30 falls back to the smallest free number; the
      // invalid setting values are clamped/defaulted.
      expect(imported[1]).toMatchObject({ seq: 2, settings: { yaw: 90, pitch: 0 } });
    });

    it('adopts legacy memory entries (bare settings) with positional labels', () => {
      manager.importState({
        grid: {
          mode: 'perspective',
          perspectiveMemories: [
            { yaw: 10, pitch: 0, strength: 0.5, centerX: 0, centerY: 0 },
            { yaw: 20, pitch: 0, strength: 0.5, centerX: 0, centerY: 0 },
          ],
        },
        lines: [],
      } as unknown as GuideState);
      expect(manager.getGrid().perspectiveMemories).toMatchObject([
        { seq: 1, settings: { yaw: 10 } },
        { seq: 2, settings: { yaw: 20 } },
      ]);
    });

    it('falls back to default grid for an unknown mode value', () => {
      manager.importState({
        grid: { mode: 'diagonal' },
        lines: [],
      } as unknown as GuideState);
      expect(manager.getGrid().mode).toBe('none');
    });

    it('avoids id collisions after import', () => {
      manager.importState({
        grid: { mode: 'none' },
        lines: [{ id: 'guide-50', x1: 0, y1: 0, x2: 100, y2: 100 }],
      });

      const newLine = manager.addLine(0, 0, 50, 50);
      // New line id should be > 50 to avoid collision
      const idNum = parseInt(newLine.id.replace('guide-', ''), 10);
      expect(idNum).toBeGreaterThan(50);
    });

    it('creates independent copy of input state', () => {
      const state = {
        grid: { mode: 'normal' as const },
        lines: [{ id: 'guide-1', x1: 0, y1: 0, x2: 100, y2: 100 }],
      };

      manager.importState(state);
      state.lines.push({ id: 'guide-2', x1: 10, y1: 10, x2: 200, y2: 200 });

      expect(manager.getLines()).toHaveLength(1);
    });
  });

  describe('findNearestLine', () => {
    it('finds nearest line within threshold', () => {
      const line = manager.addLine(0, 0, 100, 0);
      const found = manager.findNearestLine(50, 5, 10);
      expect(found?.id).toBe(line.id);
    });

    it('returns null when no line is near', () => {
      manager.addLine(0, 0, 100, 0);
      const found = manager.findNearestLine(50, 50, 10);
      expect(found).toBeNull();
    });

    it('finds the closest of multiple lines', () => {
      manager.addLine(0, 0, 100, 0); // y=0
      const closer = manager.addLine(0, 10, 100, 10); // y=10
      const found = manager.findNearestLine(50, 12, 20);
      expect(found?.id).toBe(closer.id);
    });
  });

  describe('masks', () => {
    it('starts empty and hidden', () => {
      expect(manager.getMasks()).toEqual([]);
      expect(manager.getMasksHidden()).toBe(true);
    });

    it('adds a mask normalizing corners from a negative drag', () => {
      const mask = manager.addMask(100, 80, 20, 30);
      expect(mask).toMatchObject({ x: 20, y: 30, w: 80, h: 50 });
      expect(mask.id).toMatch(/^mask-\d+$/);
      expect(manager.getMasks()).toEqual([mask]);
    });

    it('removes a mask by id', () => {
      const a = manager.addMask(0, 0, 10, 10);
      const b = manager.addMask(20, 20, 30, 30);
      expect(manager.removeMask(a.id)).toBe(true);
      expect(manager.getMasks()).toEqual([b]);
      expect(manager.removeMask('mask-nope')).toBe(false);
    });

    it('clears all masks', () => {
      manager.addMask(0, 0, 10, 10);
      manager.addMask(20, 20, 30, 30);
      manager.clearMasks();
      expect(manager.getMasks()).toEqual([]);
    });

    it('toggles masksHidden', () => {
      manager.setMasksHidden(false);
      expect(manager.getMasksHidden()).toBe(false);
      manager.setMasksHidden(true);
      expect(manager.getMasksHidden()).toBe(true);
    });

    it('findMaskAt picks the last-added mask on overlap', () => {
      manager.addMask(0, 0, 100, 100);
      const top = manager.addMask(50, 50, 150, 150);
      expect(manager.findMaskAt(75, 75)?.id).toBe(top.id);
      expect(manager.findMaskAt(10, 10)?.id).not.toBe(top.id);
      expect(manager.findMaskAt(10, 10)).not.toBeNull();
      expect(manager.findMaskAt(200, 200)).toBeNull();
    });

    it('importState tolerates missing masks and defaults masksHidden to true', () => {
      manager.addMask(0, 0, 10, 10);
      manager.setMasksHidden(false);
      manager.importState({ grid: { mode: 'none' }, lines: [] });
      expect(manager.getMasks()).toEqual([]);
      expect(manager.getMasksHidden()).toBe(true);
    });

    it('importState drops malformed entries and normalizes negative w/h', () => {
      const state = {
        grid: { mode: 'none' },
        lines: [],
        masks: [
          { id: 'mask-1', x: 10, y: 20, w: 30, h: 40 },
          { id: 'mask-2', x: 100, y: 100, w: -20, h: -10 },
          { id: 'mask-3', x: NaN, y: 0, w: 10, h: 10 },
          { id: 'mask-4', x: 0, y: 0, w: Infinity, h: 10 },
          { id: 'mask-5', x: 0, y: 0, w: '10', h: 10 },
          { x: 0, y: 0, w: 10, h: 10 },
          null,
          'garbage',
        ],
        masksHidden: false,
      } as unknown as GuideState;
      manager.importState(state);
      expect(manager.getMasks()).toEqual([
        { id: 'mask-1', x: 10, y: 20, w: 30, h: 40 },
        { id: 'mask-2', x: 80, y: 90, w: 20, h: 10 },
      ]);
      expect(manager.getMasksHidden()).toBe(false);
    });

    it('importState treats a non-array masks field as empty', () => {
      manager.importState({
        grid: { mode: 'none' },
        lines: [],
        masks: 'nope',
      } as unknown as GuideState);
      expect(manager.getMasks()).toEqual([]);
    });

    it('does not reuse imported mask ids for new masks', () => {
      manager.importState({
        grid: { mode: 'none' },
        lines: [],
        masks: [{ id: 'mask-9000', x: 0, y: 0, w: 1, h: 1 }],
      });
      const added = manager.addMask(0, 0, 5, 5);
      expect(added.id).not.toBe('mask-9000');
      expect(parseInt(added.id.slice('mask-'.length), 10)).toBeGreaterThan(9000);
    });
  });

  describe('resolveMaskGesture', () => {
    const masks = [{ id: 'mask-1', x: 0, y: 0, w: 100, h: 100 }];

    it('adds when the drag exceeds the threshold in both dimensions', () => {
      expect(resolveMaskGesture({ x: 0, y: 0 }, { x: 20, y: 20 }, 5, masks)).toEqual({
        kind: 'add',
      });
    });

    it('removes the mask under a tap', () => {
      expect(resolveMaskGesture({ x: 50, y: 50 }, { x: 51, y: 50 }, 5, masks)).toEqual({
        kind: 'remove',
        id: 'mask-1',
      });
    });

    it('does nothing for a tap on empty space or a thin sliver drag', () => {
      expect(resolveMaskGesture({ x: 500, y: 500 }, { x: 501, y: 500 }, 5, masks)).toBeNull();
      expect(resolveMaskGesture({ x: 50, y: 50 }, { x: 90, y: 51 }, 5, masks)).toBeNull();
    });

    it('findMaskAt treats edges as inside', () => {
      expect(findMaskAt(masks, 100, 100)?.id).toBe('mask-1');
      expect(findMaskAt(masks, 100.1, 50)).toBeNull();
    });
  });
});
