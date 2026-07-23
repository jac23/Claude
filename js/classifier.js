// classifier.js
// Maps measured acoustic features of a bark event to a likely emotional
// state / reaction.
//
// The rules are grounded in animal-bioacoustics research, chiefly Eugene
// Morton's "motivation-structural rules" and studies of dog vocalisations
// (Pongracz et al., Yin & McCowan). The short version:
//
//   * LOW pitch  -> larger/threatening intent (warning, guarding, aggression)
//   * HIGH pitch -> smaller/appeasing or aroused intent (fear, play, excitement)
//   * LONG / tonal sounds  -> deliberate, confident, sustained states
//   * SHORT / noisy sounds -> uncertain, reactive, fearful states
//   * RAPID repetition -> high arousal / urgency (alarm, excitement)
//   * SPACED repetition -> lower arousal (demand, mild interest)
//
// This is an informed estimate, not a literal translation. Dogs do not use a
// human-style language, but the acoustic signature of a bark genuinely
// correlates with the animal's emotional arousal and valence.

const REACTION_PROFILES = [
  {
    id: 'alarm',
    label: 'Alert / Warning',
    icon: '\u{1F6A8}',
    blurb: '"Something is happening! Pay attention!"',
    detail:
      'Rapid, repetitive, mid-to-high pitched barks. Your dog has noticed ' +
      'something and is raising the alarm — a person at the door, a noise ' +
      'outside, or an unexpected change in the environment.',
    tips: [
      'Look toward what your dog is facing — it is signalling a trigger.',
      'Calmly acknowledge ("thank you") then redirect to break the loop.',
    ],
    color: '#f59e0b',
  },
  {
    id: 'threat',
    label: 'Warning / Guarding',
    icon: '\u{1F620}',
    blurb: '"Back off. This is mine / I am serious."',
    detail:
      'Low-pitched, longer, growly vocalisations signal a confident, defensive ' +
      'state. Your dog is warning a perceived intruder or protecting a resource ' +
      'and wants more distance.',
    tips: [
      'Do not punish a growl — it is honest communication and a useful warning.',
      'Increase distance from the trigger and remove pressure.',
    ],
    color: '#ef4444',
  },
  {
    id: 'excited',
    label: 'Playful / Excited',
    icon: '\u{1F604}',
    blurb: '"This is great! Let’s go! Play with me!"',
    detail:
      'High-pitched, varied bursts, often with a bouncy rhythm. Classic happy ' +
      'arousal — you picked up the leash, a favourite person arrived, or a ' +
      'game is about to start.',
    tips: [
      'Channel the energy into a game, a walk, or a training cue.',
      'Rewarding calm before you engage keeps the excitement manageable.',
    ],
    color: '#22c55e',
  },
  {
    id: 'demand',
    label: 'Demand / Attention',
    icon: '\u{1F415}',
    blurb: '"Hey! Look at me. I want that."',
    detail:
      'Single or double mid-pitched barks aimed right at you, usually spaced ' +
      'out. Your dog is making a request — food, a toy, the door, or simply ' +
      'your attention.',
    tips: [
      'Decide what you want to reinforce before responding.',
      'Reward the quiet moments rather than the bark to avoid teaching a habit.',
    ],
    color: '#3b82f6',
  },
  {
    id: 'fear',
    label: 'Fear / Anxiety',
    icon: '\u{1F628}',
    blurb: '"I’m scared / unsure about this."',
    detail:
      'High-pitched, sharp, sometimes trembling barks or yelps. Your dog feels ' +
      'threatened or overwhelmed and may want to escape the situation.',
    tips: [
      'Give your dog space and a way out — do not force an approach.',
      'Calmly remove the trigger; reassurance is fine, coddling panic is not.',
    ],
    color: '#a855f7',
  },
  {
    id: 'lonely',
    label: 'Whine / Loneliness',
    icon: '\u{1F97A}',
    blurb: '"I miss you / I want company."',
    detail:
      'High, tonal, drawn-out whines or howls with a rising pitch. Often heard ' +
      'when a dog is left alone, seeking contact, or feeling frustrated by a ' +
      'barrier.',
    tips: [
      'Check for an unmet need — company, a toilet break, comfort.',
      'For separation-related distress, build up alone-time gradually.',
    ],
    color: '#06b6d4',
  },
  {
    id: 'content',
    label: 'Calm / Content',
    icon: '\u{1F60C}',
    blurb: '"All is well. I’m relaxed."',
    detail:
      'Soft, low-energy sounds, sighs, or the quiet gaps between barks. Your ' +
      'dog is settled and comfortable with no pressing demands.',
    tips: [
      'A great moment to reward calm with quiet praise.',
      'Note what led here — it helps recreate a relaxed environment.',
    ],
    color: '#84cc16',
  },
];

