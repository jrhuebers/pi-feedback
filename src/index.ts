import { getAgentDir, VERSION, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { FeedbackBoard, type BoardAction, type BoardOptions } from "./board.ts";
import { profileInfo } from "./profile.ts";
import { FeedbackStore, STATUSES, cleanText, plain, title, type Note } from "./store.ts";

export default function feedbackExtension(pi: ExtensionAPI): void {
  // No startup reads, watchers, network, model calls, or automatic transcript capture.
  async function store() {
    const profile = await profileInfo(getAgentDir());
    return { ...profile, store: new FeedbackStore(profile.root) };
  }
  async function capture(text: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!text.trim()) {
      const draft = await ctx.ui.editor("Feedback · first line is the title · Esc cancels", "");
      if (draft === undefined || !draft.trim()) return;
      text = draft;
    }
    text = cleanText(text);
    const { store: files, profile, cluster } = await store();
    const result = await files.add(text, {
      profile, ...(cluster ? { cluster } : {}), cwd: ctx.cwd,
      sessionId: ctx.sessionManager.getSessionId(),
      entryId: ctx.sessionManager.getLeafId() ?? undefined,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      piVersion: VERSION,
    });
    ctx.ui.notify(`Feedback saved to inbox: ${plain(title(result.note))}\n${files.path(result.note.id)}`, "info");
    if (result.boardWarning) ctx.ui.notify(result.boardWarning, "warning");
  }
  async function editNote(files: FeedbackStore, note: Note, ctx: ExtensionCommandContext): Promise<void> {
    const text = await ctx.ui.editor("Edit feedback · Esc cancels", note.text);
    if (text === undefined || !text.trim() || text === note.text) return;
    const result = await files.update(note.id, { text }, note.updated);
    if (result.boardWarning) ctx.ui.notify(result.boardWarning, "warning");
  }
  async function moveNote(files: FeedbackStore, note: Note, ctx: ExtensionCommandContext): Promise<void> {
    const status = await ctx.ui.select(`Move: ${plain(title(note))}`, [...STATUSES]);
    if (!status) return;
    const result = await files.update(note.id, { status: status as Note["status"] });
    if (result.boardWarning) ctx.ui.notify(result.boardWarning, "warning");
  }
  function guarded(handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>) {
    return async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) throw new Error("Feedback commands require interactive Pi or an RPC UI client.");
      try { await handler(args, ctx); }
      catch (error) { ctx.ui.notify(`Feedback: ${(error as Error).message}`, "error"); }
    };
  }
  pi.registerCommand("feedback", {
    description: "Save an improvement idea or problem privately (/feedback [text])",
    handler: guarded(capture),
  });
  pi.registerCommand("feedback-show", {
    description: "Open your feedback board (/feedback-show [search text])",
    handler: guarded(async (args, ctx) => {
      const { store: files, root } = await store();
      const options: BoardOptions = { notes: [], root, query: args.trim(), oldest: false, warnings: 0 };
      while (true) {
        const snapshot = await files.refresh();
        options.notes = snapshot.notes;
        options.warnings = snapshot.warnings.length;
        let action: BoardAction;
        if (ctx.mode === "tui") {
          action = await ctx.ui.custom<BoardAction>((tui, theme, keys, done) => new FeedbackBoard(
            options, theme, keys, () => tui.terminal.rows, () => tui.requestRender(), done,
          ));
        } else {
          // RPC clients cannot render custom TUI components; use standard dialogs instead.
          const notes = snapshot.notes.filter((note) => `${note.text} ${note.origin.profile} ${note.id}`.toLowerCase().includes(options.query.toLowerCase()));
          const labels = notes.map((note) => `[${note.status}] ${plain(title(note))} (${note.id.slice(0, 8)})`);
          const choices = ["+ New feedback", "/ Search", "↻ Refresh", ...labels];
          const choice = await ctx.ui.select(`Feedback · ${root}${options.warnings ? ` · ${options.warnings} unreadable notes` : ""}`, choices);
          if (choice === undefined) return;
          if (choice === choices[0]) action = { action: "new" };
          else if (choice === choices[1]) action = { action: "search" };
          else if (choice === choices[2]) action = { action: "refresh" };
          else {
            const note = notes[labels.indexOf(choice)];
            if (!note) continue;
            const operation = await ctx.ui.select(plain(title(note)), ["View", "Edit", "Move"]);
            if (operation === "View") { await ctx.ui.editor("View feedback (changes discarded)", `${note.text}\n\n${JSON.stringify(note.origin, null, 2)}\n\n${files.path(note.id)}`); continue; }
            if (operation !== "Edit" && operation !== "Move") continue;
            action = { action: operation === "Edit" ? "edit" : "move", id: note.id };
          }
        }
        if (!action) return;
        if (action.action === "new") await capture("", ctx);
        else if (action.action === "search") {
          const query = await ctx.ui.input("Search feedback (empty clears search)", options.query);
          if (query !== undefined) options.query = query.trim();
        } else if (action.action === "edit" || action.action === "move") {
          const note = snapshot.notes.find((item) => item.id === action.id);
          if (note) {
            if (action.action === "edit") await editNote(files, note, ctx);
            else await moveNote(files, note, ctx);
          }
        }
      }
    }),
  });
}
