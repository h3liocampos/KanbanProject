(() => {
  "use strict";

  const {
    api, h, showToast, ROLE_LABELS, PRIORITY_LABELS, LABEL_NAMES, SPRINT_STATUS_LABELS,
    formatDate, formatDateTime, isOverdue, initials
  } = window.FB;
  const $ = (id) => document.getElementById(id);
  const BOARD_PATH = /^\/boards\/([0-9a-f-]{36})\/?$/i;
  const NEXT_PATH = /^\/(tasks|boards)\/[0-9a-f-]{36}$/i;

  const views = { auth: $("authView"), boards: $("boardsView"), board: $("boardView") };
  const authForm = $("authForm");
  const authAlert = $("authAlert");
  const modals = ["taskModal", "shareModal", "settingsModal", "sprintModal"].map($);

  let authMode = "login";
  let currentUser = null;
  let state = null;          // dados do quadro aberto
  let tab = "kanban";
  let sprintFilter = "all";
  let draggedTaskId = null;
  let pollTimer = null;

  const canEdit = () => state && state.role !== "VIEWER";
  const isOwner = () => state && state.role === "OWNER";

  /* ------------------------------------------------------------ */
  /* Navegação                                                     */
  /* ------------------------------------------------------------ */

  function show(view) {
    Object.entries(views).forEach(([name, el]) => { el.hidden = name !== view; });
    if (view !== "board") {
      stopPolling();
      closeChat();
    }
  }

  function navigate(path) {
    if (location.pathname !== path) history.pushState(null, "", path);
    route();
  }

  function linkHandler(path) {
    return (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      navigate(path);
    };
  }

  function route() {
    closeModals();
    if (!currentUser) return showAuth();
    const match = location.pathname.match(BOARD_PATH);
    if (match) openBoard(match[1]);
    else showBoards();
  }

  window.addEventListener("popstate", route);
  ["brandLink", "boardBrandLink", "backToBoards"].forEach((id) => $(id).addEventListener("click", linkHandler("/")));

  function handleError(error) {
    if (error.status === 401) {
      currentUser = null;
      showAuth();
      showAlertMessage("Sua sessão expirou. Entre novamente.");
    } else {
      showToast(error.message);
    }
  }

  /* ------------------------------------------------------------ */
  /* Autenticação                                                  */
  /* ------------------------------------------------------------ */

  function showAlertMessage(message, type = "error") {
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
    $("identity").setAttribute("aria-label", isRegister ? "E-mail" : "E-mail ou nome de usuário");
    document.querySelector('label[for="identity"]').textContent = isRegister ? "E-mail" : "E-mail ou nome de usuário";
    clearAlert();
  }

  function showAuth() {
    show("auth");
    setAuthMode("login");
  }

  function setUserChips() {
    const label = currentUser.username || currentUser.email;
    $("userChip").textContent = label;
    $("boardUserChip").textContent = label;
  }

  function enterApp(user) {
    currentUser = user;
    setUserChips();
    const next = new URLSearchParams(location.search).get("next");
    if (next && NEXT_PATH.test(next)) {
      if (next.startsWith("/tasks/")) {
        location.replace(next);
        return;
      }
      history.replaceState(null, "", next);
    } else if (location.search) {
      history.replaceState(null, "", location.pathname);
    }
    route();
  }

  async function checkSession() {
    try {
      const result = await api("/auth/me");
      if (result.user) enterApp(result.user);
      else showAuth();
    } catch {
      showAuth();
      showAlertMessage("Não foi possível conectar ao servidor. Tente novamente em instantes.");
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();
    const identity = $("identity").value.trim();
    const password = $("password").value;
    const username = $("username").value.trim();

    if (!identity || !password || (authMode === "register" && !username)) {
      showAlertMessage("Preencha todos os campos obrigatórios.");
      return;
    }
    if (authMode === "register" && password.length < 10) {
      showAlertMessage("A senha precisa ter pelo menos 10 caracteres.");
      $("password").focus();
      return;
    }

    const submit = $("authSubmit");
    submit.disabled = true;
    submit.textContent = authMode === "register" ? "Criando conta..." : "Entrando...";
    try {
      const result = await api(authMode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(authMode === "register"
          ? { email: identity, username, password }
          : { identity, password })
      });
      authForm.reset();
      enterApp(result.user);
    } catch (error) {
      showAlertMessage(error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = authMode === "register" ? "Criar conta" : "Entrar";
    }
  });

  $("switchMode").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));

  $("togglePassword").addEventListener("click", () => {
    const input = $("password");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    $("togglePassword").textContent = visible ? "Mostrar" : "Ocultar";
    $("togglePassword").setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
    $("togglePassword").setAttribute("aria-pressed", String(!visible));
  });

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } catch (error) {
      showToast(error.message);
    }
    currentUser = null;
    state = null;
    authForm.reset();
    history.replaceState(null, "", "/");
    showAuth();
    showToast("Você saiu da sua conta.");
  }
  $("logoutBtn").addEventListener("click", logout);
  $("boardLogoutBtn").addEventListener("click", logout);

  /* ------------------------------------------------------------ */
  /* Lista de quadros                                              */
  /* ------------------------------------------------------------ */

  async function showBoards() {
    show("boards");
    state = null;
    document.title = "FlowBoard — Seus quadros";
    try {
      const data = await api("/boards");
      renderBoardList($("myBoards"), data.mine, "Você ainda não criou nenhum quadro.");
      renderBoardList($("sharedBoards"), data.shared, "Nenhum quadro foi compartilhado com você ainda.");
    } catch (error) {
      handleError(error);
    }
  }

  function renderBoardList(container, boards, emptyText) {
    container.replaceChildren();
    if (!boards.length) {
      container.append(h("div", { class: "empty wide", text: emptyText }));
      return;
    }
    boards.forEach((board) => {
      const path = `/boards/${board.id}`;
      container.append(h("a", { class: "board-card", href: path, onclick: linkHandler(path) },
        h("div", { class: "board-card-top" },
          h("h3", { text: board.name }),
          h("span", { class: `role-badge ${board.role.toLowerCase()}`, text: ROLE_LABELS[board.role] })),
        h("p", { class: "board-card-meta", text: board.role === "OWNER" ? "Você é o dono" : `Dono: @${board.ownerUsername}` }),
        h("p", { class: "board-card-meta", text: `${board.taskCount} tarefa(s) · ${board.memberCount} pessoa(s)` })));
    });
  }

  $("createBoardForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("newBoardName");
    const name = input.value.trim();
    if (!name) return;
    try {
      const result = await api("/boards", { method: "POST", body: JSON.stringify({ name }) });
      input.value = "";
      navigate(`/boards/${result.board.id}`);
    } catch (error) {
      handleError(error);
    }
  });

  /* ------------------------------------------------------------ */
  /* Quadro                                                        */
  /* ------------------------------------------------------------ */

  async function openBoard(id) {
    show("board");
    state = null;
    tab = "kanban";
    sprintFilter = "all";
    $("boardName").textContent = "Carregando...";
    try {
      state = await api(`/boards/${id}`);
    } catch (error) {
      if (error.status === 401) return handleError(error);
      showToast(error.message);
      navigate("/");
      return;
    }
    renderBoardView();
    startPolling();
  }

  async function reloadBoard() {
    if (!state) return;
    try {
      state = await api(`/boards/${state.board.id}`);
      renderBoardView();
    } catch (error) {
      if (error.status === 404 || error.status === 403) {
        showToast("Você não tem mais acesso a este quadro.");
        navigate("/");
      } else {
        handleError(error);
      }
    }
  }

  function startPolling() {
    stopPolling();
    // Atualiza sozinho para que dois usuários vejam as mudanças um do outro.
    pollTimer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !state || draggedTaskId || modals.some((m) => m.classList.contains("open"))) return;
      if (document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      try {
        const fresh = await api(`/boards/${state.board.id}`);
        if (JSON.stringify(fresh) !== JSON.stringify(state)) {
          state = fresh;
          renderBoardView();
        }
      } catch (error) {
        if (error.status === 401) handleError(error);
        else if (error.status === 404) navigate("/");
      }
    }, 8000);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state && !views.board.hidden) reloadBoard();
  });

  function renderBoardView() {
    document.title = `${state.board.name} — FlowBoard`;
    $("boardName").textContent = state.board.name;
    const badge = $("roleBadge");
    badge.textContent = ROLE_LABELS[state.role];
    badge.className = `role-badge ${state.role.toLowerCase()}`;
    const owner = state.members.find((m) => m.role === "OWNER");
    $("boardSub").textContent = `${state.members.length} pessoa(s) no quadro${owner ? ` · dono: @${owner.username}` : ""}`;

    $("openModalBtn").hidden = !canEdit();
    $("settingsBtn").hidden = !isOwner();
    $("leaveBtn").hidden = isOwner();
    $("shareBtn").textContent = isOwner() ? "Compartilhar" : "Membros";
    $("viewerNote").hidden = canEdit();
    $("newSprintBtn").hidden = !canEdit();

    if (chat.boardId !== state.board.id) resetChat(state.board.id);
    renderFilterOptions();
    renderTab();
  }

  function renderTab() {
    document.querySelectorAll(".tab").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("paneKanban").hidden = tab !== "kanban";
    $("paneBacklog").hidden = tab !== "backlog";
    $("paneActivity").hidden = tab !== "activity";
    if (tab === "kanban") renderKanban();
    if (tab === "backlog") renderBacklog();
    if (tab === "activity") loadActivity();
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      renderTab();
    });
  });

  /* -------- Kanban -------- */

  function renderFilterOptions() {
    const select = $("sprintFilter");
    const options = [h("option", { value: "all", text: "Todas as tarefas" }),
      h("option", { value: "backlog", text: "Backlog (sem sprint)" })];
    state.sprints.filter((s) => s.status !== "CLOSED").forEach((s) => {
      options.push(h("option", { value: s.id, text: `${s.name} (${SPRINT_STATUS_LABELS[s.status].toLowerCase()})` }));
    });
    if (!options.some((o) => o.value === sprintFilter)) sprintFilter = "all";
    select.replaceChildren(...options);
    select.value = sprintFilter;
  }

  $("sprintFilter").addEventListener("change", (event) => {
    sprintFilter = event.target.value;
    renderKanban();
  });

  function visibleTasks() {
    if (sprintFilter === "all") return state.tasks;
    if (sprintFilter === "backlog") return state.tasks.filter((t) => !t.sprintId);
    return state.tasks.filter((t) => t.sprintId === sprintFilter);
  }

  function renderKanban() {
    const container = $("boardColumns");
    container.replaceChildren();
    container.style.setProperty("--cols", String(Math.min(state.columns.length, 4)));
    const tasks = visibleTasks();
    state.columns.forEach((column) => {
      const columnTasks = tasks.filter((t) => t.columnId === column.id);
      const total = state.tasks.filter((t) => t.columnId === column.id).length; // WIP conta o quadro todo
      const atLimit = column.wipLimit != null && total >= column.wipLimit;
      const over = column.wipLimit != null && total > column.wipLimit;

      const countText = column.wipLimit != null ? `${total}/${column.wipLimit}` : String(columnTasks.length);
      const list = h("div", { class: "task-list" });
      if (!columnTasks.length) list.append(h("div", { class: "empty", text: "Nenhuma tarefa por aqui" }));
      else columnTasks.forEach((task) => list.append(createTaskCard(task, column)));

      const section = h("section", { class: `column${column.isDone ? " done" : ""}${atLimit ? " wip-full" : ""}${over ? " wip-over" : ""}`, "data-id": column.id },
        h("div", { class: "column-head" },
          h("div", { class: "column-title" }, h("span", { class: "dot" }), column.name),
          h("span", { class: "count", title: column.wipLimit != null ? `Limite de WIP: ${column.wipLimit}` : "Sem limite de WIP", text: countText })),
        list,
        canEdit() ? h("p", { class: "column-hint", text: atLimit ? "Limite de WIP atingido" : "Arraste tarefas para esta coluna" }) : null);

      if (canEdit()) {
        section.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          section.classList.add("drag-over");
        });
        section.addEventListener("dragleave", (event) => {
          if (!section.contains(event.relatedTarget)) section.classList.remove("drag-over");
        });
        section.addEventListener("drop", (event) => {
          event.preventDefault();
          section.classList.remove("drag-over");
          const id = event.dataTransfer.getData("text/plain") || draggedTaskId;
          if (id) moveTask(id, column.id);
        });
      }
      container.append(section);
    });
  }

  function createTaskCard(task, column) {
    const editable = canEdit();
    const taskPath = `/tasks/${task.id}`;
    const chips = [];
    if (task.dueDate) {
      chips.push(h("span", { class: `meta-chip${!column.isDone && isOverdue(task.dueDate) ? " overdue" : ""}`, title: "Prazo", text: `⏰ ${formatDate(task.dueDate)}` }));
    }
    if (task.checklistTotal) {
      chips.push(h("span", { class: `meta-chip${task.checklistDone === task.checklistTotal ? " ok" : ""}`, title: "Checklist", text: `☑ ${task.checklistDone}/${task.checklistTotal}` }));
    }
    if (task.commentCount) chips.push(h("span", { class: "meta-chip", title: "Comentários", text: `💬 ${task.commentCount}` }));
    if (task.storyPoints != null) chips.push(h("span", { class: "meta-chip points", title: "Story points", text: `${task.storyPoints} pts` }));

    const card = h("article", {
      class: `task${editable ? "" : " readonly"}`,
      draggable: String(editable),
      "data-id": task.id,
      "aria-label": `${task.title}${editable ? ". Arraste para mover entre colunas." : ""}`
    },
      h("div", { class: "task-top" },
        h("span", { class: `priority-badge ${task.priority.toLowerCase()}`, text: PRIORITY_LABELS[task.priority] }),
        task.labels.map((label) => h("span", { class: `label-chip ${label}`, text: LABEL_NAMES[label] || label }))),
      h("h3", {}, h("a", { href: taskPath, target: "_blank", rel: "noopener", draggable: "false", title: "Abrir em nova aba", text: task.title })),
      task.description ? h("p", { text: task.description }) : null,
      chips.length ? h("div", { class: "meta-row" }, chips) : null,
      h("div", { class: "task-footer" },
        task.assignee
          ? h("span", { class: "assignee-chip", title: `Responsável: @${task.assignee.username}` },
              h("span", { class: "avatar", text: initials(task.assignee.username) }), `@${task.assignee.username}`)
          : h("span", { class: "task-date", text: "Sem responsável" }),
        editable
          ? h("button", { type: "button", class: "delete-btn", title: "Excluir tarefa", "aria-label": `Excluir ${task.title}`, text: "×", onclick: () => deleteTask(task) })
          : null));

    if (editable) {
      card.addEventListener("dragstart", (event) => {
        draggedTaskId = task.id;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      });
      card.addEventListener("dragend", () => {
        draggedTaskId = null;
        card.classList.remove("dragging");
        document.querySelectorAll(".column").forEach((c) => c.classList.remove("drag-over"));
      });
    }
    return card;
  }

  async function moveTask(id, columnId) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.columnId === columnId) return;
    const column = state.columns.find((c) => c.id === columnId);
    const oldColumnId = task.columnId;
    task.columnId = columnId;
    renderKanban();
    try {
      const result = await api(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ columnId }) });
      Object.assign(task, result.task);
      renderKanban();
      showToast(`Movida para "${column.name}".`);
    } catch (error) {
      task.columnId = oldColumnId;
      renderKanban();
      if (error.status === 401) handleError(error);
      else {
        showToast(error.message);
        if (error.status === 403 || error.status === 404) reloadBoard();
      }
    }
  }

  async function deleteTask(task) {
    if (!confirm(`Excluir a tarefa “${task.title}”?`)) return;
    try {
      await api(`/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      renderKanban();
      showToast("Tarefa excluída.");
    } catch (error) {
      handleError(error);
    }
  }

  /* -------- Backlog e sprints (Scrum) -------- */

  function renderBacklog() {
    const dod = state.board.definitionOfDone;
    $("dodBox").hidden = !dod;
    $("dodText").textContent = dod;

    const list = $("sprintList");
    list.replaceChildren();
    const doneColumns = new Set(state.columns.filter((c) => c.isDone).map((c) => c.id));
    const openSprints = state.sprints.filter((s) => s.status !== "CLOSED");

    state.sprints.forEach((sprint) => {
      const tasks = state.tasks.filter((t) => t.sprintId === sprint.id);
      const points = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      const donePoints = tasks.filter((t) => doneColumns.has(t.columnId)).reduce((sum, t) => sum + (t.storyPoints || 0), 0);
      const dates = [sprint.startDate, sprint.endDate].filter(Boolean).map(formatDate).join(" → ");

      const actions = [];
      if (canEdit() && sprint.status === "PLANNED") actions.push(h("button", { class: "secondary-btn small", type: "button", text: "Iniciar", onclick: () => sprintAction(sprint, { status: "ACTIVE" }) }));
      if (canEdit() && sprint.status === "ACTIVE") actions.push(h("button", { class: "secondary-btn small", type: "button", text: "Encerrar", onclick: () => confirmCloseSprint(sprint) }));
      if (canEdit()) actions.push(h("button", { class: "secondary-btn small danger-text", type: "button", text: "Excluir", onclick: () => deleteSprint(sprint) }));

      list.append(h("section", { class: `sprint-card ${sprint.status.toLowerCase()}` },
        h("div", { class: "sprint-head" },
          h("div", {},
            h("h3", {}, sprint.name, " ", h("span", { class: `status-pill ${sprint.status.toLowerCase()}`, text: SPRINT_STATUS_LABELS[sprint.status] })),
            h("p", { class: "board-card-meta", text: [dates, `${donePoints}/${points} pts concluídos`].filter(Boolean).join(" · ") }),
            sprint.goal ? h("p", { class: "sprint-goal", text: `Objetivo: ${sprint.goal}` }) : null),
          h("div", { class: "row-actions" }, actions)),
        taskRows(tasks, openSprints, doneColumns)));
    });

    const backlog = state.tasks.filter((t) => !t.sprintId);
    list.append(h("section", { class: "sprint-card backlog" },
      h("div", { class: "sprint-head" },
        h("div", {},
          h("h3", { text: "Backlog" }),
          h("p", { class: "board-card-meta", text: `${backlog.length} tarefa(s) sem sprint` }))),
      taskRows(backlog, openSprints, doneColumns)));
  }

  function taskRows(tasks, openSprints, doneColumns) {
    if (!tasks.length) return h("div", { class: "empty", text: "Nenhuma tarefa aqui" });
    return h("ul", { class: "task-rows" }, tasks.map((task) => {
      const column = state.columns.find((c) => c.id === task.columnId);
      const select = canEdit()
        ? h("select", { class: "select small", "aria-label": `Mover ${task.title} para uma sprint`, onchange: (event) => assignSprint(task, event.target.value) },
            h("option", { value: "", text: "Backlog" }),
            openSprints.map((s) => h("option", { value: s.id, text: s.name })))
        : null;
      if (select) select.value = task.sprintId || "";
      return h("li", { class: `task-row${doneColumns.has(task.columnId) ? " is-done" : ""}` },
        h("a", { class: "task-row-title", href: `/tasks/${task.id}`, target: "_blank", rel: "noopener", text: task.title }),
        h("span", { class: `priority-badge ${task.priority.toLowerCase()}`, text: PRIORITY_LABELS[task.priority] }),
        h("span", { class: "meta-chip", text: column ? column.name : "" }),
        task.storyPoints != null ? h("span", { class: "meta-chip points", text: `${task.storyPoints} pts` }) : null,
        task.assignee ? h("span", { class: "assignee-chip" }, h("span", { class: "avatar", text: initials(task.assignee.username) }), `@${task.assignee.username}`) : null,
        select);
    }));
  }

  async function assignSprint(task, sprintId) {
    try {
      const result = await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ sprintId: sprintId || null }) });
      Object.assign(task, result.task);
      renderBacklog();
      showToast("Tarefa atualizada.");
    } catch (error) {
      handleError(error);
      renderBacklog();
    }
  }

  async function sprintAction(sprint, body) {
    try {
      await api(`/sprints/${sprint.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await reloadBoard();
      showToast(body.status === "ACTIVE" ? "Sprint iniciada." : "Sprint atualizada.");
    } catch (error) {
      handleError(error);
    }
  }

  function confirmCloseSprint(sprint) {
    if (confirm(`Encerrar a sprint “${sprint.name}”? Tarefas não concluídas voltam para o backlog.`)) {
      sprintAction(sprint, { status: "CLOSED" });
    }
  }

  async function deleteSprint(sprint) {
    if (!confirm(`Excluir a sprint “${sprint.name}”? As tarefas voltam para o backlog.`)) return;
    try {
      await api(`/sprints/${sprint.id}`, { method: "DELETE" });
      await reloadBoard();
    } catch (error) {
      handleError(error);
    }
  }

  /* -------- Histórico -------- */

  async function loadActivity() {
    const list = $("activityList");
    list.replaceChildren(h("li", { class: "activity-item muted", text: "Carregando..." }));
    try {
      const data = await api(`/boards/${state.board.id}/activity`);
      list.replaceChildren();
      if (!data.activity.length) list.append(h("li", { class: "activity-item muted", text: "Nenhuma atividade ainda." }));
      data.activity.forEach((item) => {
        list.append(h("li", { class: "activity-item" },
          h("span", { class: "avatar", text: initials(item.username) }),
          h("div", {},
            h("p", {}, h("strong", { text: item.username ? `@${item.username}` : "Alguém" }), ` ${item.message}`),
            h("small", { text: formatDateTime(item.createdAt) }))));
      });
    } catch (error) {
      handleError(error);
    }
  }

  /* ------------------------------------------------------------ */
  /* Modais                                                        */
  /* ------------------------------------------------------------ */

  function openModal(modal) {
    modal.classList.add("open");
  }

  function closeModals() {
    modals.forEach((m) => m.classList.remove("open"));
  }

  modals.forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModals();
    });
    modal.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeModals));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });

  /* -------- Nova tarefa -------- */

  $("openModalBtn").addEventListener("click", () => {
    $("taskForm").reset();
    $("taskColumn").replaceChildren(...state.columns.map((c) => h("option", { value: c.id, text: c.name })));
    openModal($("taskModal"));
    $("taskTitle").focus();
  });

  $("taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("taskTitle").value.trim();
    if (!title) return $("taskTitle").focus();
    try {
      const result = await api(`/boards/${state.board.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, description: $("taskDescription").value.trim(), columnId: $("taskColumn").value })
      });
      state.tasks.unshift(result.task);
      closeModals();
      renderTab();
      showToast("Tarefa adicionada!");
    } catch (error) {
      if (error.status === 401) handleError(error);
      else showToast(error.message);
    }
  });

  /* -------- Compartilhar -------- */

  $("shareBtn").addEventListener("click", () => {
    $("inviteForm").hidden = !isOwner();
    $("inviteHelp").hidden = !isOwner();
    $("shareTitle").textContent = isOwner() ? "Compartilhar quadro" : "Membros do quadro";
    renderMembers();
    openModal($("shareModal"));
    if (isOwner()) $("inviteEmail").focus();
  });

  function renderMembers() {
    const list = $("memberList");
    list.replaceChildren();
    state.members.forEach((member) => {
      const isMe = String(member.userId) === String(currentUser.id);
      let control;
      if (isOwner() && member.role !== "OWNER") {
        control = h("select", { class: "select small", "aria-label": `Papel de ${member.username}`, onchange: (event) => changeRole(member, event.target.value) },
          h("option", { value: "EDITOR", text: "Editor" }), h("option", { value: "VIEWER", text: "Leitor" }));
        control.value = member.role;
      } else {
        control = h("span", { class: `role-badge ${member.role.toLowerCase()}`, text: ROLE_LABELS[member.role] });
      }
      list.append(h("li", { class: "member-row" },
        h("span", { class: "avatar", text: initials(member.username) }),
        h("div", { class: "member-info" },
          h("strong", { text: `@${member.username}${isMe ? " (você)" : ""}` }),
          h("small", { text: member.email })),
        control,
        isOwner() && member.role !== "OWNER"
          ? h("button", { class: "secondary-btn small danger-text", type: "button", text: "Remover acesso", onclick: () => removeMember(member) })
          : null));
    });
  }

  $("inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("inviteEmail").value.trim();
    try {
      const result = await api(`/boards/${state.board.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email, role: $("inviteRole").value })
      });
      state.members = result.members;
      $("inviteEmail").value = "";
      renderMembers();
      renderBoardView();
      showToast("Convite enviado: a pessoa já tem acesso ao quadro.");
    } catch (error) {
      if (error.status === 401) handleError(error);
      else showToast(error.message);
    }
  });

  async function changeRole(member, role) {
    try {
      const result = await api(`/boards/${state.board.id}/members/${member.userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
      state.members = result.members;
      renderMembers();
      showToast("Papel atualizado.");
    } catch (error) {
      showToast(error.message);
      renderMembers();
    }
  }

  async function removeMember(member) {
    if (!confirm(`Remover o acesso de @${member.username}?`)) return;
    try {
      await api(`/boards/${state.board.id}/members/${member.userId}`, { method: "DELETE" });
      await reloadBoard();
      renderMembers();
      showToast("Acesso removido.");
    } catch (error) {
      showToast(error.message);
    }
  }

  $("leaveBtn").addEventListener("click", async () => {
    if (!confirm("Sair deste quadro? Você perderá o acesso até ser convidado novamente.")) return;
    try {
      await api(`/boards/${state.board.id}/members/${currentUser.id}`, { method: "DELETE" });
      navigate("/");
    } catch (error) {
      showToast(error.message);
    }
  });

  /* -------- Configurar quadro (dono) -------- */

  $("settingsBtn").addEventListener("click", () => {
    $("settingsName").value = state.board.name;
    $("settingsDod").value = state.board.definitionOfDone;
    renderColumnRows();
    openModal($("settingsModal"));
  });

  $("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/boards/${state.board.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: $("settingsName").value.trim(), definitionOfDone: $("settingsDod").value.trim() })
      });
      await reloadBoard();
      showToast("Configurações salvas.");
    } catch (error) {
      showToast(error.message);
    }
  });

  function renderColumnRows() {
    const container = $("columnRows");
    container.replaceChildren();
    state.columns.forEach((column, index) => {
      const nameInput = h("input", { type: "text", maxlength: "40", value: column.name, "aria-label": "Nome da coluna" });
      const wipInput = h("input", { type: "number", min: "1", max: "99", class: "wip-input", placeholder: "WIP", value: column.wipLimit ?? "", "aria-label": `Limite de WIP de ${column.name}` });
      const doneBox = h("input", { type: "checkbox", id: `done-${column.id}` });
      doneBox.checked = column.isDone;
      const save = () => saveColumn(column, { name: nameInput.value.trim(), wipLimit: wipInput.value === "" ? null : Number(wipInput.value), isDone: doneBox.checked });
      nameInput.addEventListener("change", save);
      wipInput.addEventListener("change", save);
      doneBox.addEventListener("change", save);
      container.append(h("div", { class: "column-row" },
        nameInput, wipInput,
        h("label", { class: "check-label", for: `done-${column.id}` }, doneBox, "Concluída"),
        h("button", { type: "button", class: "icon-btn", title: "Mover para a esquerda", "aria-label": "Mover para a esquerda", text: "←", disabled: index === 0, onclick: () => moveColumn(column, "left") }),
        h("button", { type: "button", class: "icon-btn", title: "Mover para a direita", "aria-label": "Mover para a direita", text: "→", disabled: index === state.columns.length - 1, onclick: () => moveColumn(column, "right") }),
        h("button", { type: "button", class: "icon-btn danger-text", title: "Excluir coluna", "aria-label": `Excluir ${column.name}`, text: "×", onclick: () => deleteColumn(column) })));
    });
  }

  async function columnCall(promise, okMessage) {
    try {
      await promise;
      await reloadBoard();
      renderColumnRows();
      if (okMessage) showToast(okMessage);
    } catch (error) {
      showToast(error.message);
      await reloadBoard();
      renderColumnRows();
    }
  }

  const saveColumn = (column, body) => columnCall(api(`/columns/${column.id}`, { method: "PATCH", body: JSON.stringify(body) }), "Coluna atualizada.");
  const moveColumn = (column, direction) => columnCall(api(`/columns/${column.id}/move`, { method: "POST", body: JSON.stringify({ direction }) }));
  function deleteColumn(column) {
    if (!confirm(`Excluir a coluna “${column.name}”?`)) return;
    columnCall(api(`/columns/${column.id}`, { method: "DELETE" }), "Coluna removida.");
  }

  $("newColumnForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("newColumnName").value.trim();
    const wip = $("newColumnWip").value;
    if (!name) return;
    await columnCall(api(`/boards/${state.board.id}/columns`, {
      method: "POST",
      body: JSON.stringify({ name, wipLimit: wip === "" ? null : Number(wip) })
    }), "Coluna criada.");
    $("newColumnName").value = "";
    $("newColumnWip").value = "";
  });

  $("deleteBoardBtn").addEventListener("click", async () => {
    if (!confirm(`Excluir o quadro “${state.board.name}” e todas as suas tarefas? Isso não pode ser desfeito.`)) return;
    try {
      await api(`/boards/${state.board.id}`, { method: "DELETE" });
      showToast("Quadro excluído.");
      navigate("/");
    } catch (error) {
      showToast(error.message);
    }
  });

  /* -------- Nova sprint -------- */

  $("newSprintBtn").addEventListener("click", () => {
    $("sprintForm").reset();
    openModal($("sprintModal"));
    $("sprintName").focus();
  });

  $("sprintForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/boards/${state.board.id}/sprints`, {
        method: "POST",
        body: JSON.stringify({
          name: $("sprintName").value.trim(),
          goal: $("sprintGoal").value.trim(),
          startDate: $("sprintStart").value || null,
          endDate: $("sprintEnd").value || null
        })
      });
      closeModals();
      await reloadBoard();
      showToast("Sprint criada.");
    } catch (error) {
      showToast(error.message);
    }
  });

  /* ------------------------------------------------------------ */
  /* Chat lateral com IA (Kanban AI Co-Pilot)                      */
  /* O front só chama o NOSSO back-end (/api/ai/chat); a chave da   */
  /* IA fica no .env do servidor.                                   */
  /* ------------------------------------------------------------ */

  const chat = { boardId: null, busy: false };

  function addChatMessage(role, text) {
    const box = $("chatMessages");
    const el = h("div", { class: `chat-msg ${role}`, text });
    box.append(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function resetChat(boardId) {
    chat.boardId = boardId;
    chat.busy = false;
    $("chatMessages").replaceChildren();
    $("chatSuggestions").hidden = false;
    addChatMessage("ai", "Oi! Pergunte sobre as tarefas deste quadro. Respondo apenas com base nos cards reais.");
  }

  function openChat() {
    $("chatPanel").hidden = false;
    $("chatBtn").setAttribute("aria-expanded", "true");
    $("chatInput").focus();
  }

  function closeChat() {
    $("chatPanel").hidden = true;
    $("chatBtn").setAttribute("aria-expanded", "false");
  }

  async function askProject(question) {
    if (chat.busy || !state) return;
    chat.busy = true;
    $("chatSuggestions").hidden = true;
    $("chatSend").disabled = true;
    addChatMessage("user", question);
    const pending = addChatMessage("ai pending", "Analisando os cards...");
    const boardId = state.board.id;
    try {
      const result = await api("/ai/chat", { method: "POST", body: JSON.stringify({ boardId, question }) });
      pending.className = "chat-msg ai";
      pending.textContent = result.answer;
    } catch (error) {
      pending.className = "chat-msg ai error";
      pending.textContent = error.message;
      if (error.status === 401) handleError(error);
    } finally {
      chat.busy = false;
      $("chatSend").disabled = false;
      $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
    }
  }

  $("chatBtn").addEventListener("click", () => ($("chatPanel").hidden ? openChat() : closeChat()));
  $("chatClose").addEventListener("click", closeChat);
  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const question = $("chatInput").value.trim();
    if (!question) return;
    $("chatInput").value = "";
    askProject(question);
  });
  $("chatSuggestions").querySelectorAll("[data-q]").forEach((button) => {
    button.addEventListener("click", () => askProject(button.dataset.q));
  });

  checkSession();
})();
