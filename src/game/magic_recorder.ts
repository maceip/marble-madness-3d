import type { Game } from './game';

export type MagicRecorderStatus = 'idle' | 'recording' | 'processing' | 'ready' | 'unsupported' | 'error';

export interface MagicMomentMark {
  at: number;
  type: 'ai_knocked_human' | 'human_knocked_ai' | 'hard_collision' | 'ai_fall';
  detail?: string;
}

type CollisionAggressor = 'ai' | 'human' | 'mutual';

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
  private sequence = 0;
  private activeSequence = 0;
  private candidateSequence = 0;
  private readyCandidates = new Map<string, { sequence: number; candidate: MagicCandidate; reviewed: boolean }>();
  private lastOpponentBumpAt = -Infinity;
  private lastCollisionMarkAt = -Infinity;
  private opponentKnockoffs = 0;
  private hardCollisions: Record<CollisionAggressor, number> = { ai: 0, human: 0, mutual: 0 };
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
    if (this.recorder) void this.finish('superseded');
    const sequence = ++this.sequence;
    this.activeSequence = sequence;
    this.raceId = raceId;
    this.chunks = [];
    this.startedAt = performance.now();
    this.lastOpponentBumpAt = -Infinity;
    this.lastCollisionMarkAt = -Infinity;
    this.opponentKnockoffs = 0;
    this.hardCollisions = { ai: 0, human: 0, mutual: 0 };
    this.moments = [];
    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    try {
      this.stream = this.canvas.captureStream(15);
      const chunks = this.chunks;
      this.recorder = new MediaRecorder(this.stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 240_000 });
      const recorder = this.recorder;
      const failActive = (message: string) => {
        if (this.recorder !== recorder) return;
        this.closeStream();
        this.recorder = null;
        this.chunks = [];
        this.startedAt = 0;
        this.raceId = '';
        this.activeSequence = 0;
        this.candidate = { status: 'error', raceId, error: message };
        this.game.webmcp.emit('share_error', { raceId, error: message });
      };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.addEventListener('error', (event) => failActive(event.error?.message || 'race recording failed'));
      recorder.addEventListener('stop', () => failActive('race recording stopped unexpectedly'));
      recorder.start(1000);
      this.candidateSequence = sequence;
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

  noteHardCollision(impulse: number, aggressor: CollisionAggressor = 'mutual'): void {
    const now = performance.now();
    if (now - this.lastCollisionMarkAt < 400) return;
    this.lastCollisionMarkAt = now;
    this.hardCollisions[aggressor]++;
    this.mark('hard_collision', `${aggressor} impact ${impulse.toFixed(1)}`);
  }

  private mark(type: MagicMomentMark['type'], detail?: string): void {
    if (!this.startedAt || this.moments.length >= 64) return;
    const at = Math.round(Math.max(0, (performance.now() - this.startedAt) / 1000) * 1000) / 1000;
    this.moments.push({ at, type, ...(detail ? { detail } : {}) });
  }

  private reason(): string {
    const remoteDeaths = Math.max(0, ...[...this.game.remoteInfo.values()].map((p) => Number(p.deaths) || 0));
    if (this.game.aiDestroyed > 0 && this.opponentKnockoffs > 0) {
      return `Rivals traded knockoffs: AI ${this.game.aiDestroyed}, human ${this.opponentKnockoffs}`;
    }
    if (this.game.aiDestroyed > 0) return `AI knocked the human off ${this.game.aiDestroyed} time${this.game.aiDestroyed === 1 ? '' : 's'}`;
    if (this.opponentKnockoffs > 0) return `Human knocked the AI off ${this.opponentKnockoffs} time${this.opponentKnockoffs === 1 ? '' : 's'}`;
    const hardTotal = this.hardCollisions.ai + this.hardCollisions.human + this.hardCollisions.mutual;
    if (hardTotal >= 3) {
      if (this.hardCollisions.ai > this.hardCollisions.human + this.hardCollisions.mutual) return `AI pressured the human: ${hardTotal} hard collisions`;
      if (this.hardCollisions.human > this.hardCollisions.ai + this.hardCollisions.mutual) return `Human pressured the AI: ${hardTotal} hard collisions`;
      return `Marble-on-marble griefing: ${hardTotal} hard collisions`;
    }
    if (this.game.deaths + remoteDeaths >= 4) return `Both racers struggled: ${this.game.deaths + remoteDeaths} combined falls`;
    return `Complete Humans vs Agents race; review for a close call, comeback, or funny failure`;
  }

  async finish(endReason = 'race_end'): Promise<MagicCandidate> {
    if (!this.recorder || this.recorder.state === 'inactive') return this.candidate;
    const recorder = this.recorder;
    const stream = this.stream;
    const chunks = this.chunks;
    const raceId = this.raceId;
    const sequence = this.activeSequence;
    const duration = Math.max(0, (performance.now() - this.startedAt) / 1000);
    const reason = `${this.reason()} (${endReason})`;
    const moments = [...this.moments];
    // Detach the completed session synchronously. A rapid rematch can now start
    // a fresh recorder without the old stop/upload callback touching its state.
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.raceId = '';
    this.activeSequence = 0;
    this.candidateSequence = Math.max(this.candidateSequence, sequence);
    this.candidate = { status: 'processing', raceId, duration, moments };
    return new Promise<MagicCandidate>((resolve) => {
      recorder.addEventListener('stop', async () => {
        let completed: MagicCandidate;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          if (blob.size < 64) throw new Error('race capture was empty');
          const query = new URLSearchParams({ race: raceId, duration: duration.toFixed(3), reason });
          const response = await fetch(`/api/shares/candidate?${query}`, {
            method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: blob,
          });
          const out = await response.json() as Record<string, unknown>;
          if (!response.ok) throw new Error(String(out.error || `upload failed ${response.status}`));
          completed = {
            status: 'ready', id: String(out.id), raceId, duration,
            reason, previewUrl: String(out.previewUrl), cardUrl: String(out.cardUrl), expiresAt: String(out.expiresAt || ''),
            moments,
          };
          this.remember(sequence, completed);
          if (sequence >= this.candidateSequence && !this.recorder) {
            this.candidateSequence = sequence;
            this.candidate = completed;
          }
          this.game.webmcp.emit('share_candidate', {
            ...completed,
            question: 'Is this race worth clipping? Use moments as timestamp hints, open previewUrl before expiresAt, then call share with candidateId, worthSharing, the best start/end seconds, and where it should go.',
          });
        } catch (error) {
          completed = { status: 'error', raceId, duration, error: error instanceof Error ? error.message : String(error) };
          if (sequence >= this.candidateSequence && !this.recorder) this.candidate = completed;
        } finally {
          for (const track of stream?.getTracks() || []) track.stop();
          resolve(completed!);
        }
      }, { once: true });
      recorder.stop();
    });
  }

  review(candidateId?: unknown): MagicCandidate & { instruction?: string } {
    const id = String(candidateId || '').trim();
    const requested = id ? this.readyCandidates.get(id)?.candidate : undefined;
    if (id && !requested) return { status: 'error', error: 'unknown or expired share candidate' };
    const queued = [...this.readyCandidates.values()]
      .filter((entry) => !entry.reviewed)
      .sort((a, b) => a.sequence - b.sequence)[0]?.candidate;
    // An unreviewed completion wins over a newer active recording, so a missed
    // push event is recoverable. Reviewed cards stay available by explicit ID
    // for idempotent retries but never mask the current race lifecycle.
    const selected = requested || queued || this.candidate;
    return {
      ...selected,
      instruction: selected.status === 'ready'
        ? 'Use moments as timestamp hints and open previewUrl before expiresAt. If it has a magic moment, call share with candidateId, worthSharing=true, a 0.5-8 second clip window, and destination. Otherwise decline it.'
        : undefined,
    };
  }

  async share(args: Record<string, unknown>): Promise<unknown> {
    const requestedId = String(args.candidateId || '').trim();
    const selected = requestedId ? this.readyCandidates.get(requestedId)?.candidate : this.review();
    if (!selected || selected.status !== 'ready' || !selected.id) return { ok: false, ...this.review(requestedId) };
    const worthSharing = args.worthSharing === true;
    const start = Number(args.start);
    const end = Number(args.end);
    const where = String(args.where || '').trim();
    if (worthSharing && (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.5 || end - start > 8 || !where)) {
      return {
        ok: false,
        error: 'A shareable moment requires an exact 0.5-8 second start/end window and destination.',
        moments: selected.moments || [],
        instruction: 'Inspect previewUrl around the timestamp hints, then retry with worthSharing=true, start, end, and where.',
      };
    }
    const response = await fetch(`/api/shares/${selected.id}/render`, {
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
    const entry = this.readyCandidates.get(selected.id);
    if (entry) entry.reviewed = true;
    if (!worthSharing) {
      this.readyCandidates.delete(selected.id);
      if (this.candidate.id === selected.id) this.candidate = { status: 'idle' };
    }
    return { ...out, candidate: selected, instruction: worthSharing ? 'Open cardUrl to inspect the centered GIF card. External posting still requires an explicit user action.' : 'Candidate declined and its full-race recording was deleted.' };
  }

  private remember(sequence: number, candidate: MagicCandidate): void {
    if (!candidate.id) return;
    this.readyCandidates.set(candidate.id, { sequence, candidate, reviewed: false });
    while (this.readyCandidates.size > 4) {
      const oldest = [...this.readyCandidates.entries()].sort((a, b) => a[1].sequence - b[1].sequence)[0];
      if (!oldest) break;
      this.readyCandidates.delete(oldest[0]);
    }
  }

  private closeStream(): void {
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
  }
}
