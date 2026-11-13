import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { STATUSES, plain, title, type Note, type Status } from "./store.ts";

export type BoardAction = { action: "new" | "search" | "refresh" } | { action: "edit" | "move"; id: string } | undefined;
export interface BoardOptions {
  notes: Note[];
  root: string;
  query: string;
  filter?: Status;
  oldest: boolean;
  selectedId?: string;
  warnings: number;
}
interface Keys { matches(data: string, action: string): boolean }

export class FeedbackBoard {
  private column = 0;
  private row = 0;
  private detail = false;
  private offset = 0;
  constructor(readonly options: BoardOptions, private theme: Theme, private keys: Keys,
    private rows: () => number, private redraw: () => void, private done: (action: BoardAction) => void) {
    const selected = options.notes.find((note) => note.id === options.selectedId);
    if (selected) this.column = STATUSES.indexOf(selected.status);
    else if (options.filter) this.column = STATUSES.indexOf(options.filter);
    if (selected) this.row = Math.max(0, this.columns()[this.column].findIndex((note) => note.id === selected.id));
  }
  private columns(): Note[][] {
    const query = this.options.query.toLocaleLowerCase();
    return STATUSES.map((status) => this.options.notes
      .filter((note) => note.status === status && (!this.options.filter || status === this.options.filter)
        && `${note.text} ${note.origin.profile} ${note.origin.cluster ?? ""} ${note.id}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => (this.options.oldest ? 1 : -1) * a.created.localeCompare(b.created) || a.id.localeCompare(b.id)));
  }
  private selected(): Note | undefined { return this.columns()[this.column][this.row]; }
  handleInput(data: string): void {
    const note = this.selected();
    if (this.keys.matches(data, "tui.select.cancel") || matchesKey(data, "ctrl+c")) {
      if (this.detail) { this.detail = false; this.offset = 0; }
      else { this.done(undefined); return; }
    } else if (this.keys.matches(data, "tui.select.confirm")) {
      if (note) { this.detail = !this.detail; this.offset = 0; }
    } else if (this.keys.matches(data, "tui.select.up") || data === "k") {
      if (this.detail) this.offset = Math.max(0, this.offset - 1);
      else this.row = Math.max(0, this.row - 1);
    } else if (this.keys.matches(data, "tui.select.down") || data === "j") {
      if (this.detail) this.offset++;
      else this.row = Math.min(Math.max(0, this.columns()[this.column].length - 1), this.row + 1);
    } else if (!this.detail && (matchesKey(data, "left") || data === "h" || matchesKey(data, "right") || data === "l")) {
      const direction = matchesKey(data, "left") || data === "h" ? -1 : 1;
      this.column = (this.column + direction + STATUSES.length) % STATUSES.length;
      this.row = 0;
    } else if (data === "s") {
      this.options.oldest = !this.options.oldest;
      this.row = 0;
    } else if (data === "f") {
      const filters = [undefined, ...STATUSES];
      this.options.filter = filters[(filters.indexOf(this.options.filter) + 1) % filters.length];
      this.column = this.options.filter ? STATUSES.indexOf(this.options.filter) : 0;
      this.row = 0; this.detail = false;
    } else if ((data === "e" || data === "m") && note) {
      this.options.selectedId = note.id;
      this.done({ action: data === "e" ? "edit" : "move", id: note.id }); return;
    } else if (data === "n" || data === "/" || data === "r") {
      this.options.selectedId = note?.id;
      this.done({ action: data === "n" ? "new" : data === "/" ? "search" : "refresh" }); return;
    } else return;
    this.options.selectedId = this.selected()?.id;
    this.redraw();
  }
  render(width: number): string[] {
    const theme = this.theme;
    const height = Math.max(3, Math.min(30, this.rows() - 6));
    const note = this.selected();
    const header = `Feedback · ${this.options.filter ?? "all"} · ${this.options.oldest ? "oldest" : "newest"}${this.options.query ? ` · search: ${plain(this.options.query)}` : ""}`;
    let body: string[];
    if (this.detail && note) {
      const metadata = [title(note), `Status: ${note.status} · Profile: ${note.origin.profile}${note.origin.cluster ? ` · Cluster: ${note.origin.cluster}` : ""}`,
        `Created: ${note.created} · Updated: ${note.updated}`, `Project: ${note.origin.cwd}`,
        `Session: ${note.origin.sessionId}${note.origin.entryId ? ` · Entry: ${note.origin.entryId}` : ""}`,
        `Model: ${note.origin.model ?? "unknown"} · Pi: ${note.origin.piVersion}`, `File: ${this.options.root}/items/${note.id}.md`, "", note.text];
      const wrapped = wrapTextWithAnsi(plain(metadata.join("\n")), Math.max(1, width));
      this.offset = Math.min(this.offset, Math.max(0, wrapped.length - height));
      body = wrapped.slice(this.offset, this.offset + height);
    } else {
      const columns = this.columns();
      const count = columns.reduce((sum, column) => sum + column.length, 0);
      if (!count) body = ["No feedback matches. Press n to capture an idea, / to search, or f to change status filter."];
      else if (width >= 90) {
        const columnWidth = Math.floor((width - 6) / 3);
        const visibleRows = Math.max(1, height - 2);
        const rendered = columns.map((notes, col) => {
          const start = col === this.column ? Math.max(0, this.row - visibleRows + 1) : 0;
          return [theme.fg(col === this.column ? "accent" : "muted", `${col === this.column ? "▸ " : "  "}${STATUSES[col].toUpperCase()} (${notes.length})`),
            ...notes.slice(start, start + visibleRows).map((item, row) => {
              const selected = col === this.column && row + start === this.row;
              return theme.fg(selected ? "accent" : "text", `${selected ? "> " : "  "}${plain(title(item))}`);
            }), theme.fg("dim", notes.length > visibleRows ? `${start + 1}–${Math.min(start + visibleRows, notes.length)} of ${notes.length}` : "")];
        });
        body = Array.from({ length: Math.max(...rendered.map((lines) => lines.length)) }, (_, row) => rendered.map((lines) => {
          const cell = truncateToWidth(lines[row] ?? "", columnWidth);
          return cell + " ".repeat(Math.max(0, columnWidth - visibleWidth(cell)));
        }).join(" │ "));
      } else {
        const notes = columns[this.column];
        const visibleRows = Math.max(1, height - 2);
        const start = Math.max(0, this.row - visibleRows + 1);
        body = [theme.fg("accent", `${STATUSES[this.column].toUpperCase()} (${notes.length}) · ←/→ columns`),
          ...notes.slice(start, start + visibleRows).map((item, row) => theme.fg(row + start === this.row ? "accent" : "text", `${row + start === this.row ? "> " : "  "}${plain(title(item))}`))];
        if (!notes.length) body.push("Empty column. Use ←/→ to switch.");
      }
    }
    const hints = this.detail ? "↑↓ scroll · Enter/Esc back · e edit · m move" : "←→ columns · ↑↓ select · Enter details · n new · e edit · m move";
    return [theme.fg("accent", header), theme.fg("dim", plain(this.options.root)), ...body,
      theme.fg("dim", hints), theme.fg("dim", `/ search · f status · s sort · r refresh · Esc close${this.options.warnings ? ` · ${this.options.warnings} unreadable note(s); see BOARD.md` : ""}`)]
      .map((line) => truncateToWidth(line, Math.max(0, width)));
  }
  invalidate(): void { /* All layout and theme styling are recalculated on render. */ }
}
