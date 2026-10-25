/*
 * <rich-editor> — a Tiptap rich text editor that acts like a form field.
 *
 *   <rich-editor name="body" value="{{article.body}}" placeholder="..."></rich-editor>
 *
 * Its value is Markdown, so jsonx sends it like any other field and the server
 * keeps storing Markdown. People see bold, headings and lists, not asterisks.
 *
 * Why a plain custom element and not a .jx component: Tiptap needs script, and
 * it works in the page's own DOM (selection inside shadow DOM is unreliable).
 * Tiptap itself is bundled in vendor/tiptap and loads only when an editor appears.
 */

const TIPTAP = new URL("../../vendor/tiptap/tiptap.js", import.meta.url).href;
let loading = null;
const loadTiptap = () => (loading = loading || import(TIPTAP));

// [label, title, command, what "active" means]
const BUTTONS = [
  ["B", "Bold (Ctrl+B)", (c) => c.toggleBold(), "bold"],
  ["I", "Italic (Ctrl+I)", (c) => c.toggleItalic(), "italic"],
  ["S", "Strikethrough", (c) => c.toggleStrike(), "strike"],
  ["H2", "Heading", (c) => c.toggleHeading({ level: 2 }), ["heading", { level: 2 }]],
  ["H3", "Small heading", (c) => c.toggleHeading({ level: 3 }), ["heading", { level: 3 }]],
  ["•", "Bulleted list", (c) => c.toggleBulletList(), "bulletList"],
  ["1.", "Numbered list", (c) => c.toggleOrderedList(), "orderedList"],
  ["❝", "Quote", (c) => c.toggleBlockquote(), "blockquote"],
  ["</>", "Code", (c) => c.toggleCode(), "code"],
  ["{ }", "Code block", (c) => c.toggleCodeBlock(), "codeBlock"],
  ["🔗", "Link", null, "link"],
  ["↶", "Undo (Ctrl+Z)", (c) => c.undo(), null],
  ["↷", "Redo (Ctrl+Shift+Z)", (c) => c.redo(), null]
];

class RichEditor extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["value"];

  constructor() {
    super();
    this.internals = this.attachInternals ? this.attachInternals() : null;
    this.pending = "";
    this.editor = null;
  }

  get value() {
    return this.editor ? this.editor.getMarkdown() : this.pending;
  }

  set value(markdown) {
    markdown = markdown == null ? "" : String(markdown);
    if (!this.editor) { this.pending = markdown; return; }
    // Setting the same text again would move the cursor, so leave it alone.
    if (markdown === this.editor.getMarkdown()) return;
    this.editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    this.internals?.setFormValue(markdown);
  }

  attributeChangedCallback(name, old, value) {
    if (name === "value") this.value = value;
  }

  async connectedCallback() {
    if (this.editor || this.starting) return;
    this.starting = true;
    addStyles();
    this.classList.add("rich-editor");
    this.innerHTML = '<div class="re-toolbar" role="toolbar" aria-label="Formatting"></div><div class="re-body"></div>';
    const toolbar = this.querySelector(".re-toolbar");
    this.buttons = BUTTONS.map(([label, title, run, active]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
      button.addEventListener("click", () => run ? run(this.editor.chain().focus()).run() : this.link());
      toolbar.append(button);
      return { button, active };
    });

    const { Editor, StarterKit, Markdown } = await loadTiptap();
    this.editor = new Editor({
      element: this.querySelector(".re-body"),
      extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown],
      content: this.pending,
      contentType: "markdown",
      editorProps: { attributes: { class: "markdown re-content", "aria-label": this.getAttribute("placeholder") || "Editor", "aria-multiline": "true", role: "textbox" } },
      onUpdate: () => {
        this.internals?.setFormValue(this.value);
        // One bubbling input event from the editor itself, so jsonx knows it's been typed in.
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.refresh();
      },
      onSelectionUpdate: () => this.refresh(),
      onFocus: () => this.classList.add("focused"),
      onBlur: () => { this.classList.remove("focused"); this.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    this.internals?.setFormValue(this.value);
    this.placeholder();
    this.refresh();
  }

  disconnectedCallback() {
    // Lit moves nodes around; only tear down if we're really gone.
    queueMicrotask(() => {
      if (this.isConnected || !this.editor) return;
      this.editor.destroy();
      this.editor = null;
      this.starting = false;
    });
  }

  link() {
    const current = this.editor.getAttributes("link").href || "https://";
    const href = prompt("Link to:", current);
    if (href === null) return;
    const chain = this.editor.chain().focus().extendMarkRange("link");
    (href.trim() ? chain.setLink({ href: href.trim() }) : chain.unsetLink()).run();
  }

  refresh() {
    if (!this.editor) return;
    for (const { button, active } of this.buttons) {
      if (!active) continue;
      const on = Array.isArray(active) ? this.editor.isActive(...active) : this.editor.isActive(active);
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on);
    }
    this.placeholder();
  }

  placeholder() {
    this.classList.toggle("empty", this.editor.isEmpty);
    this.querySelector(".re-content").dataset.placeholder = this.getAttribute("placeholder") || "";
  }
}

function addStyles() {
  if (document.getElementById("rich-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "rich-editor-styles";
  style.textContent = `
    rich-editor { display: block; border: 1px solid var(--wa-color-neutral-border-loud, #ccc); border-radius: var(--wa-border-radius-m, 6px); background: var(--wa-color-surface-default, #fff); }
    rich-editor.focused { outline: var(--wa-focus-ring, 2px solid #4f46e5); outline-offset: 1px; }
    rich-editor .re-toolbar { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; border-bottom: 1px solid var(--wa-color-neutral-border-quiet, #eee); }
    rich-editor .re-toolbar button { font: inherit; font-size: 14px; min-width: 32px; height: 30px; padding: 0 6px; border: 0; border-radius: 4px; background: none; color: inherit; cursor: pointer; }
    rich-editor .re-toolbar button:hover { background: var(--wa-color-neutral-fill-quiet, #f0f0f0); }
    rich-editor .re-toolbar button:nth-child(1) { font-weight: 700; }
    rich-editor .re-toolbar button:nth-child(2) { font-style: italic; }
    rich-editor .re-toolbar button:nth-child(3) { text-decoration: line-through; }
    rich-editor .re-toolbar button.on { background: var(--wa-color-brand-fill-quiet, #e0e7ff); color: var(--wa-color-brand-on-quiet, #3730a3); }
    rich-editor .re-content { min-height: 240px; padding: 12px 14px; outline: none; }
    rich-editor .re-content > :first-child { margin-top: 0; }
    rich-editor.empty .re-content > p:first-child::before { content: attr(data-placeholder); color: var(--wa-color-text-quiet, #999); float: left; height: 0; pointer-events: none; }
  `;
  document.head.append(style);
}

customElements.define("rich-editor", RichEditor);
