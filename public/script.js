(() => {
  "use strict";

  const STATUSES = ["todo", "doing", "done"];
  const STATUS_LABELS = { todo: "A Fazer", doing: "Em Andamento", done: "Concluído" };
  const $ = (id) => document.getElementById(id);

  const authView = $("authView");
  const boardView = $("boardView");
  const authForm = $("authForm");
  const authAlert = $("authAlert");
  const identityInput = $("identity");
  const passwordInput = $("password");
  const usernameInput = $("username");
  const nameField = $("nameField");
  const passwordHelp = $("passwordHelp");
  const authSubmit = $("authSubmit");
  const lists = Object.fromEntries(STATUSES.map(status => [status, $(`list-${status}`)]));
  const taskModal = $("taskModal");
  const taskForm = $("taskForm");
  const toast = $("toast");

  let authMode = "login";
  let currentUser = null;
  let tasks = [];
  let draggedTaskId = null;
  let toastTimer;

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || "Não foi possível concluir a operação.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showAlert(message, type = "error") {
    authAlert.textContent = message;
    authAlert.className = `form-alert ${type}`;
    authAlert.hidden = false;
  }

  function clearAlert() {
    authAlert.hidden = true;
    authAlert.textContent = "";
    authAlert.className = "form-alert";
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === "register";
    $("authEyebrow").textContent = isRegister ? "COMECE AGORA" : "BEM-VINDO DE VOLTA";
    $("authTitle").textContent = isRegister ? "Crie sua conta" : "Entre na sua conta";
    $("authSubtitle").textContent = isRegister
      ? "Cadastre-se para organizar suas tarefas em um só lugar."
      : "Acesse seu quadro e continue de onde parou.";
    $("authSubmit").textContent = isRegister ? "Criar conta" : "Entrar";
    $("authSwitch").firstChild.textContent = isRegister ? "Já possui uma conta? " : "Ainda não tem uma conta? ";
    $("switchMode").textContent = isRegister ? "Fazer login" : "Criar conta";
    $("password").autocomplete = isRegister ? "new-password" : "current-password";
    $("passwordHelp").hidden = !isRegister;
    $("nameField").hidden = !isRegister;
    $("username").required = isRegister;
    $("identity").placeholder = "voce@exemplo.com";
    $("identity").setAttribute("aria-label", isRegister ? "E-mail" : "E-mail ou nome de usuário");
    document.querySelector('label[for="identity"]').textContent = isRegister ? "E-mail" : "E-mail ou nome de usuário";
    clearAlert();
  }

  function showAuth() {
    boardView.hidden = true;
    authView.hidden = false;
    setAuthMode("login");
  }

  async function showBoard(user) {
    currentUser = user;
    $("userChip").textContent = user.username || user.email;
    authView.hidden = true;
    boardView.hidden = false;
    try {
      const result = await api("/tasks");
      tasks = result.tasks || [];
      render();
    } catch (error) {
      if (error.status === 401) {
        currentUser = null;
        showAuth();
      } else {
        showToast(error.message);
      }
    }
  }

  async function checkSession() {
    try {
      const result = await api("/auth/me");
      if (result.user) await showBoard(result.user);
      else showAuth();
    } catch {
      showAuth();
      showAlert("Não foi possível conectar ao servidor. Tente novamente em instantes.");
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();

    const identity = identityInput.value.trim();
    const password = passwordInput.value;
    const username = usernameInput.value.trim();

    if (!identity || !password || (authMode === "register" && !username)) {
      showAlert("Preencha todos os campos obrigatórios.");
      return;
    }
    if (authMode === "register" && password.length < 10) {
      showAlert("A senha precisa ter pelo menos 10 caracteres.");
      passwordInput.focus();
      return;
    }

    authSubmit.disabled = true;
    authSubmit.textContent = authMode === "register" ? "Criando conta..." : "Entrando...";
    try {
      const result = await api(authMode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(authMode === "register"
          ? { email: identity, username, password }
          : { identity, password })
      });
      await showBoard(result.user);
    } catch (error) {
      showAlert(error.message);
    } finally {
      authSubmit.disabled = false;
      authSubmit.textContent = authMode === "register" ? "Criar conta" : "Entrar";
    }
  });

  $("switchMode").addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });

  $("togglePassword").addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    $("togglePassword").textContent = isVisible ? "Mostrar" : "Ocultar";
    $("togglePassword").setAttribute("aria-label", isVisible ? "Mostrar senha" : "Ocultar senha");
    $("togglePassword").setAttribute("aria-pressed", String(!isVisible));
  });

  $("logoutBtn").addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } catch (error) {
      showToast(error.message);
    }
    currentUser = null;
    tasks = [];
    authForm.reset();
    showAuth();
    showToast("Você saiu da sua conta.");
  });

  function createTaskElement(task) {
    const article = document.createElement("article");
    article.className = "task";
    article.draggable = true;
    article.dataset.id = task.id;
    article.setAttribute("aria-label", `${task.title}. Arraste para mover entre colunas.`);

    const title = document.createElement("h3");
    title.textContent = task.title;
    article.appendChild(title);

    if (task.description) {
      const description = document.createElement("p");
      description.textContent = task.description;
      article.appendChild(description);
    }

    const footer = document.createElement("div");
    footer.className = "task-footer";
    const date = document.createElement("span");
    date.className = "task-date";
    const createdAt = new Date(task.createdAt);
    date.textContent = Number.isNaN(createdAt.getTime())
      ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(createdAt);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-btn";
    remove.title = "Excluir tarefa";
    remove.setAttribute("aria-label", `Excluir ${task.title}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => deleteTask(task.id));
    footer.append(date, remove);
    article.appendChild(footer);

    article.addEventListener("dragstart", (event) => {
      draggedTaskId = task.id;
      article.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
    });
    article.addEventListener("dragend", () => {
      draggedTaskId = null;
      article.classList.remove("dragging");
      document.querySelectorAll(".column").forEach(column => column.classList.remove("drag-over"));
    });
    return article;
  }

  function render() {
    STATUSES.forEach(status => {
      const statusTasks = tasks.filter(task => task.status === status);
      lists[status].replaceChildren();
      $(`count-${status}`).textContent = statusTasks.length;
      if (!statusTasks.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Nenhuma tarefa por aqui";
        lists[status].appendChild(empty);
      } else {
        statusTasks.forEach(task => lists[status].appendChild(createTaskElement(task)));
      }
    });
  }

  async function addTask(title, description) {
    const result = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description })
    });
    tasks.unshift(result.task);
    render();
    showToast("Tarefa adicionada!");
  }

  async function deleteTask(id) {
    try {
      await api(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      tasks = tasks.filter(task => task.id !== id);
      render();
      showToast("Tarefa excluída.");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function moveTask(id, status) {
    const task = tasks.find(item => item.id === id);
    if (!task || !STATUSES.includes(status) || task.status === status) return;
    const oldStatus = task.status;
    task.status = status;
    render();
    try {
      const result = await api(`/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      Object.assign(task, result.task);
      render();
      showToast(`Movida para "${STATUS_LABELS[status]}".`);
    } catch (error) {
      task.status = oldStatus;
      render();
      showToast(error.message);
    }
  }

  function openModal() {
    taskModal.classList.add("open");
    $("taskTitle").focus();
  }

  function closeModal() {
    taskModal.classList.remove("open");
    taskForm.reset();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  $("openModalBtn").addEventListener("click", openModal);
  $("closeModalBtn").addEventListener("click", closeModal);
  $("cancelBtn").addEventListener("click", closeModal);
  taskModal.addEventListener("click", event => {
    if (event.target === taskModal) closeModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && taskModal.classList.contains("open")) closeModal();
  });
  taskForm.addEventListener("submit", async event => {
    event.preventDefault();
    const title = $("taskTitle").value.trim();
    const description = $("taskDescription").value.trim();
    if (!title) {
      $("taskTitle").focus();
      return;
    }
    try {
      await addTask(title, description);
      closeModal();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll(".column").forEach(column => {
    column.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drag-over");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });
    column.addEventListener("drop", event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const id = event.dataTransfer.getData("text/plain") || draggedTaskId;
      if (id) moveTask(id, column.dataset.status);
    });
  });

  checkSession();
})();
