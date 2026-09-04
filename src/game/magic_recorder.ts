import type { Game } from './game';

export type MagicRecorderStatus = 'idle' | 'recording' | 'processing' | 'ready' | 'unsupported' | 'error';

export interface MagicMomentMark {
  at: number;
  type: 'ai_knocked_human' | 'human_knocked_ai' | 'hard_collision' | 'ai_fall';
  detail?: string;
}

export interface MagicCandidate {
  status: MagicRecorderStatus;
  id?: string;
  raceId?: string;
  duration?: number;
  reason?: string;
  previewUrl?: string;
  cardUrl?: string;
  expiresAt?: string;
  moments?: MagicMomentMark[];
  error?: string;
}

/** Records the low-resolution game canvas, not the DOM or the player's screen. */
export class MagicMomentRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private raceId = '';
  private finishing: Promise<MagicCandidate> | null = null;
  private lastOpponentBumpAt = -Infinity;
  private lastCollisionMarkAt = -Infinity;
  private opponentKnockoffs = 0;
  private moments: MagicMomentMark[] = [];
  candidate: MagicCandidate = { status: 'idle' };

  constructor(private game: Game, private canvas: HTMLCanvasElement) {}

  start(raceId: string): MagicCandidate {
    if (!this.game.isAgentPage || this.game.mode !== 'ai' || !raceId) return this.candidate;
    if (this.recorder?.state === 'recording' && this.raceId === raceId) return this.candidate;
    if (!('MediaRecorder' in window) || typeof this.canvas.captureStream !== 'function') {
      this.candidate = { status: 'unsupported', raceId, error: 'canvas recording is unavailable in this browser' };
      return this.candidate;
    }
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.raceId = raceId;
    this.chunks = [];
    this.startedAt = performance.now();
    this.lastOpponentBumpAt = -Infinity;
    this.lastCollisionMarkAt = -Infinity;
    this.opponentKnockoffs = 0;
    this.moments = [];
    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    try {
      this.stream = this.canvas.captureStream(15);
      this.recorder = new MediaRecorder(this.stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 240_000 });
      this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.start(1000);
      this.candidate = { status: 'recording', raceId };
    } catch (error) {
      this.closeStream();
      this.candidate = { status: 'error', raceId, error: error instanceof Error ? error.message : String(error) };
    }
    return this.candidate;
  }

  noteOpponentBump(): void { this.lastOpponentBumpAt = performance.now(); }

  noteLocalDeath(): void {
    if (performance.now() - this.lastOpponentBumpAt < 1800) {
      this.opponentKnockoffs++;
      this.mark('human_knocked_ai');
    } else {
      this.mark('ai_fall');
    }
  }

  noteRemoteKnockoff(): void { this.mark('ai_knocked_human'); }

  noteHardCollision(impulse: number): void {
    const now = performance.now();
    if (now - this.lastCollisionMarkAt < 400) return;
    this.lastCollisionMarkAt = now;
    this.mark('hard_collision', `impact ${impulse.toFixed(1)}`);
  }

  private mark(type: MagicMomentMark['type'], detail?: string): void {
    if (!this.startedAt || this.moments.length >= 64) return;
    const at = Math.round(Math.max(0, (performance.now() - this.startedAt) / 1000) * 1000) / 1000;
    this.moments.push({ at, type, ...(detail ? { detail } : {}) });
  }

  private reason(): string {
    const remoteDeaths = Math.max(0, ...[...this.game.remoteInfo.values()].map((p) => Number(p.deaths) || 0));
    if (this.game.aiDestroyed > 0) return `AI knocked the human off ${this.game.aiDestroyed} time${this.game.aiDestroyed === 1 ? '' : 's'}`;
    if (this.opponentKnockoffs > 0) return `Human knocked the AI off ${this.opponentKnockoffs} time${this.opponentKnockoffs === 1 ? '' : 's'}`;
    if (this.game.aiDizzied >= 3) return `Marble-on-marble griefing: ${this.game.aiDizzied} hard collisions`;
    if (this.game.deaths + remoteDeaths >= 4) return `Both racers struggled: ${this.game.deaths + remoteDeaths} combined falls`;
    return `Complete Humans vs Agents race; review for a close call, comeback, or funny failure`;
  }

  async finish(endReason = 'race_end'): Promise<MagicCandidate> {
    if (this.finishing) return this.finishing;
    if (!this.recorder || this.recorder.state === 'inactive') return this.candidate;
    const recorder = this.recorder;
    const raceId = this.raceId;
    const duration = Math.max(0, (performance.now() - this.startedAt) / 1000);
    this.candidate = { status: 'processing', raceId, duration, moments: [...this.moments] };
    this.finishing = new Promise<MagicCandidate>((resolve) => {
      recorder.addEventListener('stop', async () => {
        try {
          const blob = new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' });
          if (blob.size < 64) throw new Error('race capture was empty');
          const reason = `${this.reason()} (${endReason})`;
          const query = new URLSearchParams({ race: raceId, duration: duration.toFixed(3), reason });
          const response = await fetch(`/api/shares/candidate?${query}`, {
            method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: blob,
          });
          const out = await response.json() as Record<string, unknown>;
          if (!response.ok) throw new Error(String(out.error || `upload failed ${response.status}`));
          this.candidate = {
            status: 'ready', id: String(out.id), raceId, duration,
            reason, previewUrl: String(out.previewUrl), cardUrl: String(out.cardUrl), expiresAt: String(out.expiresAt || ''),
            moments: [...this.moments],
          };
          this.game.webmcp.emit('share_candidate', {
            ...this.candidate,
            question: 'Is this race worth clipping? Use moments as timestamp hints, open previewUrl before expiresAt, then call share with worthSharing, the best start/end seconds, and where it should go.',
          });
        } catch (error) {
          this.candidate = { status: 'error', raceId, duration, error: error instanceof Error ? error.message : String(error) };
        } finally {
          this.closeStream();
          this.recorder = null;
          this.chunks = [];
          this.finishing = null;
          resolve(this.candidate);
        }
      }, { once: true });
      recorder.stop();
    });
    return this.finishing;
  }

  review(): MagicCandidate & { instruction?: string } {
    return {
      ...this.candidate,
      instruction: this.candidate.status === 'ready'
        ? 'Use moments as timestamp hints and open previewUrl before expiresAt. If it has a magic moment, call share with worthSharing=true plus a 0.5-8 second clip window and destination. Otherwise decline it.'
        : undefined,
    };
  }

  async share(args: Record<string, unknown>): Promise<unknown> {
    if (this.candidate.status !== 'ready' || !this.candidate.id) return { ok: false, ...this.review() };
    const worthSharing = args.worthSharing === true;
    const start = Number(args.start);
    const end = Number(args.end);
    const where = String(args.where || '').trim();
    if (worthSharing && (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.5 || end - start > 8 || !where)) {
      return {
        ok: false,
        error: 'A shareable moment requires an exact 0.5-8 second start/end window and destination.',
        moments: this.candidate.moments || [],
        instruction: 'Inspect previewUrl around the timestamp hints, then retry with worthSharing=true, start, end, and where.',
      };
    }
    const response = await fetch(`/api/shares/${this.candidate.id}/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worthSharing,
        start: worthSharing ? start : 0,
        end: worthSharing ? end : 0.5,
        where: worthSharing ? where : 'declined',
        caption: String(args.caption || ''),
      }),
    });
    let out: Record<string, unknown>;
    try { out = await response.json() as Record<string, unknown>; }
    catch { out = { error: `share service returned ${response.status}` }; }
    if (!response.ok) return { ok: false, ...out };
    return { ...out, candidate: this.candidate, instruction: worthSharing ? 'Open cardUrl to inspect the centered GIF card. External posting still requires an explicit user action.' : 'Candidate declined and remains private.' };
  }

  private closeStream(): void {
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
  }
}
