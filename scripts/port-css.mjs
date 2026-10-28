import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("C:/Users/anjo_/Projetos/prumo/src/index.css", "utf8");
const lines = src.split("\n");
const keep = [];
let mode = "head";

for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (i < 90) {
    keep.push(L);
    continue;
  }
  if (
    L.startsWith(".door") ||
    L.startsWith(".plumb") ||
    L.startsWith(".bob") ||
    L.startsWith(".form") ||
    L.startsWith(".field") ||
    L.startsWith(".btn") ||
    L.startsWith(".text-link") ||
    L.startsWith(".checks") ||
    L.startsWith("@keyframes rise")
  ) {
    mode = "auth";
  }
  if (
    L.startsWith(".app-shell") ||
    L.startsWith(".sidebar") ||
    L.startsWith(".org-") ||
    L.startsWith(".side-nav") ||
    L.startsWith(".stage") ||
    L.startsWith(".topbar") ||
    L.startsWith(".ms-page") ||
    L.startsWith(".ms-dash") ||
    L.startsWith(".ms-stat") ||
    L.startsWith(".panel-empty") ||
    L.startsWith(".table-state") ||
    L.startsWith(".tag ")
  ) {
    mode = "app";
  }
  if (L.startsWith(".drawer") || L.startsWith(".crm-") || L.startsWith(".project-")) {
    mode = "skip";
  }
  if (mode === "skip") continue;
  if (mode === "auth" || mode === "app") keep.push(L);
}

const extras = `
.stage-body { padding: 1.25rem 1.5rem 2.5rem; min-width: 0; }
.nav-btn {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.55rem 0.65rem; border: 0; border-radius: 0.65rem;
  background: transparent; color: var(--ash); font: inherit; font-weight: 500;
  cursor: pointer; text-align: left; width: 100%; position: relative;
}
.nav-btn:hover { color: var(--graphite); background: var(--fog); }
.nav-btn.active {
  color: var(--graphite);
  background: color-mix(in srgb, var(--plumb) 8%, var(--panel));
}
.nav-btn.active::before {
  content: ""; position: absolute; left: 0; top: 0.4rem; bottom: 0.4rem;
  width: 3px; border-radius: 999px; background: var(--plumb);
}
.list-ops { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
.list-ops li {
  display: flex; justify-content: space-between; gap: 0.75rem; align-items: center;
  padding: 0.75rem 0; border-bottom: 1px solid var(--rule);
}
.tag {
  display: inline-block; margin-left: 0.35rem; padding: 0.1rem 0.4rem;
  border-radius: 999px; background: color-mix(in srgb, var(--plumb) 12%, white);
  color: var(--plumb); font-size: 0.72rem; font-weight: 600;
}
.btn-ghost {
  height: 36px; margin: 0; padding: 0 0.75rem; background: transparent;
  color: var(--graphite); border: 1px solid var(--rule); border-radius: var(--radius);
  cursor: pointer; font: inherit;
}
.btn-ghost:hover { background: var(--fog); }
.panel-block {
  background: var(--snow); border: 1px solid var(--rule); border-radius: 0.85rem;
  padding: 1rem 1.1rem; box-shadow: var(--shadow-soft);
}
.panel-block h3 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 600; }
.panel-stack { display: grid; gap: 1rem; }
@media (max-width: 860px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--rule); }
  .door-brand, .door-main, .door-foot { margin-left: 1.5rem; width: calc(100% - 3rem); }
  .plumb { left: 1.1rem; }
}
`;

const out = `${keep.join("\n")}\n${extras}`;
writeFileSync("C:/Users/anjo_/OneDrive/Projetos-FabriaIA/prumo-app/web/src/index.css", out);
console.log("css_bytes", Buffer.byteLength(out), "lines", out.split("\n").length);
