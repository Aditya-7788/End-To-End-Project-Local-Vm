const emergencyPatterns = [
  /\bchest\s+pain\b/i,
  /\b(heavy|severe|uncontrolled)\s+bleeding\b/i,
  /\bcan(?:not|'t)\s+breathe\b/i,
  /\bbreathing\s+(?:trouble|difficulty|problem)\b/i,
  /\bshortness\s+of\s+breath\b/i,
  /\b(stroke|face\s+droop(?:ing)?|slurred\s+speech|one[- ]sided\s+weakness)\b/i,
  /\bsevere\s+bleeding\b/i,
  /\bsaans\s+(?:nahi|nahin)\s+(?:aa|aati)\s+rahi\b/i,
  /\bsaans\s+lene\s+mein\s+dikkat\b/i,
  /\bseene\s+mein\s+dard\b/i,
  /\bchhaati\s+mein\s+dard\b/i,
  /\bbahut\s+zyada\s+khoon\b/i,
  /\bkhoon\s+(?:bah|behta)\s+raha\b/i,
  /\bmunh\s+tedha\b/i,
  /\bek\s+taraf\s+(?:ka|mein)?\s*kamzori\b/i,
  /\bbolne\s+mein\s+dikkat\b/i
];

function detectEmergency(message) {
  return emergencyPatterns.some((pattern) => pattern.test(message));
}

const emergencyReply =
  'Your symptoms may need urgent attention. Please go to the nearest emergency room immediately or call your local emergency number. Do not wait for an appointment here.';

module.exports = { detectEmergency, emergencyReply };
