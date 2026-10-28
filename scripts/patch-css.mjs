import { appendFileSync, readFileSync } from "node:fs";

const path = "C:/Users/anjo_/OneDrive/Projetos-FabriaIA/prumo-app/web/src/index.css";
const src = readFileSync("C:/Users/anjo_/Projetos/prumo/src/index.css", "utf8");

function sliceBetween(startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a + 1);
  if (a < 0 || b < 0) throw new Error(`missing ${startMark} / ${endMark}`);
  return src.slice(a, b);
}

const chunks = [
  sliceBetween(".app-main {", ".linkish {"),
  sliceBetween(".btn-quiet {", "@media (max-width: 980px)"),
  sliceBetween(".ms-dash-panel {", ".ms-dash-open {"),
];

const extra = `
.side-nav button {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.65rem;
  border: 0;
  background: transparent;
  color: var(--ash);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
  text-align: left;
  position: relative;
}
.side-nav button:hover {
  color: var(--graphite);
  background: var(--fog);
}
.side-nav button.active {
  color: var(--graphite);
  background: color-mix(in srgb, var(--plumb) 8%, var(--panel));
}
.side-nav button.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 3px;
  border-radius: 999px;
  background: var(--plumb);
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.95rem 1.5rem;
}
.topbar h1 {
  margin: 0;
  font-size: 1.28rem;
  font-weight: 650;
  letter-spacing: -0.035em;
}
.topbar p {
  margin: 0.25rem 0 0;
  color: var(--ash);
  font-size: 0.9rem;
}
.ms-dash-open {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: inherit;
  display: grid;
  gap: 0.15rem;
}
`;

appendFileSync(path, `\n/* --- patched from Prumo --- */\n${chunks.join("\n")}${extra}`);
console.log("ok");
