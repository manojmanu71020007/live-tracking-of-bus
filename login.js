const form = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const identityInput = document.getElementById("identity");
const togglePasswordButton = document.getElementById("toggle-password");
const formMessage = document.getElementById("form-message");

function setMessage(text, type) {
    formMessage.textContent = text;
    formMessage.classList.remove("error", "success");
    if (type) {
        formMessage.classList.add(type);
    }
}

togglePasswordButton.addEventListener("click", function () {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    togglePasswordButton.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
});

form.addEventListener("submit", function (event) {
    event.preventDefault();

    const identity = identityInput.value.trim();
    const password = passwordInput.value.trim();

    if (!identity || !password) {
        setMessage("Please enter both mobile/email and password.", "error");
        return;
    }

    setMessage("Login submitted. Connect this form to your auth API.", "success");
});
