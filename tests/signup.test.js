const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {} };
  }

  set innerHTML(value) {
    this.html = value;
    this.children = [];
  }

  get innerHTML() {
    return this.html;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  querySelectorAll(selector) {
    assert.equal(selector, "option:not(:first-child)");
    return this.children.slice(1);
  }

  setAttribute() {}

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }
}

test("signup refreshes participant lists and availability only on success", async () => {
  const elements = Object.fromEntries(
    ["activities-list", "activity", "signup-form", "message", "email"].map(
      (id) => [id, new Element()]
    )
  );
  elements.activity.appendChild(new Element());
  elements["signup-form"].reset = () => {
    elements.email.value = "";
    elements.activity.value = "";
  };

  const participants = [];
  const requests = [];
  let onReady;
  const document = {
    addEventListener(name, listener) {
      assert.equal(name, "DOMContentLoaded");
      onReady = listener;
    },
    getElementById(id) {
      return elements[id];
    },
    createElement() {
      return new Element();
    },
  };

  async function fetch(url, options = {}) {
    requests.push({ url, method: options.method || "GET" });
    if (url === "/activities") {
      return {
        ok: true,
        json: async () => ({
          "Chess Club": {
            description: "Chess",
            schedule: "Fridays",
            max_participants: 3,
            participants: [...participants],
          },
        }),
      };
    }

    const email = new URL(url, "http://localhost").searchParams.get("email");
    if (participants.includes(email)) {
      return { ok: false, json: async () => ({ detail: "Already signed up" }) };
    }
    participants.push(email);
    return { ok: true, json: async () => ({ message: "Signed up" }) };
  }

  vm.runInNewContext(
    readFileSync(path.join(__dirname, "../src/static/app.js"), "utf8"),
    { document, fetch, console, setTimeout() {}, encodeURIComponent }
  );
  onReady();
  await new Promise((resolve) => setImmediate(resolve));

  async function signup(email) {
    elements.email.value = email;
    elements.activity.value = "Chess Club";
    await elements["signup-form"].listeners.submit({ preventDefault() {} });
  }

  await signup("first@example.com");
  let card = elements["activities-list"].children[0];
  assert.match(card.innerHTML, /2 spots left/);
  assert.equal(card.children[0].children[1].children[0].children[0].textContent, "first@example.com");
  assert.equal(elements.activity.children.length, 2);

  await signup("second@example.com");
  card = elements["activities-list"].children[0];
  assert.match(card.innerHTML, /1 spots left/);
  assert.deepEqual(
    card.children[0].children[1].children.map((item) => item.children[0].textContent),
    ["first@example.com", "second@example.com"]
  );
  assert.equal(elements.activity.children.length, 2);

  await signup("second@example.com");
  assert.equal(elements.message.textContent, "Already signed up");
  assert.equal(elements.message.className, "error");
  assert.equal(requests.filter((request) => request.url === "/activities").length, 3);
});
