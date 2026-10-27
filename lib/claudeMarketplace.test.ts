import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { isProject } from "./project";
import { readShareHash, shareable } from "./share";
import {
  CAROUSEL_LAYOUTS, DATE_LAYOUTS, KIND_ORDER, PLACES, TEXT_TOKENS, TIME_LAYOUTS,
  TRACK_MAX, TRACK_MIN, VARIANTS, frameOfGroup, type Doc,
} from "./tokens";

const root = process.cwd();
const pluginRoot = resolve(root, "plugins/m3e-canvas");
const skillRoot = join(pluginRoot, "skills/sketch");
const helper = join(skillRoot, "scripts/canvas_link.py");
const examplePath = join(skillRoot, "assets/example-project.json");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const example = (): Doc => readJson(examplePath) as Doc;
const temporaryDirectories: string[] = [];

function temporaryFile(name: string, contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "m3e-claude-plugin-"));
  temporaryDirectories.push(directory);
  const file = join(directory, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

function runHelper(...args: string[]) {
  // Isolated Python verifies that the skill has no third-party runtime dependency.
  return spawnSync("python3", ["-I", "-X", "utf8", helper, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Claude web marketplace packaging", () => {
  it("lists a self-contained, named plugin using a repository-relative source", () => {
    const marketplace = readJson(join(root, ".claude-plugin/marketplace.json"));
    expect(marketplace.name).toBe("m3e-canvas-marketplace");
    expect(marketplace.owner.name).toBeTruthy();
    expect(marketplace.metadata.description).toBeTruthy();
    expect(marketplace.plugins).toHaveLength(1);

    const entry = marketplace.plugins[0];
    expect(entry.name).toBe("m3e-canvas");
    expect(entry.source).toBe("./plugins/m3e-canvas");
    const source = resolve(root, entry.source);
    expect(relative(root, source)).not.toMatch(/^\.\./);
    const manifest = readJson(join(source, ".claude-plugin/plugin.json"));
    expect(manifest.name).toBe(entry.name);
    expect(manifest.version).toBe(entry.version);
    expect(manifest.description).toBeTruthy();
    expect(manifest.license).toBe("MIT");
    expect(existsSync(join(source, "bin"))).toBe(false); // Claude chat refuses top-level bin/.
    expect(existsSync(join(source, ".mcp.json"))).toBe(false);
    expect(existsSync(join(source, "hooks"))).toBe(false);
  });

  it("includes a chat skill with its referenced resources and a valid icon", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: sketch\ndescription: .+\n---\n/);
    for (const path of ["references/canvas-guide.md", "assets/example-project.json", "assets/project-constraints.json", "scripts/canvas_link.py"]) {
      expect(skill).toContain(path);
      expect(existsSync(join(skillRoot, path))).toBe(true);
    }
    const fallbackExample = skill.match(/```json\n([\s\S]*?)\n```/);
    expect(fallbackExample).not.toBeNull();
    expect(isProject(JSON.parse(fallbackExample![1]))).toBe(true);
    const icon = readFileSync(join(pluginRoot, "assets/icon.png"));
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
  });

  it("keeps the bundled project guide in sync with the editor's agent guide", () => {
    const guide = readFileSync(join(root, "public/agent.md"), "utf8");
    const reference = readFileSync(join(skillRoot, "references/canvas-guide.md"), "utf8");
    const heading = "## The document\n";
    expect(guide).toContain(heading);
    const prefix = "# M3E Canvas project reference\n\nThis format reference is kept in sync with `public/agent.md` in the M3E Canvas repository. Follow the skill instructions for delivery.\n\n";
    expect(reference).toBe(prefix + guide.slice(guide.indexOf(heading)));
  });

  it("keeps the helper's constraints aligned with the editor's supported parts", () => {
    const constraints = readJson(join(skillRoot, "assets/project-constraints.json"));
    expect(constraints.kinds).toEqual(KIND_ORDER);
    expect(constraints.variants).toEqual(VARIANTS.map(({ key }) => key));
    expect(new Set(constraints.layouts)).toEqual(new Set([...CAROUSEL_LAYOUTS, ...DATE_LAYOUTS, ...TIME_LAYOUTS].map(({ key }) => key)));
    expect(constraints.places).toEqual(PLACES.map(({ key }) => key));
    expect(constraints.textColors).toEqual(TEXT_TOKENS.map(({ key }) => key));
    expect(constraints.trackThickness).toEqual({ min: TRACK_MIN, max: TRACK_MAX });
  });

  it("ships an example the editor can open, with unique IDs and working navigation", () => {
    const project = example();
    expect(isProject(project)).toBe(true);
    const ids = [
      ...project.frames.map((frame) => frame.id),
      ...project.groups.map((group) => group.id),
      ...project.groups.flatMap((group) => group.items.map((item) => item.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const frameIds = new Set(project.frames.map((frame) => frame.id));
    for (const group of project.groups) {
      expect(frameOfGroup(group, project.frames, {})).toBeDefined();
      for (const item of group.items) {
        for (const action of [item.action, ...Object.values(item.actions ?? {})]) {
          if (action) expect(action.to === "back" || frameIds.has(action.to)).toBe(true);
        }
      }
    }
  });
});

describe("Claude web Canvas link helper", () => {
  it("produces a link the real editor can read, filtering private fields without changing the source", async () => {
    const project = example();
    project.title = "تصميم 🎨 + & # %";
    project.frames[0].noteHistory = ["Private frame draft"];
    project.groups[0].items[0].noteHistory = ["Private item draft"];
    project.groups[0].items[0].src = "data:image/png;base64,AAAA";
    project.groups[1].items[0].src = "https://example.test/صورة.png";
    const input = temporaryFile("project with spaces.json", JSON.stringify(project));
    const result = runHelper("encode", input);
    expect(result.status, result.stderr).toBe(0);
    const link = result.stdout.trim();
    expect(link).toMatch(/^https:\/\/lnkiai\.github\.io\/m3e-canvas\/#docz=[A-Za-z0-9_-]+$/);
    await expect(readShareHash(new URL(link).hash)).resolves.toEqual(shareable(project));
    expect(readJson(input)).toEqual(project);
  });

  it("uses an explicitly supplied editor URL, including its path and query", async () => {
    const input = temporaryFile("project.json", JSON.stringify(example()));
    const base = "https://example.test/hosted/canvas/?mode=edit";
    const result = runHelper("encode", input, "--base-url", base);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toMatch(/^https:\/\/example\.test\/hosted\/canvas\/\?mode=edit#docz=/);
    await expect(readShareHash(new URL(result.stdout.trim()).hash)).resolves.toEqual(example());
  });

  it("decodes both compressed and plain editor links for subsequent edits", () => {
    const project = example();
    project.title = "وصفات 中文 🎨 + & %";
    const json = JSON.stringify(project);
    const packed = deflateRawSync(Buffer.from(json)).toString("base64url");
    for (const link of [
      `https://example.test/canvas/#docz=${packed}`,
      `https://example.test/canvas/#doc=${encodeURIComponent(json)}`,
      `#doc=${encodeURIComponent(json)}&docz=`,
    ]) {
      const result = runHelper("decode", temporaryFile("link.txt", link));
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(project);
    }
  });

  it.each([
    "https://example.test/#docz=!!!",
    "https://example.test/#other=1",
    "https://example.test/#docz=A",
    "https://example.test/#doc=%7B",
  ])("rejects a missing or broken link rather than inventing a project: %s", (link) => {
    const result = runHelper("decode", temporaryFile("link.txt", link));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/canvas_link:/);
    expect(result.stdout).toBe("");
  });

  it("does not fall back to a plain project when a nonempty compressed project is corrupt", () => {
    const plain = encodeURIComponent(JSON.stringify(example()));
    const link = `https://example.test/#doc=${plain}&docz=!!!`;
    const result = runHelper("decode", temporaryFile("link.txt", link));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/base64url/);
  });

  it("rejects a truncated compressed stream and a decompression bomb", () => {
    const packed = deflateRawSync(Buffer.from(JSON.stringify(example()))).toString("base64url");
    const truncated = runHelper("decode", temporaryFile("truncated.txt", `#docz=${packed.slice(0, -8)}`));
    expect(truncated.status).toBe(2);
    const oversized = deflateRawSync(Buffer.alloc(10 * 1024 * 1024 + 1, 32)).toString("base64url");
    const bomb = runHelper("decode", temporaryFile("oversized.txt", `#docz=${oversized}`));
    expect(bomb.status).toBe(2);
    expect(bomb.stderr).toMatch(/too large/);
  });

  it.each(["javascript:alert(1)", "not a URL", "https://example.test/canvas/#existing"])("rejects an invalid editor base URL: %s", (base) => {
    const result = runHelper("encode", examplePath, "--base-url", base);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/editor URL/);
    expect(result.stdout).toBe("");
  });

  it("reports malformed JSON without emitting a link", () => {
    const result = runHelper("encode", temporaryFile("bad.json", "{ not json"));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/canvas_link:/);
    expect(result.stdout).toBe("");
  });
});

const withItem = (patch: Record<string, unknown>) => {
  const project = example();
  return {
    ...project,
    groups: [{ ...project.groups[0], items: [{ ...project.groups[0].items[0], ...patch }] }, ...project.groups.slice(1)],
  };
};
const withFrame = (patch: Record<string, unknown>) => {
  const project = example();
  return { ...project, frames: [{ ...project.frames[0], ...patch }, ...project.frames.slice(1)] };
};

const projectCases: [string, unknown][] = [
  ["minimal valid project", { frames: [], groups: [] }],
  ["valid optional item fields", withItem({ railExpanded: false, imagePos: "background", imageSize: 30, textColor: "primary", corners: { tl: 0, tr: 4, bl: 4, br: 0 }, tabs: [{ label: "One", icon: null }], trackThickness: 16 })],
  ["valid frame dimensions", withFrame({ w: 1280, h: 800, length: 1200, place: "spread" })],
  ["missing groups", { frames: [] }],
  ["invalid platform", { ...example(), platform: "ios" }],
  ["invalid prompt options", { ...example(), promptOptions: ["ok", 1] }],
  ["frame missing id", withFrame({ id: undefined })],
  ["frame with text coordinate", withFrame({ x: "0" })],
  ["frame with invalid width", withFrame({ w: 0 })],
  ["frame with invalid placement", withFrame({ place: "middle" })],
  ["frame with invalid note", withFrame({ note: null })],
  ["unknown item kind", withItem({ kind: "madeUpPart" })],
  ["unknown item variant", withItem({ variant: "plain" })],
  ["missing item icon", withItem({ icon: undefined })],
  ["non-string item label", withItem({ label: 5 })],
  ["invalid numeric field", withItem({ size: "wide" })],
  ["invalid boolean field", withItem({ railModal: "true" })],
  ["invalid carousel layout", withItem({ layout: "invented" })],
  ["invalid card image size", withItem({ imageSize: 0 })],
  ["invalid card alignment", withItem({ contentAlign: "middle" })],
  ["invalid text color", withItem({ textColor: "pink" })],
  ["invalid progress thickness", withItem({ trackThickness: 1 })],
  ["invalid corners", withItem({ corners: { tl: 0, tr: 0, bl: 0 } })],
  ["invalid tabs", withItem({ tabs: [{ icon: "home" }] })],
  ["invalid tab icon", withItem({ tabs: [{ label: "One", icon: 42 }] })],
  ["invalid tab image", withItem({ tabs: [{ label: "One", src: null }] })],
];

describe("Python project validation parity", () => {
  it.each(projectCases)("matches the editor's isProject for %s", (_name, value) => {
    const text = JSON.stringify(value);
    const expected = isProject(JSON.parse(text));
    const result = runHelper("encode", temporaryFile("project.json", text));
    expect(result.status, result.stderr).toBe(expected ? 0 : 2);
    if (!expected) expect(result.stdout).toBe("");
  });
});
