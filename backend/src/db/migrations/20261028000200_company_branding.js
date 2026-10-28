'use strict';

// White-label: a company's own name, colour and logo on its login page and in the app. Its slug
// is its address (acme.<your domain>).

exports.up = async (knex) => {
  await knex.schema.alterTable('companies', (t) => {
    t.string('brand_name', 120).nullable();
    t.string('brand_color', 7).nullable();
    t.string('logo_key', 255).nullable();
    t.string('logo_content_type', 60).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('companies', (t) => {
    t.dropColumn('brand_name');
    t.dropColumn('brand_color');
    t.dropColumn('logo_key');
    t.dropColumn('logo_content_type');
  });
};
