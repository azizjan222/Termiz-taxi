#!/usr/bin/env python3
"""Generate a distinct "order cancelled" notification sound (order_cancelled.wav).

Design: a short, descending three-note motif (high -> low) which reads clearly as a
"cancelled / negative" cue and is easy to tell apart from the louder rising new-order
tone. Output matches new_order.wav's format: PCM 16-bit, mono, 44100 Hz.
"""
import math
import struct
import wave

SAMPLE_RATE = 44100
AMPLITUDE = 0.55  # 0..1 (headroom to avoid clipping)


def tone(freq, duration, *, fade=0.012):
    """A single sine tone with short fade-in/out to avoid clicks."""
    n = int(SAMPLE_RATE * duration)
    fade_n = max(1, int(SAMPLE_RATE * fade))
    out = []
    for i in range(n):
        env = 1.0
        if i < fade_n:
            env = i / fade_n
        elif i > n - fade_n:
            env = max(0.0, (n - i) / fade_n)
        out.append(AMPLITUDE * env * math.sin(2 * math.pi * freq * (i / SAMPLE_RATE)))
    return out


def silence(duration):
    return [0.0] * int(SAMPLE_RATE * duration)


# Descending motif: G5 -> C5 -> G4 (clearly "downward" = cancel)
samples = []
samples += tone(784.0, 0.14)   # G5
samples += silence(0.04)
samples += tone(523.25, 0.14)  # C5
samples += silence(0.04)
samples += tone(392.0, 0.26)   # G4 (slightly longer resolve)
samples += silence(0.06)

# Write both app copies.
paths = [
    "sarix-go-driver/assets/sounds/order_cancelled.wav",
    "sarix-go-app/assets/sounds/order_cancelled.wav",
]

frames = b"".join(
    struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples
)

for p in paths:
    with wave.open(p, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(frames)
    print(f"wrote {p} ({len(frames)} bytes, {len(samples)/SAMPLE_RATE:.2f}s)")
