const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".navigation");
const interactionMessage = document.querySelector(".interaction-message");
const scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

function closeMenu() {
  if (!menuButton || !navigation) return;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Ouvrir le menu");
  navigation.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Ouvrir le menu" : "Fermer le menu");
    navigation.classList.toggle("is-open", !isOpen);
    document.body.classList.toggle("menu-open", !isOpen);
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
}

const appRouteLinks = document.querySelectorAll("[data-app-route]");
if (window.location.protocol === "file:") {
  appRouteLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (interactionMessage) {
        interactionMessage.textContent = "Lancez TailorPro avec « npm.cmd run dev -- --host 127.0.0.1 », puis ouvrez http://127.0.0.1:5173/ pour accéder à l’inscription et à la connexion.";
        interactionMessage.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
      }
    });
  });
} else {
  appRouteLinks.forEach((link) => {
    link.href = link.dataset.appRoute;
  });
}

document.querySelectorAll(".js-not-live").forEach((button) => {
  button.addEventListener("click", () => {
    const message = "L'inscription et les paiements seront disponibles lors de la mise en service de TailorPro.";
    if (interactionMessage) {
      interactionMessage.textContent = message;
      interactionMessage.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
    } else {
      window.alert(message);
    }
  });
});

document.querySelectorAll(".js-not-live-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (interactionMessage) {
      interactionMessage.textContent = "Ces informations seront ajoutées lors de la mise en service de TailorPro.";
      interactionMessage.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
    }
  });
});

const currentYear = document.getElementById("current-year");
if (currentYear) currentYear.textContent = new Date().getFullYear();
