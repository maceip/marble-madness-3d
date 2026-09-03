# Trackball sound layers — handoff for the audio engine

Goal: make the on-screen marble-looking trackball sound like a 3-inch, ~550 g phenolic ball riding on
steel rollers and an idler bearing inside an arcade cabinet. Haptics carry the low-frequency mass and the
bearing teeth (already done natively in the Android host); sound carries everything the phone's actuator
cannot: high-frequency bearing whine, cabinet resonance, and the transient of skin meeting a moving ball.

Reference implementation, type-checked and unwired: `src/engine/trackball_audio.ts` (`TrackballAudio`).
Wire it from `Trackball` and the SFX bus; nothing else changes.

## Two rules

1. **Continuous layers follow physics state every frame** (ω for pitch/level, |α| for rumble). Parameters are
   smoothed with `setTargetAtTime` (30 ms) so there is no zipper noise.
2. **Transients fire on the same events as the haptics** (grab, breakaway, brake), so ear and thumb agree.
   Nothing plays on release: the ball keeps whining as ω decays, which is what sells the free spin.

## Inputs

From `Trackball` (`src/engine/trackball.ts`):

| source | value | used by |
|---|---|---|
| `wx, wy` after `update(dt)` | angular velocity rad/s (down, right) | whine pitch/level/pan, rumble |
| `startDrag()` | current speed `hypot(wx, wy)` | slap (only if speed > 2) |
| stiction breaks (`brokenOut` flips) | — | breakaway tock |
| counter-brake branch in `dragDelta` | current speed | brake scrub |
| `endDrag()` | — | nothing |

## Layers

### 1. Bearing whine (continuous)
Steel roller shafts and the idler race spinning. One looping pink-noise source → two parallel bandpass
resonators (Q 14) at 420 Hz and 1280 Hz plus a low "growl" band (180 Hz, Q 1.2, −15 dB relative) → gain → pan.

| parameter | mapping |
|---|---|
| pitch ratio | `0.6 + 1.6 · clamp(ω / ωmax)` applied to both resonator centres (0.6× at rest → 2.2× at ωmax) |
| level | `0.35 · clamp(ω / ωmax)^1.2`, hard 0 below ω = 0.3 rad/s |
| pan | `0.6 · wy / ω`, clamped ±0.6 (rolling right drifts right) |
| ωmax | 32 rad/s (`Trackball.maxOmega`) |

### 2. Chassis rumble (continuous, acceleration-driven)
Hollow cabinet thud when the ball is forced to change speed or direction. Same noise source → two cascaded
lowpass filters at 180 Hz → gain from an envelope follower on `|α| = |Δω| / dt`.

| parameter | mapping |
|---|---|
| target | `clamp(|α| / 40 rad/s²)` |
| envelope | attack τ 5 ms, release τ 120 ms |
| level | `0.45 · envelope` |

Steady spinning is nearly silent here; whips, catches and brakes light it up.

### 3. Skin catch / slap (one-shot, on grab of a spinning ball)
Two parts fired together: 12 ms burst of noise through a bandpass at 2.5 kHz (Q 0.8), and a 90 Hz sine
"clunk" with 40 ms exponential decay whose pitch drops from 126 Hz to 90 Hz as it settles.

| parameter | mapping |
|---|---|
| trigger | `startDrag` with ω > 2 |
| scale | `√clamp(ω / 15)` — kinetic energy ∝ ω², perceived loudness ∝ √ |
| level | burst `0.6 · scale`, clunk `0.48 · scale` |

### 4. Encoder ticks (optional, off by default)
A 2 ms click through a 3 kHz bandpass every 6° of rotation, dropped above 35 Hz, level `tickGain · (0.3 + 0.7 · ω/ωmax)`.
The real encoder is silent, so `tickGain` defaults to 0. Enable at ~0.06 if the haptic teeth need an audible twin
on devices without a good actuator.

### Extras
- **Breakaway tock**: 8 ms noise burst, bandpass 200 Hz (Q 2), level 0.15. Fires when static friction breaks.
- **Brake scrub**: 60 ms noise burst, bandpass 3 kHz (Q 0.7), level `0.25 + 0.35 · ω/ωmax`, plus a 110 Hz clunk.

## Mix and plumbing

- Everything sums into one `GainNode` (`TrackballAudio.out`) that you connect to the SFX bus, so the SFX slider
  and the haptics/sound toggles apply as they do for every other effect. Aim for the whine peaking around −18 dBFS
  under the music; the tuning constants above were chosen for that with the bus at unity.
- The pink-noise source runs forever at zero gain when idle. Cost is one buffer source and six biquads; no
  per-frame allocations. One-shots allocate short-lived nodes, which is fine at these rates.
- Create it after the `AudioContext` is running (first gesture, as `Sound.init` does). Use
  `latencyHint: 'interactive'` if the context is created fresh.
- `update()` is called per frame from the game loop; that is enough for audio. Haptics stay on the input path.
- If the SFX volume is 0, call `setEnabled(false)` to skip the parameter automation work entirely.

## Tuning knobs

All in `DEFAULT_TUNING` (`trackball_audio.ts`): `maxOmega`, `whineGain`, `whineF1/F2`, `whineQ`, `pitchMin/Max`,
`growlGain`, `rumbleGain`, `alphaMax`, `rumbleAttack/Release`, `slapGain`, `slapOmegaRef`, `tickGain`,
`tickStepRad`, `tickMaxHz`. Start with the defaults; the two you will most likely touch are `whineGain`
(too loud reads as "hiss") and `alphaMax` (too low makes every nudge rumble).

## Sync with the native haptics (Android host)

| moment | thumb (native engine) | ear (this module) |
|---|---|---|
| grab a spinning ball | two LOW_TICKs then THUD | slap burst + clunk |
| static friction breaks | LOW_TICK | tock |
| rolling under the finger | TICK every 6° | whine follows ω (ticks optional) |
| whip and release | silence at once | whine decays with ω |
| catch/brake against spin | rattle + CLICK | scrub + clunk |
