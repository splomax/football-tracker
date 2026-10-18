// The football beside the title. It sits still; click it and the laces roll once, like the loading spinner. At
// Halloween it's a jack-o'-lantern whose face turns round instead (css/base.css).

import { isHalloween } from "./season.js";

export function initLogo() {
  const logo = document.getElementById("logo");
  if (isHalloween()) {
    logo.setAttribute("aria-label", "Turn the jack-o'-lantern");
    logo.title = "Turn the jack-o'-lantern";
  }
  logo.addEventListener("click", () => {
    // Restart the spiral if it's already going: drop the class, force a style flush, then add it back.
    logo.classList.remove("spiral");
    void logo.offsetWidth;
    logo.classList.add("spiral");
  });
  logo.addEventListener("animationend", () => logo.classList.remove("spiral"));
}
