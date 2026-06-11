Listen carefully to every moment of this audio clip. It is exactly ${durationStr} seconds long.

Return a SINGLE JSON object with this exact structure:

{
  "transcription": "<string>",  // every spoken word, in Ethiopic script (ፊደላት)
  "gender": "<male|female|unknown>",  // gender of the primary speaker
  "dialect": "<gonder|gojjam|wollo|shewa|addis_ababa|unknown>",  // Amharic regional variety
  "speaker_count": <number>     // distinct human voices heard in the clip
}

## Rules
- Transcribe every spoken word across the full ${durationStr} seconds — do not skip or summarise.
- "transcription" must use correct Ethiopic Unicode — never romanised transliteration.
- Use "unknown" only when gender or dialect genuinely cannot be determined from the audio.
- If no Amharic speech is detected (silence, music, other language), return:
    {"transcription": "", "gender": "unknown", "dialect": "unknown", "speaker_count": 0}
- Do NOT wrap the output in markdown fences or add any prose outside the JSON.

## Example
{
  "transcription": "ሰላም፣ ዛሬ እንዴት ነህ? ጥሩ ነኝ፣ አመሰግናለሁ።",
  "gender": "female",
  "dialect": "gonder",
  "speaker_count": 1
}
