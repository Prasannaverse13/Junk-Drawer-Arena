import { profile, trophies } from "./meta.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function render() {
  const p = profile.get();
  if (p) {
    $("#acct").innerHTML = `<span class="l-user o"><i class="ic trophy"></i>${trophies.get()}</span><span class="l-name o">${esc(p.name)}</span><button class="cr-btn red sm" id="lo"><span class="o">Log out</span></button>`;
    const play = `<a class="cr-btn yellow huge" href="/play.html"><span class="o">Play now</span></a>`;
    $("#hero-cta").innerHTML = play;
    $("#final-cta").innerHTML = play;
    $("#lo").addEventListener("click", () => {
      profile.signOut();
      render();
    });
  } else {
    $("#acct").innerHTML = `<button class="cr-btn blue sm" data-signin><span class="o">Log in</span></button>`;
    const btn = `<button class="cr-btn yellow huge" data-signin><span class="o">Play free</span></button>`;
    $("#hero-cta").innerHTML = btn;
    $("#final-cta").innerHTML = btn;
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-signin]")) {
    $("#signin").hidden = false;
    $("#signin-name").focus();
  }
  if (e.target.closest("[data-close]") || e.target.id === "signin") $("#signin").hidden = true;
});

$("#signin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  profile.signIn($("#signin-name").value);
  location.href = "/play.html";
});

render();
if (new URLSearchParams(location.search).get("signin")) $("#signin").hidden = false;
