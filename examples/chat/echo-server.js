/*
 * echo-server.js — a pretend WebSocket server for the chat demo, running in
 * the browser (GitHub Pages can't run a real one).
 *
 * It stands in for `new WebSocket(".../ws/echo")` and leaves every other
 * address to the real WebSocket. Like a real server, it sends the page JSON
 * views: the whole conversation, ready to draw. The page has no script.
 *
 * A real server does the same thing. In Node with the `ws` package:
 *
 *   wss.on("connection", (socket) => {
 *     socket.send(JSON.stringify(view()));
 *     socket.on("message", (data) => { const { text } = JSON.parse(data); ... });
 *   });
 */
(function () {
  "use strict";

  var RealWebSocket = window.WebSocket;
  var messages = [];   // the conversation, kept while the page is open
  var nextId = 1;
  var typing = false;

  function time() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function say(from, text) {
    messages.push({ id: nextId++, from: from, who: from === "bot" ? "Echo" : "You", text: text, time: time() });
  }

  // The view the page draws: everything it shows, decided here.
  function view(notice) {
    return {
      messages: messages,
      count: messages.filter(function (m) { return m.from === "me"; }).length,
      typing: typing,
      notice: notice || "",
      draft: "" // the message box: empty again after every message
    };
  }

  // What Echo says back. A few commands, to show the server decides everything.
  function reply(text) {
    var command = text.match(/^\/(\w+)\s*(.*)$/);
    if (!command) return "You said: " + text;
    if (command[1] === "shout") return (command[2] || "nothing to shout").toUpperCase() + "!";
    if (command[1] === "reverse") return (command[2] || "").split("").reverse().join("") || "Nothing to reverse.";
    if (command[1] === "clear") { messages = []; return "Cleared. Fresh start."; }
    if (command[1] === "help") return "Try /shout hello, /reverse hello, /clear, or /disconnect.";
    return "I don't know /" + command[1] + ". Try /help.";
  }

  greet();
  function greet() { say("bot", "Hi, I'm Echo. Say something and I'll say it back. Type /help for tricks."); }

  function MockSocket(url) {
    var socket = new EventTarget();
    var emit = function (type, init) {
      var event = type === "message" ? new MessageEvent("message", init) : type === "close" ? new CloseEvent("close", init) : new Event(type);
      socket.dispatchEvent(event);
      if (typeof socket["on" + type] === "function") socket["on" + type](event);
    };
    var push = function (data) { if (socket.readyState === 1) setTimeout(function () { emit("message", { data: JSON.stringify(data) }); }); };

    socket.url = url;
    socket.readyState = 0; // CONNECTING
    socket.close = function () {
      if (socket.readyState > 1) return;
      socket.readyState = 3;
      setTimeout(function () { emit("close", { code: 1000, wasClean: true }); });
    };
    socket.send = function (raw) {
      if (socket.readyState !== 1) throw new Error("WebSocket is not open");
      var text = String(JSON.parse(raw).text || "").trim();
      if (!text) return push(view("Type a message first."));
      say("me", text);
      if (text === "/disconnect") {
        say("bot", "Bye! The page should reconnect by itself in a second.");
        push(view());
        setTimeout(socket.close, 300);
        return;
      }
      typing = true;
      push(view());
      // Echo "thinks" for a moment, longer for longer messages.
      setTimeout(function () {
        typing = false;
        say("bot", reply(text));
        push(view());
      }, 500 + Math.min(text.length * 20, 1000));
    };

    setTimeout(function () {
      socket.readyState = 1; // OPEN
      emit("open");
      push(view());
    }, 150);
    return socket;
  }

  window.WebSocket = function (url, protocols) {
    if (/\/ws\/echo$/.test(new URL(url, location.href).pathname)) return MockSocket(url);
    return new RealWebSocket(url, protocols);
  };
  window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
})();
