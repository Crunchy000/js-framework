/*
 * <rich-editor> — a Tiptap rich text editor that acts like a form field.
 *
 *   <rich-editor name="body" value="{{article.body}}" upload="/api/uploads"></rich-editor>
 *
 * Its value is HTML, so jsonx sends it like any other field. The page that shows
 * the article draws it with jx:html, which cleans it first.
 *
 * Images are uploaded, not linked: the image button, pasting or dropping a file
 * POSTs it to the upload address as form data (field "file"). The server
 * answers { "url": "..." } and the image goes in with that address.
 *
 * Why a plain custom element and not a .jx component: Tiptap needs script, and
 * it works in the page's own DOM (selection inside shadow DOM is unreliable).
 * Tiptap itself is bundled in vendor/tiptap and loads only when an editor appears.
 */

// Carries this file's ?v= along, so a new version is fetched fresh.
const TIPTAP = new URL("../../vendor/tiptap/tiptap.js" + new URL(import.meta.url).search, import.meta.url).href;
let loading = null;
const loadTiptap = () => (loading = loading || import(TIPTAP));

// The toolbar: [label, title, command, what "active" means]. Kept to the basics;
// undo, redo and the rest of Tiptap's shortcuts still work from the keyboard.
const BUTTONS = [
  ["B", "Bold (Ctrl+B)", (c) => c.toggleBold(), "bold"],
  ["I", "Italic (Ctrl+I)", (c) => c.toggleItalic(), "italic"],
  ["H", "Heading", (c) => c.toggleHeading({ level: 2 }), ["heading", { level: 2 }]],
  ["•", "Bulleted list", (c) => c.toggleBulletList(), "bulletList"],
  ["🔗", "Link", "link", "link"],
  ["🖼", "Upload an image", "chooseImage", null]
];

// Big photos are shrunk before they're sent. GIFs are sent as they are.
const MAX_SIZE = 1200;

class RichEditor extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["value"];

  constructor() {
    super();
    this.internals = this.attachInternals ? this.attachInternals() : null;
    this.pending = "";
    this.editor = null;
  }

  // An empty editor is "", not <p></p>, so "body can't be blank" still works.
  get value() {
    if (!this.editor) return this.pending;
    return this.editor.isEmpty ? "" : this.editor.getHTML();
  }

  set value(html) {
    html = html == null ? "" : String(html);
    if (!this.editor) { this.pending = html; return; }
    // Setting the same text again would move the cursor, so leave it alone.
    if (html === this.value) return;
    this.editor.commands.setContent(html, { emitUpdate: false });
    this.internals?.setFormValue(this.value);
  }

  attributeChangedCallback(name, old, value) {
    if (name === "value") this.value = value;
  }

  async connectedCallback() {
    if (this.editor || this.starting) return;
    this.starting = true;
    addStyles();
    this.classList.add("rich-editor");
    this.innerHTML = '<div class="re-toolbar" role="toolbar" aria-label="Formatting"></div><div class="re-body"></div>' +
      '<input type="file" accept="image/*" hidden><p class="re-status" role="status"></p>';
    this.querySelector("input[type=file]").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) this.upload(file);
    });
    const toolbar = this.querySelector(".re-toolbar");
    this.buttons = BUTTONS.map(([label, title, run, active]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
      button.addEventListener("click", () => typeof run === "function" ? run(this.editor.chain().focus()).run() : this[run]());
      toolbar.append(button);
      return { button, active };
    });

    const { Editor, StarterKit, Image, Mark } = await loadTiptap();
    this.editor = new Editor({
      element: this.querySelector(".re-body"),
      // allowBase64: the demo's pretend server answers with data: addresses.
      extensions: [StarterKit.configure({ link: { openOnClick: false } }), Image.configure({ allowBase64: true }), simpleMark(Mark, "kbd"), simpleMark(Mark, "mark")],
      content: this.pending,
      editorProps: {
        attributes: { class: "rich-text re-content", "aria-label": this.getAttribute("placeholder") || "Editor", "aria-multiline": "true", role: "textbox" },
        // Pasted or dropped image files are uploaded too.
        handlePaste: (view, event) => this.uploadFiles(event.clipboardData && event.clipboardData.files),
        handleDrop: (view, event) => {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          return this.uploadFiles(event.dataTransfer && event.dataTransfer.files, at && at.pos);
        }
      },
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

  chooseImage() {
    if (this.getAttribute("upload")) this.querySelector("input[type=file]").click();
    else this.status("This editor has no upload address.");
  }

  // true tells Tiptap the paste or drop was handled.
  uploadFiles(files, at) {
    const images = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    images.forEach((file) => this.upload(file, at));
    return images.length > 0;
  }

  async upload(file, at) {
    const address = this.getAttribute("upload");
    if (!address) return this.status("This editor has no upload address.");
    this.status("Uploading " + file.name + "…");
    try {
      const form = new FormData();
      form.append("file", await shrink(file), file.name);
      const response = await fetch(address, { method: "POST", body: form });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok || !answer.url) throw new Error(firstError(answer) || "the upload failed");
      // The file name, tidied up, is a starting point for the alt text.
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      const image = { type: "image", attrs: { src: answer.url, alt } };
      // A dropped file goes where it was dropped; otherwise at the cursor. If
      // an image is selected (say the one just uploaded), it goes after it.
      const selection = this.editor.state.selection;
      if (at == null && selection.node) at = selection.to;
      if (at == null) this.editor.chain().focus().insertContent(image).run();
      else this.editor.chain().focus().insertContentAt(at, image).run();
      this.status("");
    } catch (e) {
      this.status("Couldn't upload " + file.name + ": " + e.message + ".");
    }
  }

  status(text) {
    this.querySelector(".re-status").textContent = text;
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

// A photo wider or taller than MAX_SIZE is redrawn smaller, as a JPEG.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 500000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.8));
}

// RealWorld-style errors: { errors: { file: ["is too big"] } } -> "file is too big".
function firstError(answer) {
  const errors = answer && answer.errors;
  const key = errors && Object.keys(errors)[0];
  return key ? key + " " + [].concat(errors[key])[0] : "";
}

// Tiptap keeps only the tags its extensions know, and drops the rest when an
// article is opened. Image comes with Tiptap; <kbd> and <mark> are taught here.
function simpleMark(Mark, tag) {
  return Mark.create({
    name: tag,
    excludes: tag === "kbd" ? "_" : undefined, // nothing else inside a key
    parseHTML: () => [{ tag }],
    renderHTML: () => [tag, 0]
  });
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
    rich-editor .re-toolbar button.on { background: var(--wa-color-brand-fill-quiet, #e0e7ff); color: var(--wa-color-brand-on-quiet, #3730a3); }
    rich-editor .re-content { min-height: 240px; padding: 12px 14px; outline: none; }
    rich-editor .re-content > :first-child { margin-top: 0; }
    rich-editor .re-content img { max-width: 100%; }
    rich-editor .re-status { margin: 0; padding: 0 14px; font-size: 13px; color: var(--wa-color-text-quiet, #777); }
    rich-editor .re-status:not(:empty) { padding: 6px 14px; border-top: 1px solid var(--wa-color-neutral-border-quiet, #eee); }
    rich-editor .re-content img.ProseMirror-selectednode { outline: 2px solid var(--wa-color-brand-border-loud, #4f46e5); }
    rich-editor.empty .re-content > p:first-child::before { content: attr(data-placeholder); color: var(--wa-color-text-quiet, #999); float: left; height: 0; pointer-events: none; }
  `;
  document.head.append(style);
}

customElements.define("rich-editor", RichEditor);
