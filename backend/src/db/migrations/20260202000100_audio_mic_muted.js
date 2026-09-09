'use strict';

// Sprint 7 — mic-mute detection.
//
// The desktop agent measures the RMS level of the audio stream during a sample. If the entire
// sample is below the silence threshold the microphone was almost certainly muted, physical or
// in software. The flag is surfaced in the admin UI so HR can see it without listening to the
// file.
//
// `mic_muted` is nullable:
//   null  — sample was recorded before this migration, or the agent could not determine it
//   false — audio was detected (mic was live)
//   true  — silence throughout (mic was muted or disconnected)

exports.up = async function up(knex) {
  await knex.schema.alterTable('audio_recordings', (t) => {
    t.boolean('mic_muted').nullable().defaultTo(null);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('audio_recordings', (t) => {
    t.dropColumn('mic_muted');
  });
};
