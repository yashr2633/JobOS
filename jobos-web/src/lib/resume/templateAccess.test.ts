import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_STYLES } from "./designs.ts";
import { FREE_TEMPLATE_STYLES, isFreeTemplate } from "./templateAccess.ts";

test("the 74-design catalog contains ten free designs and 64 premium designs", () => {
  const styles = ["classic", "modern", ...STUDIO_STYLES.map(style => style.id)];
  assert.equal(styles.length, 74);
  assert.equal(new Set(FREE_TEMPLATE_STYLES).size, 10);
  assert.equal(styles.filter(id => isFreeTemplate(`${id}-original`)).length, 10);
  assert.equal(styles.filter(id => !isFreeTemplate(`${id}-original`)).length, 64);
});

test("section order never turns a premium design into a free design", () => {
  const premium = STUDIO_STYLES.find(style => !isFreeTemplate(`${style.id}-original`))!;
  for (const order of ["original", "graduate", "experience", "skills", "projects"]) {
    assert.equal(isFreeTemplate(`${premium.id}-${order}`), false);
    assert.equal(isFreeTemplate(`classic-${order}`), true);
  }
  assert.equal(isFreeTemplate(), true);
});
