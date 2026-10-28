import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function messages(locale) {
  const bytes = readFileSync(new URL(`../i18n/locales/${locale}.json`, import.meta.url));
  const catalog = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const entries = {};
  function flatten(value, prefix = "") {
    for (const [key, message] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof message === "string") entries[path] = message;
      else flatten(message, path);
    }
  }
  flatten(catalog);
  return entries;
}

const en = messages("en");
const th = messages("th");
const placeholders = message => [...new Set([...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();

test("UI catalogs contain valid UTF-8 text without encoding damage", () => {
  for (const [locale, catalog] of [["en", en], ["th", th]]) {
    for (const [key, message] of Object.entries(catalog)) {
      assert.doesNotMatch(message, /\?{2,}|\uFFFD|[A-Za-z0-9]\?[A-Za-z0-9]|\s\?\s|\u00E0[\u00B8\u00B9]|\u00C3[\u0080-\u00BF]/u,
        `${locale}.${key} contains damaged text`);
    }
  }
});

test("Thai translations cover every English message and preserve interpolation fields", () => {
  assert.deepEqual(Object.keys(th).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(th[key].trim().length > 0, true, `${key} is missing its Thai translation`);
    assert.deepEqual(placeholders(th[key]), placeholders(en[key]), `${key} has mismatched interpolation fields`);
  }
});
