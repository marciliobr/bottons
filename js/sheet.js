(function () {
  const SIZES = {
    "32": { diameter: 32, cut: 44, cols: 4, rows: 6, gap: 4 },
    "44": { diameter: 44, cut: 54, cols: 3, rows: 5, gap: 3.5 },
    "58": { diameter: 58, cut: 70, cols: 2, rows: 3, gap: 16 }
  };

  const minScale = 0.25;
  const fitScale = 1;
  const maxScale = 4;
  const sheet = document.getElementById("sheet");
  const heading = document.querySelector(".toolbar h1");
  const countLabel = document.getElementById("count");
  const inspector = document.getElementById("inspector");
  const inspectorHint = document.getElementById("inspector-hint");
  const adjustButton = document.getElementById("adjust");
  const zoomInput = document.getElementById("zoom");
  const brightnessInput = document.getElementById("brightness");
  const saturationInput = document.getElementById("saturation");
  const minBrightness = 0.4;
  const maxBrightness = 1.8;
  const minSaturation = 0;
  const maxSaturation = 2;
  const viewMin = 1;
  const viewMax = 3;
  const memory = {};
  let currentKey = null;
  let pageFit = 1;
  let viewZoom = 1;
  let controllers = [];
  let adjustingCell = null;
  let selected = null;
  let drag = null;
  let swap = null;
  let ignoreClick = false;

  function sheetScale() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--scale"));
    return value > 0 ? value : 1;
  }

  function applyViewScale() {
    const scale = pageFit * viewZoom;
    document.documentElement.style.setProperty("--scale", String(scale > 0 ? scale : 1));
    const label = document.getElementById("view-fit");
    const outButton = document.getElementById("view-out");
    const inButton = document.getElementById("view-in");
    if (label) label.textContent = Math.round(viewZoom * 100) + "%";
    if (outButton) outButton.disabled = viewZoom <= viewMin + 0.001;
    if (inButton) inButton.disabled = viewZoom >= viewMax - 0.001;
    controllers.forEach(function (controller) {
      controller.layout();
    });
  }

  function setViewZoom(value) {
    viewZoom = Math.max(viewMin, Math.min(viewMax, value));
    applyViewScale();
  }

  function sizeFromHash() {
    const key = location.hash.replace("#", "");
    return SIZES[key] ? key : "32";
  }

  function slotsFor(key) {
    const spec = SIZES[key];
    const total = spec.cols * spec.rows;
    if (!memory[key]) {
      memory[key] = Array.from({ length: total }, function () {
        return { url: null, scale: fitScale, x: 0, y: 0, brightness: 1, saturation: 1 };
      });
    }
    return memory[key];
  }

  function syncHash(key) {
    const next = key === "32" ? location.pathname + location.search : location.pathname + location.search + "#" + key;
    const current = location.pathname + location.search + location.hash;
    if (current !== next) history.replaceState(null, "", next);
  }

  function setSizePressed(key) {
    document.querySelectorAll("[data-size]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.size === key ? "true" : "false");
    });
  }

  function updateCount() {
    const slots = slotsFor(currentKey);
    const filled = slots.filter(function (state) {
      return state.url;
    }).length;
    countLabel.textContent = filled + " de " + slots.length + " · corte " + SIZES[currentKey].cut + " mm";
  }

  function syncInspector() {
    const active = selected && selected.state.url ? selected : null;
    inspector.hidden = !active;
    document.body.classList.toggle("has-selection", Boolean(active));
    if (!active) return;
    const adjusting = active.isAdjusting();
    adjustButton.textContent = adjusting ? "Concluir" : "Ajustar";
    adjustButton.classList.toggle("is-on", adjusting);
    inspectorHint.textContent = adjusting
      ? "Arraste a foto. Use a roda ou o controle para ampliar."
      : "Arraste para outra posição para trocar de lugar. Segure Control para copiar.";
    zoomInput.value = String(active.state.scale);
    brightnessInput.value = String(active.state.brightness);
    saturationInput.value = String(active.state.saturation);
  }

  function select(controller) {
    if (!controller || !controller.state.url) {
      deselect();
      return;
    }
    if (selected && selected !== controller) {
      selected.cell.classList.remove("is-selected");
      if (selected.isAdjusting()) selected.stopAdjust();
    }
    selected = controller;
    controller.cell.classList.add("is-selected");
    syncInspector();
    fit();
  }

  function deselect() {
    if (selected) {
      if (selected.isAdjusting()) selected.stopAdjust();
      selected.cell.classList.remove("is-selected");
    }
    selected = null;
    syncInspector();
    fit();
  }

  function render(key) {
    if (!SIZES[key]) key = "32";
    if (adjustingCell) adjustingCell.stopAdjust();
    endSwap();
    selected = null;
    drag = null;
    currentKey = key;
    const spec = SIZES[key];
    const slots = slotsFor(key);
    const title = "May Bottons " + spec.diameter + " mm";

    if (heading) heading.textContent = title;
    setSizePressed(key);
    document.documentElement.style.setProperty("--diameter", spec.diameter + "mm");
    document.documentElement.style.setProperty("--cut", spec.cut + "mm");
    document.documentElement.style.setProperty("--gap", spec.gap + "mm");
    sheet.style.gridTemplateColumns = "repeat(" + spec.cols + ", " + spec.cut + "mm)";
    sheet.style.gridTemplateRows = "repeat(" + spec.rows + ", " + spec.cut + "mm)";
    sheet.replaceChildren();
    controllers = slots.map(function (state) {
      return createCell(state);
    });
    syncInspector();
    updateCount();
    fit();
  }

  function createCell(state) {
    const cell = document.createElement("div");
    cell.className = "cell";

    const frame = document.createElement("div");
    frame.className = "frame";

    const img = document.createElement("img");
    img.alt = "";
    img.hidden = true;
    img.draggable = false;

    const cut = document.createElement("div");
    cut.className = "cut";

    const circle = document.createElement("div");
    circle.className = "circle";

    const addMark = document.createElement("div");
    addMark.className = "add-mark";
    addMark.setAttribute("aria-hidden", "true");

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.tabIndex = -1;

    frame.appendChild(img);
    cell.append(frame, cut, circle, addMark, input);
    sheet.appendChild(cell);

    const controller = {
      cell: cell,
      frame: frame,
      state: state,
      layout: layoutImage,
      stopAdjust: stopAdjust,
      startAdjust: startAdjust,
      isAdjusting: function () {
        return cell.classList.contains("is-adjusting");
      },
      clearImage: clearImage,
      zoomAt: zoomAt,
      setScale: setScale,
      setBrightness: setBrightness,
      setSaturation: setSaturation,
      center: center,
      nudge: nudge,
      showState: showState,
      pickFile: function () {
        input.click();
      }
    };
    cell.controller = controller;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function applyTone() {
      state.brightness = clamp(state.brightness == null ? 1 : state.brightness, minBrightness, maxBrightness);
      state.saturation = clamp(state.saturation == null ? 1 : state.saturation, minSaturation, maxSaturation);
      img.style.filter = "brightness(" + state.brightness + ") saturate(" + state.saturation + ")";
      if (selected === controller) {
        brightnessInput.value = String(state.brightness);
        saturationInput.value = String(state.saturation);
      }
    }

    function layoutImage() {
      applyTone();
      if (img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      if (!frameW || !frameH) return;
      const cover = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
      const width = img.naturalWidth * cover * state.scale;
      const height = img.naturalHeight * cover * state.scale;
      const maxX = Math.abs(width - frameW) / 2;
      const maxY = Math.abs(height - frameH) / 2;
      state.x = Math.max(-maxX, Math.min(maxX, state.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y));
      img.style.width = width + "px";
      img.style.height = height + "px";
      img.style.left = (frameW - width) / 2 + state.x + "px";
      img.style.top = (frameH - height) / 2 + state.y + "px";
      if (selected === controller) zoomInput.value = String(state.scale);
    }

    function showImage() {
      img.hidden = false;
      cell.classList.add("has-image");
      if (img.complete && img.naturalWidth) layoutImage();
    }

    function showState() {
      if (state.url) {
        cell.classList.add("has-image");
        img.hidden = false;
        if (img.src !== state.url) img.src = state.url;
        else if (img.complete && img.naturalWidth) layoutImage();
        else applyTone();
      } else {
        img.removeAttribute("src");
        img.hidden = true;
        img.style.width = "";
        img.style.height = "";
        img.style.left = "";
        img.style.top = "";
        img.style.filter = "";
        cell.classList.remove("has-image");
      }
    }

    function stopAdjust() {
      cell.classList.remove("is-adjusting");
      frame.classList.remove("is-dragging");
      if (adjustingCell === controller) adjustingCell = null;
      if (selected === controller) syncInspector();
    }

    function startAdjust() {
      if (!state.url) return;
      if (adjustingCell && adjustingCell !== controller) adjustingCell.stopAdjust();
      cell.classList.add("is-adjusting");
      adjustingCell = controller;
      select(controller);
    }

    function clearImage() {
      stopAdjust();
      if (state.url) {
        URL.revokeObjectURL(state.url);
        state.url = null;
      }
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.removeAttribute("src");
      img.hidden = true;
      img.style.width = "";
      img.style.height = "";
      img.style.left = "";
      img.style.top = "";
      img.style.filter = "";
      input.value = "";
      cell.classList.remove("has-image");
      if (selected === controller) deselect();
      if (currentKey) updateCount();
    }

    function setImage(file) {
      stopAdjust();
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(file);
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.src = state.url;
      showImage();
      updateCount();
      select(controller);
    }

    function setScale(value) {
      state.scale = Math.max(minScale, Math.min(maxScale, value));
      layoutImage();
    }

    function setBrightness(value) {
      state.brightness = clamp(value, minBrightness, maxBrightness);
      applyTone();
    }

    function setSaturation(value) {
      state.saturation = clamp(value, minSaturation, maxSaturation);
      applyTone();
    }

    function center() {
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      layoutImage();
    }

    function nudge(dx, dy) {
      state.x += dx;
      state.y += dy;
      layoutImage();
    }

    function zoomAt(event) {
      if (!controller.isAdjusting() || img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      const rect = frame.getBoundingClientRect();
      const zoom = sheetScale();
      const pointX = (event.clientX - rect.left) / zoom - frameW / 2;
      const pointY = (event.clientY - rect.top) / zoom - frameH / 2;
      const localX = (pointX - state.x) / state.scale;
      const localY = (pointY - state.y) / state.scale;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      state.scale = Math.max(minScale, Math.min(maxScale, state.scale * factor));
      state.x = pointX - localX * state.scale;
      state.y = pointY - localY * state.scale;
      layoutImage();
    }

    img.addEventListener("load", layoutImage);

    frame.addEventListener("click", function () {
      if (ignoreClick || drag || controller.isAdjusting()) return;
      if (state.url) select(controller);
      else input.click();
    });

    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (file) setImage(file);
    });

    if (state.url) {
      img.src = state.url;
      showImage();
    }

    return controller;
  }

  function cellAtPoint(x, y) {
    const cells = sheet.querySelectorAll(".cell");
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const rect = cells[i].getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      const radius = rect.width / 2;
      if (dx * dx + dy * dy <= radius * radius) return cells[i].controller;
    }
    return null;
  }

  function exchange(source, target) {
    ["url", "scale", "x", "y", "brightness", "saturation"].forEach(function (key) {
      const hold = source.state[key];
      source.state[key] = target.state[key];
      target.state[key] = hold;
    });
    if (source.isAdjusting()) source.stopAdjust();
    if (target.isAdjusting()) target.stopAdjust();
    source.showState();
    target.showState();
    updateCount();
    if (target.state.url) select(target);
    else deselect();
  }

  function copyOnto(source, target) {
    const from = source.state.url;
    if (!from) return;
    fetch(from).then(function (response) {
      return response.blob();
    }).then(function (blob) {
      const url = URL.createObjectURL(blob);
      if (target.state.url) URL.revokeObjectURL(target.state.url);
      target.state.url = url;
      target.state.scale = source.state.scale;
      target.state.x = source.state.x;
      target.state.y = source.state.y;
      target.state.brightness = source.state.brightness;
      target.state.saturation = source.state.saturation;
      const live = controllers.filter(function (controller) {
        return controller.state === target.state;
      })[0];
      if (!live) return;
      if (live.isAdjusting()) live.stopAdjust();
      live.showState();
      updateCount();
      select(live);
    }).catch(function () {});
  }

  function clearSwapTarget() {
    if (!swap || !swap.over) return;
    swap.over.cell.classList.remove("is-swap-target");
    swap.over = null;
  }

  function endSwap() {
    if (!swap) return;
    clearSwapTarget();
    swap.controller.cell.classList.remove("is-swap-source");
    document.body.classList.remove("is-swapping");
    if (swap.ghost) swap.ghost.remove();
    swap = null;
  }

  function beginSwapGhost(event) {
    const rect = swap.controller.cell.getBoundingClientRect();
    const img = swap.controller.frame.querySelector("img");
    const zoom = sheetScale();
    const laidOut = Boolean(img.style.width);
    const ghost = document.createElement("div");
    const copy = document.createElement("img");
    ghost.className = "swap-ghost";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    copy.alt = "";
    copy.src = img.currentSrc || img.src;
    copy.style.filter = img.style.filter;
    copy.style.width = (laidOut ? parseFloat(img.style.width) * zoom : rect.width) + "px";
    copy.style.height = (laidOut ? parseFloat(img.style.height) * zoom : rect.height) + "px";
    copy.style.left = (parseFloat(img.style.left) || 0) * (laidOut ? zoom : 1) + "px";
    copy.style.top = (parseFloat(img.style.top) || 0) * (laidOut ? zoom : 1) + "px";
    ghost.appendChild(copy);
    if (event.ctrlKey) ghost.classList.add("is-copy");
    ghost.style.fontSize = Math.max(13, Math.round(rect.width * 0.24)) + "px";
    document.body.appendChild(ghost);
    swap.ghost = ghost;
    swap.ghost.style.left = event.clientX + "px";
    swap.ghost.style.top = event.clientY + "px";
  }

  function moveSwap(event) {
    const dx = event.clientX - swap.startX;
    const dy = event.clientY - swap.startY;
    if (!swap.active) {
      if (dx * dx + dy * dy < 36) return;
      swap.active = true;
      swap.controller.cell.classList.add("is-swap-source");
      document.body.classList.add("is-swapping");
      beginSwapGhost(event);
    }
    swap.ghost.style.left = event.clientX + "px";
    swap.ghost.style.top = event.clientY + "px";
    swap.ghost.classList.toggle("is-copy", event.ctrlKey);
    const over = cellAtPoint(event.clientX, event.clientY);
    const next = over && over !== swap.controller ? over : null;
    if (next === swap.over) return;
    clearSwapTarget();
    swap.over = next;
    if (next) next.cell.classList.add("is-swap-target");
  }

  function finishSwap(event) {
    if (!swap || event.pointerId !== swap.pointerId) return;
    const source = swap.controller;
    const target = swap.active ? swap.over : null;
    const moved = swap.active;
    endSwap();
    if (!moved) return;
    ignoreClick = true;
    setTimeout(function () {
      ignoreClick = false;
    }, 0);
    if (target && target !== source) {
      if (event.ctrlKey) copyOnto(source, target);
      else exchange(source, target);
    }
  }

  sheet.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller) return;
    if (controller.isAdjusting()) {
      const index = controllers.indexOf(controller);
      drag = {
        controller: controller,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: slotsFor(currentKey)[index].x,
        originY: slotsFor(currentKey)[index].y
      };
      controller.frame.classList.add("is-dragging");
      event.preventDefault();
      return;
    }
    if (!controller.state.url || swap) return;
    swap = {
      controller: controller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      over: null,
      ghost: null
    };
  });

  window.addEventListener("pointermove", function (event) {
    if (drag && event.pointerId === drag.pointerId) {
      const index = controllers.indexOf(drag.controller);
      const state = slotsFor(currentKey)[index];
      const zoom = sheetScale();
      state.x = drag.originX + (event.clientX - drag.startX) / zoom;
      state.y = drag.originY + (event.clientY - drag.startY) / zoom;
      drag.controller.layout();
      return;
    }
    if (!swap || event.pointerId !== swap.pointerId) return;
    moveSwap(event);
  });

  window.addEventListener("pointerup", function (event) {
    if (drag && event.pointerId === drag.pointerId) {
      drag.controller.frame.classList.remove("is-dragging");
      drag = null;
      return;
    }
    finishSwap(event);
  });

  window.addEventListener("pointercancel", function (event) {
    if (drag && event.pointerId === drag.pointerId) {
      drag.controller.frame.classList.remove("is-dragging");
      drag = null;
      return;
    }
    finishSwap(event);
  });

  sheet.addEventListener("wheel", function (event) {
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
    event.preventDefault();
    controller.zoomAt(event);
  }, { passive: false });

  document.getElementById("view-out").addEventListener("click", function () {
    const step = 0.25;
    setViewZoom(Math.ceil(viewZoom / step - 1.001) * step);
  });

  document.getElementById("view-in").addEventListener("click", function () {
    const step = 0.25;
    setViewZoom(Math.floor(viewZoom / step + 1.001) * step);
  });

  document.getElementById("view-fit").addEventListener("click", function () {
    setViewZoom(1);
  });

  document.querySelector(".stage").addEventListener("wheel", function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.target.closest(".is-adjusting")) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    setViewZoom(viewZoom * factor);
  }, { passive: false });

  document.querySelectorAll("[data-size]").forEach(function (button) {
    button.addEventListener("click", function () {
      syncHash(button.dataset.size);
      render(button.dataset.size);
    });
  });

  window.addEventListener("hashchange", function () {
    const key = sizeFromHash();
    if (key !== currentKey) render(key);
  });

  document.getElementById("replace").addEventListener("click", function () {
    if (selected) selected.pickFile();
  });

  document.getElementById("adjust").addEventListener("click", function () {
    if (!selected) return;
    if (selected.isAdjusting()) selected.stopAdjust();
    else selected.startAdjust();
  });

  document.getElementById("remove").addEventListener("click", function () {
    if (selected) selected.clearImage();
  });

  document.getElementById("center").addEventListener("click", function () {
    if (selected) selected.center();
  });

  zoomInput.addEventListener("input", function () {
    if (selected) selected.setScale(Number(zoomInput.value));
  });

  brightnessInput.addEventListener("input", function () {
    if (selected) selected.setBrightness(Number(brightnessInput.value));
  });

  saturationInput.addEventListener("input", function () {
    if (selected) selected.setSaturation(Number(saturationInput.value));
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Control" && swap && swap.ghost) swap.ghost.classList.add("is-copy");
    if (event.key === "Escape" && adjustingCell) {
      adjustingCell.stopAdjust();
      return;
    }
    if (!selected || !selected.state.url) return;
    if (event.target.closest("input, textarea")) return;
    const step = selected.frame.offsetWidth * 0.03;
    const move = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }[event.key];
    if (!move) return;
    event.preventDefault();
    selected.nudge(move[0], move[1]);
  });

  window.addEventListener("keyup", function (event) {
    if (event.key === "Control" && swap && swap.ghost) swap.ghost.classList.remove("is-copy");
  });

  document.getElementById("print").addEventListener("click", function () {
    if (adjustingCell) adjustingCell.stopAdjust();
    window.print();
  });

  window.addEventListener("beforeprint", function () {
    endSwap();
    document.documentElement.style.setProperty("--scale", "1");
    controllers.forEach(function (controller) {
      controller.layout();
    });
  });
  window.addEventListener("afterprint", fit);

  document.getElementById("clear").addEventListener("click", function () {
    controllers.forEach(function (controller) {
      controller.clearImage();
    });
    deselect();
    updateCount();
  });

  function fit() {
    const toolbar = document.querySelector(".toolbar");
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    const stage = document.querySelector(".stage");
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const padX = stageStyle ? parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight) : 0;
    const padY = stageStyle ? parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom) : 0;
    const availW = document.documentElement.clientWidth - padX;
    const availH = window.innerHeight - toolbarHeight - padY;
    const nextFit = Math.min(1, availW / sheet.offsetWidth, availH / sheet.offsetHeight);
    pageFit = nextFit > 0 ? nextFit : 1;
    applyViewScale();
  }

  window.addEventListener("resize", fit);
  render(sizeFromHash());
  syncHash(currentKey);

  const installButton = document.getElementById("install");
  let installPrompt = null;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", function () {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    prompt.prompt();
  });

  window.addEventListener("appinstalled", function () {
    installPrompt = null;
    installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
})();
