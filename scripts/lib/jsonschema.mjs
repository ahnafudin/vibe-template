// scripts/lib/jsonschema.mjs — a deliberately tiny JSON-Schema validator: just
// the subset scripts/stacks.schema.json uses. It exists so the schema is
// ENFORCED (by `npm run gate` and by `stacks.mjs validate`) rather than being a
// decorative document — a malformed framework entry must fail loudly, not
// silently mis-detect someone's project later.
//
// Supported: $ref (local), type, enum, const, oneOf, required, properties,
// additionalProperties, propertyNames-free patterns, items, minItems, maxItems,
// minProperties, maxProperties, minLength, pattern.
// Anything else in a schema is ignored rather than guessed at.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
}

function typeMatches(value, want) {
  const actual = typeOf(value);
  if (want === "number") return actual === "number" || actual === "integer";
  if (want === "integer") return actual === "integer";
  return actual === want;
}

function deref(schema, root) {
  let cur = schema;
  const seen = new Set();
  while (cur && cur.$ref) {
    if (seen.has(cur.$ref)) throw new Error(`circular $ref: ${cur.$ref}`);
    seen.add(cur.$ref);
    const path = cur.$ref.replace(/^#\//, "").split("/");
    cur = path.reduce((acc, key) => acc?.[key], root);
    if (!cur) throw new Error(`unresolvable $ref: ${schema.$ref}`);
  }
  return cur;
}

/** Validate `value`; returns an array of `"<path>: <problem>"` strings (empty = valid). */
export function validate(value, schema, root = schema, path = "") {
  const s = deref(schema, root);
  const errors = [];
  const fail = (msg) => errors.push(`${path || "<root>"}: ${msg}`);

  if (s.oneOf) {
    const ok = s.oneOf.some((sub) => validate(value, sub, root, path).length === 0);
    if (!ok) fail(`does not match any allowed shape`);
    return errors;
  }
  if (s.enum && !s.enum.includes(value)) fail(`must be one of ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  if ("const" in s && value !== s.const) fail(`must equal ${JSON.stringify(s.const)}`);

  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => typeMatches(value, t))) {
      fail(`expected ${types.join("|")}, got ${typeOf(value)}`);
      return errors; // further checks would only produce noise
    }
  }

  if (typeOf(value) === "string") {
    if (s.minLength != null && value.length < s.minLength) fail(`shorter than ${s.minLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(value)) fail(`does not match /${s.pattern}/`);
  }

  if (typeOf(value) === "array") {
    if (s.minItems != null && value.length < s.minItems) fail(`needs at least ${s.minItems} item(s)`);
    if (s.maxItems != null && value.length > s.maxItems) fail(`allows at most ${s.maxItems} item(s)`);
    if (s.items) value.forEach((v, i) => errors.push(...validate(v, s.items, root, `${path}[${i}]`)));
  }

  if (typeOf(value) === "object") {
    const keys = Object.keys(value);
    if (s.minProperties != null && keys.length < s.minProperties) fail(`needs at least ${s.minProperties} key(s)`);
    if (s.maxProperties != null && keys.length > s.maxProperties) fail(`allows at most ${s.maxProperties} key(s)`);
    for (const key of s.required ?? []) if (!(key in value)) fail(`missing required key "${key}"`);
    for (const key of keys) {
      const sub = s.properties?.[key];
      if (sub) {
        errors.push(...validate(value[key], sub, root, path ? `${path}.${key}` : key));
      } else if (s.additionalProperties === false) {
        fail(`unknown key "${key}"`);
      } else if (s.additionalProperties && typeof s.additionalProperties === "object") {
        errors.push(...validate(value[key], s.additionalProperties, root, path ? `${path}.${key}` : key));
      }
    }
  }

  return errors;
}
