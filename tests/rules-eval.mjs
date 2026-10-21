/**
 * A small evaluator for firebase/database.rules.json, so the rules can be exercised without the emulator
 * (which needs firebase-tools). Rule expressions are JavaScript-compatible, so each is compiled with
 * `new Function`. Implemented: .write granted if any rule on the path to the write allows it, .validate on
 * every node written (and its descendants), wildcards ($var) and $other. Not implemented: .read, indexOn,
 * query rules. This is a test aid, not Firebase itself: confirm important changes in the Rules Playground.
 */
import fs from 'node:fs';
import assert from 'node:assert';

String.prototype.matches = function matches(re) { return re.test(String(this)); };   // Firebase string.matches(/re/)

const RULES = JSON.parse(fs.readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8')).rules;

const walk = (root, path) => { let v = root; for (const k of path) { if (v && typeof v === 'object' && k in v) v = v[k]; else return undefined; } return v; };
class Snap {
  constructor(root, path) { this.root = root; this.path = path; }
  get v() { return walk(this.root, this.path); }
  val() { return this.v === undefined ? null : this.v; }
  exists() { return this.v !== undefined && this.v !== null; }
  child(p) { return new Snap(this.root, this.path.concat(String(p).split('/').filter(Boolean))); }
  parent() { return new Snap(this.root, this.path.slice(0, -1)); }
  hasChildren(keys) { const v = this.v; if (!v || typeof v !== 'object') return false; return keys ? keys.every((k) => v[k] !== undefined && v[k] !== null) : Object.keys(v).length > 0; }
  isString() { return typeof this.v === 'string'; }
  isNumber() { return typeof this.v === 'number'; }
  isBoolean() { return typeof this.v === 'boolean'; }
}

function apply(root, ops) {
  const out = structuredClone(root);
  for (const { path, value } of ops) {
    if (!path.length) throw new Error('root writes are not modelled');
    let n = out;
    for (const k of path.slice(0, -1)) { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; }
    const last = path.at(-1);
    if (value === null || value === undefined) delete n[last]; else n[last] = structuredClone(value);
  }
  return out;
}

const compile = (expr) => new Function('data', 'newData', 'root', 'auth', 'now', 'vars', `with (vars) { return (${expr}); }`);
const cache = new Map();
function evalRule(expr, ctx) {
  if (typeof expr === 'boolean') return expr;
  let fn = cache.get(expr); if (!fn) { fn = compile(expr); cache.set(expr, fn); }
  try { return !!fn(ctx.data, ctx.newData, ctx.root, ctx.auth, ctx.now, ctx.vars); } catch (e) { return false; }
}
const childRule = (node, key, vars) => {
  if (node[key] && typeof node[key] === 'object' && !key.startsWith('.')) return { rule: node[key], vars };
  const w = Object.keys(node).find((k) => k.startsWith('$'));
  return w ? { rule: node[w], vars: { ...vars, [w]: key } } : null;
};

function ctxFor(oldRoot, newRoot, path, auth, vars) {
  return { data: new Snap(oldRoot, path), newData: new Snap(newRoot, path), root: new Snap(oldRoot, []), auth, now: Date.now(), vars };
}

/** @returns {{ok:boolean, why?:string}} */
export function check(oldRoot, ops, auth) {
  const newRoot = apply(oldRoot, ops);
  for (const op of ops) {
    // 1) write permission: any rule on the way down may grant it
    let node = RULES, vars = {}, granted = false, rule = RULES;
    if (evalRule(node['.write'] ?? false, ctxFor(oldRoot, newRoot, [], auth, vars))) granted = true;
    for (let i = 0; i < op.path.length && !granted; i++) {
      const c = childRule(node, op.path[i], vars); if (!c) break;
      node = c.rule; vars = c.vars;
      if (node['.write'] !== undefined && evalRule(node['.write'], ctxFor(oldRoot, newRoot, op.path.slice(0, i + 1), auth, vars))) granted = true;
    }
    if (!granted) return { ok: false, why: `write denied at /${op.path.join('/')}` };
    // 2) validation of everything written (skipped for deletions)
    if (op.value === null || op.value === undefined) continue;
    let rnode = RULES, rvars = {}; let okPath = true;
    for (let i = 0; i < op.path.length; i++) { const c = childRule(rnode, op.path[i], rvars); if (!c) { okPath = false; break; } rnode = c.rule; rvars = c.vars; }
    if (!okPath) continue;
    const bad = (rn, vs, path) => {
      const v = walk(newRoot, path); if (v === undefined || v === null) return null;
      if (rn['.validate'] !== undefined && !evalRule(rn['.validate'], ctxFor(oldRoot, newRoot, path, auth, vs))) return `validate failed at /${path.join('/')}`;
      if (v && typeof v === 'object') for (const k of Object.keys(v)) { const c = childRule(rn, k, vs); if (c) { const r = bad(c.rule, c.vars, path.concat(k)); if (r) return r; } }
      // required children declared in .validate (hasChildren) are covered by the parent's own rule
      return null;
    };
    const r = bad(rnode, rvars, op.path); if (r) return { ok: false, why: r };
  }
  return { ok: true };
}

export { RULES, apply };
