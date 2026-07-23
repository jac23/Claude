# 🐕 Bark Translator

A browser app that listens to your dog through the microphone, analyses the
acoustic signature of each bark in real time, and estimates what your dog is
feeling and reacting to.

No installation, no backend, no data leaves your device — it's a single static
web page that runs entirely in the browser (works great on a phone).

## How to use it

1. Open `index.html` in a modern browser (Chrome, Safari, or Firefox).
   - Because it needs the microphone, it must be served over **HTTPS** or from
     **localhost**. Opening the file directly (`file://`) may block the mic in
     some browsers — see [Running locally](#running-locally).
2. Tap **Start listening** and allow microphone access.
3. Make some noise near your dog. Each detected bark shows up with:
   - the likely emotional state (alert, playful, warning, demand, fear,
     whine/lonely, or calm),
   - a confidence estimate,
   - the measured acoustic features,
   - a **Replay** button to hear the captured bark back, and
   - practical tips for how to respond.
4. Recent barks are logged in the **Recent barks** panel, each with its own
   replay (▶︎) button so you can listen again to any of the last 25 barks.

Use the **Sensitivity** slider if the app is missing quiet barks (raise it) or
triggering on background noise (lower it).

## Running locally

Any static file server works. For example:

```bash
# Python 3
python3 -m http.server 8000
# then open http://localhost:8000
```

```bash
# Node (if you have npx)
npx serve .
```

## How it works

The app never tries to "decode words" — dogs don't have a human-style language.
Instead it measures the physical properties of each sound and maps them to
emotional states using well-established animal-bioacoustics principles, chiefly
**Eugene Morton's motivation-structural rules** and studies of dog
vocalisations (Pongrácz et al., Yin & McCowan):

| Acoustic cue        | Tends to signal                                  |
| ------------------- | ------------------------------------------------ |
| **Low pitch**       | Larger/threatening intent — warning, guarding    |
| **High pitch**      | Smaller/appeasing or aroused — fear, play, excitement |
| **Long / tonal**    | Deliberate, confident, sustained states          |
| **Short / noisy**   | Uncertain, reactive, fearful states              |
| **Rapid repetition**| High arousal / urgency — alarm, excitement       |
| **Spaced repetition**| Lower arousal — demand, mild interest           |

### Pipeline

1. **Capture** — `getUserMedia` + the Web Audio API `AnalyserNode`
   (`js/audio-engine.js`).
2. **Event detection** — an adaptive RMS-energy threshold opens and closes
   discrete "bark" events and rejects background noise.
3. **Feature extraction** per event:
   - **Pitch** — autocorrelation of the time-domain signal (dog range
     ~150–2500 Hz).
   - **Loudness** — peak normalised RMS energy.
   - **Duration** — event length.
   - **Repetition rate** — barks per second across a rolling 2.5 s window.
   - **Tonality** — a spectral-flatness measure (tonal vs. noisy/growly).
4. **Classification** — `js/classifier.js` scores the features against seven
   reaction profiles and returns the best match with a confidence estimate.
5. **Recording** — a parallel tap on the raw signal keeps a short rolling
   pre-roll buffer and captures each bark's PCM samples, encoding them to a
   16-bit WAV blob for in-app replay. Recordings live only in memory (the last
   25 barks) and are never uploaded.

## Project structure

```
index.html            App shell and layout
css/styles.css        Styling
js/audio-engine.js    Microphone capture + acoustic feature extraction
js/classifier.js      Feature -> emotion mapping and reaction profiles
js/app.js             UI controller wiring it all together
```

## Accuracy & honest limitations

This is a thoughtful, science-informed **estimate**, not a literal translation:

- Breed, size, individual voice, and microphone quality all shift the numbers.
- A single bark is ambiguous even to expert humans; **context and body
  language matter as much as sound.**
- Growls at very low frequencies can be hard for phone mics to capture.

Treat it as a fun nudge to pay closer attention to your dog — not a substitute
for reading the whole animal or, when needed, a qualified trainer or
behaviourist.

## Privacy

All audio is processed live on your device. Nothing is recorded, stored, or
transmitted anywhere.
