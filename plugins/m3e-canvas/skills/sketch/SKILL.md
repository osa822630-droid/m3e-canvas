---
name: sketch
description: Create or revise an editable Material 3 Expressive screen sketch for M3E Canvas. Use when someone asks for an M3E Canvas design, a Canvas project or share link, or to turn an app idea into editable Canvas screens.
---

# Sketch with M3E Canvas

Turn the person's idea into an **editable M3E Canvas project**, not merely a description of a UI. The editor runs separately in a browser; this skill does not embed the editor, access an open canvas, or require an MCP connector, API key, Claude Code, or a local server.

## Prepare the design

1. When supporting files are available, read `references/canvas-guide.md` in this skill directory for the document format, supported components, coordinates, actions, and design guidance. `assets/example-project.json` is a complete, valid two-screen example. These files are bundled with the skill; do not rely on fetching a website for the format. The essentials below also work when supporting files cannot be read.
2. For a new idea, make sensible assumptions and design the requested screens, labels, and navigation. Match the person's language. Use 3–5 screens by default if appropriate, not filler. Keep the document near or below 100 KB and do not embed image data.
3. For changes, ask for the existing project JSON (uploaded or pasted) or a Canvas share link; never pretend to see their live editor. If code execution is available, save the exact link in a UTF-8 file and use the helper below to decode it. Keep unrelated screens and fields intact. If execution is unavailable, ask for the JSON instead of guessing the contents of a compressed link.
4. Create valid UTF-8 JSON: each screen has a unique `id`, `name`, `x`, and `y`; each group has a unique `id`, canvas-coordinate `x` and `y`, an `axis` of `x` or `y`, and nonempty `items`. Every item has a unique `id`, supported `kind`, `label`, `icon` (a Material Symbols name or `null`), and `variant`. Navigation destinations must be existing frame IDs or `back`. Use the full bundled reference for the other fields and dimensions.

## Project essentials

A phone frame is 412 × 892 dp. Put the first frame at `x: 0`, the second at `x: 492`, and the third at `x: 984`; groups use canvas coordinates, so add the frame's `x` and `y` to each part's position. For a simple phone screen, put a `topAppBar` at its top and body parts at `x + 16`, `y + 112`, with enough space between them. `button`, `listItem`, `card`, `text`, `textField`, `chip`, `fab`, `image`, `bottomNav`, and `tabs` are supported kinds. Use `"variant": "filled"` unless a different documented variant is needed. A button or list item can navigate with `"action": { "to": "frame-id", "transition": "slide" }`; `"back"` returns to the previous frame. Single-part groups use `"axis": "x"`; vertically connected list items use `"axis": "y"`.

This minimal complete project shows the shape, even without code execution or access to supporting files. Replace and extend it for the person's request:

```json
{
  "title": "My app",
  "brief": "A short description of the app.",
  "frame": "phone",
  "platform": "android",
  "paletteKey": "purple",
  "frames": [{ "id": "home", "name": "Home", "x": 0, "y": 0 }],
  "groups": [{
    "id": "home-bar", "x": 0, "y": 0, "axis": "x",
    "items": [{ "id": "home-title", "kind": "topAppBar", "label": "Home", "icon": null, "variant": "filled" }]
  }]
}
```

## Deliver an editable result

When a code execution tool and Python 3 are available, save the project JSON in a file and run the bundled helper:

```sh
python3 "${CLAUDE_SKILL_DIR}/scripts/canvas_link.py" encode /path/to/project.json
```

The helper checks the editor's project structure using `assets/project-constraints.json`; also check that navigation targets make sense. It prints a link using the public editor at `https://lnkiai.github.io/m3e-canvas/`. Give the person that complete link and briefly explain that they can open it, use **Tidy** or **Preview**, and edit the result. If they explicitly supply a different hosted M3E Canvas URL, pass it with `--base-url 'https://their-host.example/canvas/'`. When revising a link from a different deployment, keep that link's editor URL (the part before `#`) unless the person asks otherwise. For a link the person supplied, write its exact URL to a UTF-8 file and decode it locally before editing:

```sh
python3 "${CLAUDE_SKILL_DIR}/scripts/canvas_link.py" decode /path/to/link.txt > /path/to/project.json
```

Use the generated output, not an invented or shortened URL. If the helper fails, fix the input; if code execution or the helper is unavailable, return the complete project JSON in a code block (or as a downloadable `.json` file if possible). Tell the person to save it as UTF-8 with a `.json` extension and choose **Open project** in the editor. Do not claim that you created a link or opened the editor if you could not.

A link contains the project in its URL fragment. Anyone with the link can recover the design, so mention this before the person shares sensitive work. The helper removes frame/item note history and non-HTTP(S) item image sources from new links, like the editor's share function. It does not upload the project. Keep the original JSON if the person needs local images or edit history.
