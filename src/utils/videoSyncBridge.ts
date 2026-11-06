/**
 * Rotoscope glue between the two panels (docs/layers.md "Rotoscope").
 *
 * The YouTube player lives inside ReferencePanel → YouTubeViewer while the
 * animation timeline lives in DrawingPanel; SplitLayout owns one bridge and
 * hands it to both. The viewer attaches its player control while mounted, the
 * drawing side drives it. Every call is a no-op while nothing is attached
 * (another reference, collapsed panel, player still loading), so the drawing
 * side never has to know whether the video is actually on screen.
 */

export interface VideoPlayerControl {
  /** Seek; `play: false` keeps (or puts) the player paused on that moment. */
  seekTo(seconds: number, opts: { play: boolean }): void;
  play(): void;
  pause(): void;
  /** Last time the player reported (s), or null before the first report. */
  getCurrentTime(): number | null;
}

export class VideoSyncBridge {
  private control: VideoPlayerControl | null = null;
  private readyListeners = new Set<() => void>();
  private readyVersion = 0;

  /**
   * The player started answering (first report after load). Commands sent
   * before that are dropped by the iframe, so the drawing side re-applies its
   * seek when this fires (e.g. the initial park after a reload).
   */
  notifyReady(): void {
    this.readyVersion++;
    for (const l of this.readyListeners) l();
  }

  getReadyVersion(): number {
    return this.readyVersion;
  }

  subscribeReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  attach(control: VideoPlayerControl): void {
    this.control = control;
  }

  /** Detach only if `control` is still the attached one (remount ordering). */
  detach(control: VideoPlayerControl): void {
    if (this.control === control) this.control = null;
  }

  isAttached(): boolean {
    return this.control !== null;
  }

  seekTo(seconds: number, opts: { play: boolean }): void {
    this.control?.seekTo(seconds, opts);
  }

  play(): void {
    this.control?.play();
  }

  pause(): void {
    this.control?.pause();
  }

  getCurrentTime(): number | null {
    return this.control?.getCurrentTime() ?? null;
  }
}
