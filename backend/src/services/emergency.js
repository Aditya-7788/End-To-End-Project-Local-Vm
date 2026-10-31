const emergencyPatterns = [
  /\bchest\s+pain\b/i,
  /\b(heavy|severe|uncontrolled)\s+bleeding\b/i,
  /\b(heavy|severe|uncontrolled)\s+(?:nose)?bleed(?:ing)?\b/i,
  /\bbleeding\s+(?:heavily|severely|uncontrollably)\b/i,
  /\bcan(?:not|'t)\s+breathe\b/i,
  /\btrouble\s+breathing\b/i,
  /\bbreathing\s+(?:trouble|difficulty|problem)\b/i,
  /\bdifficulty\s+breathing\b/i,
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
  /\bbolne\s+mein\s+dikkat\b/i,
  /सीने में दर्द|छाती में दर्द|सांस लेने में कठिनाई|साँस लेने में कठिनाई|सांस नहीं आ रही|साँस नहीं आ रही|बहुत ज्यादा खून बहना|चेहरा टेढ़ा|बोलने में कठिनाई|एक तरफ कमजोरी/
];

function detectEmergency(message) {
  return emergencyPatterns.some((pattern) => pattern.test(message));
}

const emergencyReply =
  'Your symptoms may need urgent attention. Please go to the nearest emergency room immediately or call your local emergency number. Do not wait for an appointment here.';

module.exports = { detectEmergency, emergencyReply };
