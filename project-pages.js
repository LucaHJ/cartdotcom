const themeToggle = document.querySelector(".theme-toggle");
const syncThemeToggle = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle?.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
};
syncThemeToggle();
themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cartdotcom-theme", next); } catch {}
    syncThemeToggle();
});
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const projectNavigation = document.querySelector(".project-navigation");
const compactNavigation = window.matchMedia("(max-width: 900px)");
const syncNavigation = () => {
    if (projectNavigation) projectNavigation.open = !compactNavigation.matches;
};
syncNavigation();
compactNavigation.addEventListener("change", syncNavigation);
document.querySelectorAll(".link-icon").forEach((link) => {
    link.addEventListener("pointermove", (event) => {
        if (reducedMotion.matches || event.pointerType === "touch") return;
        const rect = link.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        link.style.setProperty("--tilt-x", `${-y * 14}deg`);
        link.style.setProperty("--tilt-y", `${x * 14}deg`);
    });
    link.addEventListener("pointerleave", () => {
        link.style.setProperty("--tilt-x", "0deg");
        link.style.setProperty("--tilt-y", "0deg");
    });
});
