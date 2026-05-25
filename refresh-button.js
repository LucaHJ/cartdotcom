(function () {
    const completionIcon = `
        <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M20 6 9 17l-5-5"></path>
        </svg>
    `;

    window.runRefreshButton = function runRefreshButton(button, task) {
        if (!button || typeof task !== "function") return Promise.resolve();
        if (button.dataset.refreshState === "loading") return Promise.resolve();

        if (!button.dataset.refreshIcon) {
            button.dataset.refreshIcon = button.innerHTML;
        }

        window.clearTimeout(button._refreshResetTimer);
        button.dataset.refreshState = "loading";
        button.classList.remove("is-complete");
        button.classList.add("is-loading");
        button.disabled = true;

        return Promise.resolve()
            .then(task)
            .then((result) => {
                button.classList.remove("is-loading");
                button.classList.add("is-complete");
                button.innerHTML = completionIcon;
                button._refreshResetTimer = window.setTimeout(() => {
                    button.classList.remove("is-complete");
                    button.innerHTML = button.dataset.refreshIcon;
                    button.dataset.refreshState = "";
                    button.disabled = false;
                }, 1000);
                return result;
            })
            .catch((error) => {
                button.classList.remove("is-loading", "is-complete");
                button.dataset.refreshState = "";
                button.innerHTML = button.dataset.refreshIcon;
                button.disabled = false;
                throw error;
            });
    };
})();