function profileById(id) {
  return REACTION_PROFILES.find((p) => p.id === id) || REACTION_PROFILES[0];
}

// features:
//   pitchHz        dominant fundamental frequency of the event (Hz)
//   loudness       0..1 peak normalised RMS energy
//   durationMs     length of the sound event
//   repetitionHz   barks per second in the recent window (0 if isolated)
//   tonality       0..1 how tonal (1) vs noisy (0) the sound is
//
// Returns { profile, confidence (0..1), scores } where scores is a map of
// id -> raw score, useful for debugging / a breakdown display.
function classifyBark(features) {
  const { pitchHz, loudness, durationMs, repetitionHz, tonality } = features;

  // Normalised helpers. Typical domestic-dog bark fundamentals sit roughly
  // between 250 Hz (large, low) and 2000 Hz (small, high). Clamp and scale.
  const pitchNorm = clamp01((pitchHz - 250) / (2000 - 250)); // 0 low .. 1 high
  const durNorm = clamp01(durationMs / 800); // 0 short .. 1 long (>=800ms)
  const repNorm = clamp01(repetitionHz / 4); // 0 isolated .. 1 machine-gun
  const loud = clamp01(loudness);
  const tonal = clamp01(tonality);

  const scores = {
    // Rapid + mid/high + repetitive + loud
    alarm:
      repNorm * 1.4 +
      bell(pitchNorm, 0.55, 0.3) * 1.0 +
      loud * 0.6 +
      (1 - durNorm) * 0.3,

    // Low + long + loud + noisy (growly)
    threat:
      (1 - pitchNorm) * 1.4 +
      durNorm * 1.0 +
      loud * 0.5 +
      (1 - tonal) * 0.6 +
      (1 - repNorm) * 0.2,

    // High + loud + repetitive + medium duration + tonal
    excited:
      pitchNorm * 1.2 +
      loud * 0.7 +
      repNorm * 0.7 +
      bell(durNorm, 0.35, 0.3) * 0.6 +
      tonal * 0.4,

    // Mid pitch + spaced + directed + moderate loudness
    demand:
      bell(pitchNorm, 0.5, 0.25) * 1.1 +
      (1 - repNorm) * 0.9 +
      bell(loud, 0.5, 0.35) * 0.6 +
      bell(durNorm, 0.3, 0.3) * 0.4,

    // Very high + short + tonal + not too loud (yelp/sharp)
    fear:
      pitchNorm * 1.3 +
      (1 - durNorm) * 0.8 +
      tonal * 0.6 +
      (1 - loud) * 0.4 +
      (1 - repNorm) * 0.2,

    // High + long + very tonal + isolated (whine/howl)
    lonely:
      pitchNorm * 1.0 +
      durNorm * 1.0 +
      tonal * 1.2 +
      (1 - repNorm) * 0.6 +
      (1 - loud) * 0.3,

    // Quiet + low energy overall
    content:
      (1 - loud) * 1.6 +
      (1 - repNorm) * 0.6 +
      (1 - durNorm) * 0.3 +
      tonal * 0.2,
  };

  // Pick the winner and turn the score spread into a rough confidence.
  let bestId = 'content';
  let best = -Infinity;
  let total = 0;
  for (const [id, s] of Object.entries(scores)) {
    total += Math.max(0, s);
    if (s > best) {
      best = s;
      bestId = id;
    }
  }
  const confidence = total > 0 ? clamp01(best / total * 1.8) : 0.2;

  return { profile: profileById(bestId), confidence, scores };
}

// Gaussian-ish bell centred at `mu` with width `sigma`; peaks at 1.
function bell(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

window.BarkClassifier = { classifyBark, REACTION_PROFILES, profileById };
