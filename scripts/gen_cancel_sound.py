#!/usr/bin/env python3
"""Generate pleasant, harmonic notification sounds for Sarix Go Driver & Passenger apps.

All files are written as standard PCM 16-bit, mono, 44100 Hz WAV files compatible with
Android NotificationChannel raw resources and iOS notification sounds:
  1. new_order.wav       - Warm, upbeat two-phrase rising marimba-bell chime (new order)
  2. order_cancelled.wav - Soft, gentle descending three-note wooden marimba motif (cancelled/expired)
  3. order_accepted.wav  - Bright, welcoming major arpeggio chime (driver found / order accepted)
  4. driver_arrived.wav  - Pleasant two-step crystal welcome chime (driver arrived / trip started)
  5. order_completed.wav - Warm, resolving major triad chord chime (trip completed)
  6. balance_bonus.wav   - Sparkling coin/wallet chime (balance top-up / bonus earned)
"""
import math
import os
import struct
import wave

SAMPLE_RATE = 44100


def render_marimba_notes(notes, total_duration, *, master_gain=0.72):
    """Synthesize a polyphonic sequence of warm harmonic bell/marimba notes.

    Each note is a tuple:
      (start_sec, freq_hz, duration_sec, amp, decay_rate, harmonics)
    where `harmonics` is a list of (multiplier, relative_amp, relative_decay).
    """
    n_samples = int(SAMPLE_RATE * total_duration)
    buf = [0.0] * n_samples
    attack_sec = 0.008  # 8ms smooth raised-cosine attack to eliminate any click

    for start_sec, freq, dur_sec, amp, decay, harmonics in notes:
        start_idx = int(start_sec * SAMPLE_RATE)
        note_len = int(dur_sec * SAMPLE_RATE)
        attack_len = max(1, int(attack_sec * SAMPLE_RATE))
        release_len = max(1, int(0.025 * SAMPLE_RATE))

        for i in range(note_len):
            idx = start_idx + i
            if idx >= n_samples:
                break
            t = i / SAMPLE_RATE

            # Smooth raised-cosine fade-in
            if i < attack_len:
                env_attack = 0.5 * (1.0 - math.cos(math.pi * i / attack_len))
            else:
                env_attack = 1.0

            # Smooth tail fade-out at the end of the note window
            rem = note_len - i
            if rem < release_len:
                env_release = 0.5 * (1.0 - math.cos(math.pi * rem / release_len))
            else:
                env_release = 1.0

            sample = 0.0
            for mult, h_amp, h_decay in harmonics:
                h_env = math.exp(-decay * h_decay * t)
                sample += h_amp * h_env * math.sin(2.0 * math.pi * (freq * mult) * t)

            buf[idx] += amp * env_attack * env_release * sample

    # Soft limiter (tanh-like gentle saturation) so overlapping chords never clip
    peak = max((abs(x) for x in buf), default=1.0)
    scale = (master_gain / peak) if peak > 1e-6 else 1.0
    return [math.tanh(x * scale * 1.15) / math.tanh(1.15) * master_gain for x in buf]


# Warm marimba/vibraphone harmonic profile (fundamental + soft 2nd, 3rd, 4th overtones)
WARM_BELL = [
    (1.0, 1.00, 1.0),
    (2.0, 0.32, 1.6),
    (3.0, 0.12, 2.3),
    (4.0, 0.05, 3.2),
]

# Soft wooden marimba profile (gentle, mellow for cancel/status)
SOFT_WOOD = [
    (1.0, 1.00, 1.0),
    (2.0, 0.22, 1.8),
    (3.0, 0.06, 2.8),
]

# Sparkling crystal chime profile (for bonus / arrival)
CRYSTAL_CHIME = [
    (1.0, 1.00, 1.0),
    (2.0, 0.40, 1.4),
    (3.0, 0.18, 2.0),
    (5.0, 0.06, 3.0),
]


def build_new_order():
    """1. new_order.wav: Pleasant, attention-getting 2-phrase rising marimba chime."""
    notes = [
        # Phrase 1: F5 -> A5 -> C6 -> F6 (F major rising)
        (0.00, 698.46, 0.26, 0.75, 7.0, WARM_BELL),
        (0.11, 880.00, 0.26, 0.80, 7.0, WARM_BELL),
        (0.22, 1046.50, 0.28, 0.85, 6.5, WARM_BELL),
        (0.34, 1396.91, 0.42, 0.95, 5.0, WARM_BELL),
        (0.34, 698.46, 0.42, 0.40, 5.5, SOFT_WOOD),  # warm lower octave support

        # Phrase 2: G5 -> B5 -> D6 -> G6 (bright step up)
        (0.78, 783.99, 0.26, 0.80, 7.0, WARM_BELL),
        (0.89, 987.77, 0.26, 0.85, 7.0, WARM_BELL),
        (1.00, 1174.66, 0.28, 0.90, 6.5, WARM_BELL),
        (1.12, 1567.98, 0.52, 1.00, 4.2, WARM_BELL),
        (1.12, 783.99, 0.52, 0.45, 4.8, SOFT_WOOD),
        (1.12, 1174.66, 0.52, 0.35, 5.0, SOFT_WOOD),
    ]
    return render_marimba_notes(notes, 1.68, master_gain=0.82)


