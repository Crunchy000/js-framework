// <conduit-nav>: the navigation bar on every page. A tiny web component whose
// content is a jsonx region: it loads /view/nav and draws the right links.
customElements.define("conduit-nav", class extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <nav class="wa-split" jx-get="/view/nav">
        <template>
          <a class="brand" href="index.html">conduit</a>
          <div class="wa-cluster wa-gap-l">
            <a href="index.html">Home</a>
            <a jx-if="!signedIn" href="login.html">Sign in</a>
            <a jx-if="!signedIn" href="register.html">Sign up</a>
            <a jx-if="signedIn" href="editor.html"><wa-icon name="pen-to-square"></wa-icon> New article</a>
            <a jx-if="signedIn" href="settings.html"><wa-icon name="gear"></wa-icon> Settings</a>
            <a jx-if="signedIn" href="{{profileUrl}}"><wa-icon name="user"></wa-icon> {{username}}</a>
          </div>
        </template>
        <a class="brand" href="index.html">conduit</a>
      </nav>`;
  }
});
