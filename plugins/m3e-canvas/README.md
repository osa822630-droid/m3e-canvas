# M3E Canvas for Claude

This plugin helps Claude create or revise an editable M3E Canvas project from a conversation. Describe the app, screens, and navigation you want, or provide an existing project JSON file or share link. The **sketch** skill guides Claude through the Canvas format and, when code execution is available, creates a link that opens the design in the editor. You can then use Tidy, Preview, and Copy prompt in M3E Canvas.

## Use it on the web

In Claude, open **Customize → Plugins → Add → Add marketplace → Add from a repository** and enter `osa822630-droid/m3e-canvas`. Add **M3E Canvas** from the marketplace, open a chat, and ask for an M3E Canvas sketch. You can also select the sketch skill from the available skills menu. Adding the marketplace and adding the plugin are separate steps.

No Claude Code, API key, local server, or connector is required. If Claude cannot run the bundled Python helper, ask it for the project JSON instead; save the JSON as a UTF-8 `.json` file and use **Open project** in the editor. For edits without code execution, provide the existing JSON file or its contents rather than a compressed link.

The default editor is the original public site, <https://lnkiai.github.io/m3e-canvas/>. If you host your own compatible copy, you can ask Claude to use its URL instead. A share link contains the project in its URL fragment: anyone who receives the link can recover the design. The plugin itself has no connector or network service, although the editor may load any external image URLs in a design. Claude's availability and usage limits depend on your account.

## Maintenance

When changing the project format or `public/agent.md`, update the bundled `skills/sketch/references/canvas-guide.md` and, if necessary, `skills/sketch/assets/project-constraints.json` and the helper's validation. The repository tests check the guide, part lists, and representative validation cases against the editor. Bump the plugin version in both `.claude-plugin/plugin.json` and the marketplace entry when releasing an update.