def build_order_cancelled():
    """2. order_cancelled.wav: Gentle, soft descending 3-note wooden marimba motif."""
    notes = [
        # A5 -> F5 -> D5 (warm descending minor/sixth interval, non-harsh)
        (0.00, 880.00, 0.24, 0.75, 7.5, SOFT_WOOD),
        (0.16, 698.46, 0.24, 0.72, 7.5, SOFT_WOOD),
        (0.32, 587.33, 0.48, 0.80, 5.0, SOFT_WOOD),
        (0.32, 293.66, 0.48, 0.35, 5.5, SOFT_WOOD),  # warm bass root D4
    ]
    return render_marimba_notes(notes, 0.84, master_gain=0.70)


def build_order_accepted():
    """3. order_accepted.wav: Uplifting C-major arpeggio chime (Driver found / Accepted)."""
    notes = [
        (0.00, 523.25, 0.25, 0.70, 7.0, WARM_BELL),   # C5
        (0.11, 659.25, 0.25, 0.78, 7.0, WARM_BELL),   # E5
        (0.22, 783.99, 0.28, 0.85, 6.5, WARM_BELL),   # G5
        (0.34, 1046.50, 0.55, 0.95, 4.2, WARM_BELL),  # C6
        (0.34, 523.25, 0.55, 0.40, 4.8, SOFT_WOOD),   # C5 warm chord
        (0.34, 659.25, 0.55, 0.35, 5.0, SOFT_WOOD),   # E5 warm chord
    ]
    return render_marimba_notes(notes, 0.92, master_gain=0.78)


def build_driver_arrived():
    """4. driver_arrived.wav: Pleasant two-step welcome chime (Driver arrived / Trip started)."""
    notes = [
        (0.00, 783.99, 0.28, 0.78, 6.5, CRYSTAL_CHIME),   # G5
        (0.14, 1174.66, 0.30, 0.85, 6.0, CRYSTAL_CHIME),  # D6
        (0.29, 1567.98, 0.55, 0.95, 4.2, CRYSTAL_CHIME),  # G6
        (0.29, 783.99, 0.55, 0.42, 4.8, SOFT_WOOD),       # G5 warm body
    ]
    return render_marimba_notes(notes, 0.88, master_gain=0.78)


def build_order_completed():
    """5. order_completed.wav: Serene, resolving E-major chord chime (Trip completed)."""
    notes = [
        (0.00, 659.25, 0.30, 0.72, 6.5, WARM_BELL),   # E5
        (0.13, 830.61, 0.30, 0.78, 6.5, WARM_BELL),   # G#5
        (0.26, 987.77, 0.32, 0.84, 6.0, WARM_BELL),   # B5
        (0.40, 1318.51, 0.60, 0.95, 3.8, WARM_BELL),  # E6
        (0.40, 659.25, 0.60, 0.42, 4.5, SOFT_WOOD),   # E5
        (0.40, 987.77, 0.60, 0.35, 4.5, SOFT_WOOD),   # B5
    ]
    return render_marimba_notes(notes, 1.04, master_gain=0.76)


def build_balance_bonus():
    """6. balance_bonus.wav: Sparkling coin/wallet chime (Balance top-up / Bonus earned)."""
    notes = [
        (0.00, 880.00, 0.20, 0.72, 8.0, CRYSTAL_CHIME),   # A5
        (0.09, 1108.73, 0.22, 0.80, 7.5, CRYSTAL_CHIME),  # C#6
        (0.18, 1318.51, 0.24, 0.88, 7.0, CRYSTAL_CHIME),  # E6
        (0.28, 1760.00, 0.52, 0.95, 4.5, CRYSTAL_CHIME),  # A6
        (0.28, 880.00, 0.52, 0.38, 5.0, WARM_BELL),       # A5 body
    ]
    return render_marimba_notes(notes, 0.84, master_gain=0.78)


SOUNDS = {
    "new_order.wav": build_new_order,
    "order_cancelled.wav": build_order_cancelled,
    "order_accepted.wav": build_order_accepted,
    "driver_arrived.wav": build_driver_arrived,
    "order_completed.wav": build_order_completed,
    "balance_bonus.wav": build_balance_bonus,
}

TARGET_DIRS = [
    "sarix-go-driver/assets/sounds",
    "sarix-go-app/assets/sounds",
]


def write_wav(path: str, samples: list[float]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples
    )
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(frames)
    print(f"wrote {path} ({len(frames)} bytes, {len(samples)/SAMPLE_RATE:.2f}s)")


if __name__ == "__main__":
    for filename, builder in SOUNDS.items():
        samples = builder()
        for d in TARGET_DIRS:
            write_wav(os.path.join(d, filename), samples)
